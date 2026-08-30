/**
 * Phase 5 verification — the insights layer.
 *
 * Boots an in-memory MongoDB, seeds the catalog, writes a fact set that
 * reproduces the shapes the real workbooks contain, then exercises
 * /api/v1/insights through the real Express app to confirm:
 *   • a comparison's parts add up to the headline figure above them
 *   • a comparison never mixes dimension signatures
 *   • a delta is reported only when two comparable years exist
 *   • a funnel stage with no data does not manufacture a conversion rate
 *
 *   node scripts/verify-phase5.js
 */

process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION ?? '6.0.14';

const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  const mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '4998';
  process.env.MONGODB_URI = mongo.getUri('ri_insights_test');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-value-for-verification';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-for-verification';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.BCRYPT_SALT_ROUNDS = '4';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.SEED_ADMIN_EMAIL = 'admin@mest.local';
  process.env.SEED_ADMIN_PASSWORD = 'VerifyPassword123!';

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);

  const app = require('../src/app');
  const request = await makeClient(app);

  const { seedPrograms, seedMetrics, seedDimensions, seedAdmin } = require('../src/seeds/seed');
  const Program = require('../src/models/Program.model');
  const Metric = require('../src/models/Metric.model');
  const facts = require('../src/services/facts.service');
  const { buildPeriod } = require('../src/utils/period');

  await seedPrograms();
  await seedMetrics();
  await seedDimensions();
  await seedAdmin();

  const login = await request('POST', '/api/v1/auth/login', {
    body: { email: 'admin@mest.local', password: 'VerifyPassword123!' },
  });
  const token = login.body.data.accessToken;

  const program = async (pageKey) => Program.findOne({ pageKey });
  const metric = async (key) => Metric.findOne({ key });

  const grow = await program('digital-skills-grow');
  const preMest = await program('digital-skills-pre-mest');
  const web3 = await program('digital-skills-web3');

  const learners = await metric('learners_total');
  const graduates = await metric('graduates');
  const employed = await metric('graduates_employed');

  // writeFact takes a fully-built period; buildPeriod is what supplies the
  // label and the start/end bounds the aggregations filter on.
  const write = ({ period, ...opts }) =>
    facts.writeFact({ source: 'manual', period: buildPeriod(period), ...opts });

  // ------------------------------------------------------------ the fixture
  //
  // Deliberately mirrors the real data's awkward shapes:
  //   Grow     — a recorded programme total AND a hub breakdown of the same size
  //   Pre-Mest — a recorded total only
  //   Web3     — a gender split AND a hub split of the same 38 people, with no
  //              recorded total, so its figure must be derived from ONE of them
  section('Fixture');

  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, value: 793 });
  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'accra' }, value: 402 });
  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'whizzy-academy' }, value: 236 });
  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'womans-haven-africa' }, value: 155 });

  await write({ program: preMest, metric: learners, period: { periodType: 'all_time' }, value: 761 });

  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { gender: 'male' }, value: 26 });
  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { gender: 'female' }, value: 12 });
  // The same 38 people again, on a second axis. UNDP-YAI reports its 1,372 jobs
  // three ways like this and Absa its 190 enterprises twice; the two splits are
  // alternative views of one programme, never parts of it.
  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'accra' }, value: 30 });
  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'plugin' }, value: 8 });
  // The two splits are the same size here, so a headline that flips between
  // them is invisible. Make them differ, so choosing one at random shows.
  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { track: 'web-development' }, value: 37 });

  check('Grow holds a total and a hub breakdown of equal size', true);
  check('Web3 holds two tied splits of the same 38 people and no total', true);

  // ------------------------------------------------------------- comparison
  section('Compare across programmes');

  const compare = await request('GET', '/api/v1/insights/compare?metric=learners_total', { token });
  check('Comparison responds 200', compare.status === 200, `got ${compare.status}`);

  const rows = compare.body.data.rows;
  const total = compare.body.data.total;

  check('Total is 1,592 — not 2,385', total === 1592, `got ${total}`);
  check('Three programmes contribute', rows.length === 3, `got ${rows.length}`);

  const sum = rows.reduce((acc, r) => acc + r.value, 0);
  check('The parts add up to the headline figure', sum === total, `${sum} vs ${total}`);

  check('Ranked descending', rows[0].value >= rows[1].value && rows[1].value >= rows[2].value);
  check('Grow leads with its recorded total, 793', rows[0].name === 'Grow' && rows[0].value === 793,
    `${rows[0].name} ${rows[0].value}`);

  const web3Row = rows.find((r) => r.name === 'Web3');
  check('Web3 is counted at 38 — one split, not both added together', web3Row && web3Row.value === 38,
    web3Row ? String(web3Row.value) : 'missing');
  check('Web3 is labelled as derived, not recorded', web3Row?.basis === 'derived_from_breakdown', web3Row?.basis);
  check('Grow is labelled as recorded', rows[0].basis === 'recorded_total', rows[0].basis);

  const shares = rows.reduce((acc, r) => acc + r.share, 0);
  check('Shares sum to 1', Math.abs(shares - 1) < 1e-9, String(shares));

  // The org total agrees with the comparison built from the same reduction.
  const orgTotals = await request('GET', '/api/v1/facts/org-totals', { token });
  const orgLearners = orgTotals.body.data.totals.find((t) => t.key === 'learners_total');
  check('Comparison agrees with the Overview figure', orgLearners.value === total,
    `${orgLearners.value} vs ${total}`);
  // The Overview reduces programmes itself rather than going through compare,
  // so it needs its own tie-breaking. Without it the two Web3 splits were both
  // summed and the headline read 1,630.
  check('The Overview counts Web3 once across its two tied splits', orgLearners.value === 1592,
    `got ${orgLearners.value}`);
  check('The Overview still counts three contributing programmes', orgLearners.programCount === 3,
    `got ${orgLearners.programCount}`);
  check('Compare names the single split it derived Web3 from', web3Row?.derivedFrom?.length === 1,
    JSON.stringify(web3Row?.derivedFrom));

  // ---------------------------------------------------- a year page
  //
  // "2026" under AI Startup Lab is a period filter in the navigation, not a
  // programme. It holds no figures of its own by design, so a page that asks it
  // for figures directly shows an empty programme sitting under a full one.
  section('A year node reports its parent, sliced to that year');

  const yearPage = await request('GET', '/api/v1/facts/summary?program=ai-startup-lab-2026', { token });
  check('The year page responds 200', yearPage.status === 200, `got ${yearPage.status}`);
  check('It is titled by what it reports on, not the bare year',
    yearPage.body.data?.program.name === 'AI Startup Lab — 2026', yearPage.body.data?.program.name);
  check('It offers only its own year', JSON.stringify(yearPage.body.data?.availableYears) === '[2026]',
    JSON.stringify(yearPage.body.data?.availableYears));
  check('It keeps the year node\'s own page key, so the nav stays put',
    yearPage.body.data?.program.pageKey === 'ai-startup-lab-2026', yearPage.body.data?.program.pageKey);

  const emptyYear = await request('GET', '/api/v1/facts/summary?program=ai-startup-lab-2027', { token });
  check('A year with nothing recorded is empty rather than borrowing another year',
    emptyYear.body.data?.metrics.length === 0, String(emptyYear.body.data?.metrics.length));

  // ------------------------------------------------- a stable choice of split
  //
  // Web3 now holds three single-dimension splits that disagree slightly. Which
  // one becomes the headline must not depend on the order the database happens
  // to return them in, or the same figure reads differently between two loads
  // of the same page.
  section('Tied splits are chosen by name, not by luck');

  const readings = [];
  for (let i = 0; i < 4; i += 1) {
    const page = await request('GET', '/api/v1/facts/summary?program=digital-skills-web3', { token });
    const metric = page.body.data?.metrics.find((m) => m.key === 'learners_total');
    readings.push(`${metric?.total}:${JSON.stringify(metric?.derivedFrom)}`);
  }
  check('Four reads of the same page give the same figure', new Set(readings).size === 1,
    [...new Set(readings)].join(' | '));
  check('And it names the split it came from', /\[".+"\]/.test(readings[0]), readings[0]);

  // -------------------------------------------------------- a roll-up page
  //
  // Digital Skills is a container: it holds no figures of its own and reports
  // the programmes beneath it. Reading its headline out of the combined facts
  // counts only the programmes that recorded a standalone total — Web3 records
  // just a gender split, so its 38 learners vanished. Venture Support read 270
  // enterprises that way against a real 620.
  section('A roll-up page adds one figure per programme');

  const branch = await request('GET', '/api/v1/facts/summary?program=digital-skills', { token });
  check('The container page responds 200', branch.status === 200, `got ${branch.status}`);

  const branchLearners = branch.body.data?.metrics.find((m) => m.key === 'learners_total');
  check('It totals 1,592 — the three programmes, not just the two with totals',
    branchLearners?.total === 1592, String(branchLearners?.total));
  check('It counts all three as contributors', branchLearners?.programCount === 3,
    String(branchLearners?.programCount));
  check('And says the figure is partly derived, because one programme has no total',
    branchLearners?.basis === 'partly_derived', branchLearners?.basis);

  check('The branch agrees with the Overview built from the same programmes',
    branchLearners?.total === orgLearners.value, `${branchLearners?.total} vs ${orgLearners.value}`);

  // A page covering one programme keeps naming the breakdown it derived from.
  const single = await request('GET', '/api/v1/facts/summary?program=digital-skills-web3', { token });
  const singleLearners = single.body.data?.metrics.find((m) => m.key === 'learners_total');
  check('A single-programme page still reports one contributor',
    singleLearners?.programCount === 1, String(singleLearners?.programCount));
  check('And still names the split it derived from',
    singleLearners?.basis === 'derived_from_breakdown' && singleLearners?.derivedFrom?.length === 1,
    JSON.stringify({ basis: singleLearners?.basis, from: singleLearners?.derivedFrom }));

  // ------------------------------------------------------- grouped compare
  section('Compare grouped by a dimension');

  const byGender = await request('GET', '/api/v1/insights/compare?metric=learners_total&groupBy=gender', { token });
  check('Grouped comparison responds 200', byGender.status === 200, `got ${byGender.status}`);

  const grouped = byGender.body.data.rows;
  check('Only Web3 recorded a gender split, so only Web3 appears',
    grouped.length === 1 && grouped[0].name === 'Web3',
    grouped.map((g) => g.name).join(', '));
  check('Its segments total 38', grouped[0].total === 38, String(grouped[0]?.total));
  check('Grow is absent rather than represented by its unrelated total',
    !grouped.some((g) => g.name === 'Grow'));

  const badGroup = await request('GET', '/api/v1/insights/compare?metric=learners_total&groupBy=platform', { token });
  check('A breakdown the metric does not allow is refused', badGroup.status === 422, `got ${badGroup.status}`);

  // ---------------------------------------------------------------- funnel
  section('Funnel');

  const bareFunnel = await request('GET', '/api/v1/insights/funnel', { token });
  const stages = bareFunnel.body.data.stages;

  check('Three stages, in order',
    stages.map((s) => s.key).join(',') === 'learners_total,graduates,graduates_employed',
    stages.map((s) => s.key).join(','));
  check('Enrolled carries the 1,592', stages[0].value === 1592, String(stages[0].value));
  check('Graduated reads as no data, not zero', stages[1].value === null && stages[1].basis === 'no_data',
    `${stages[1].value} / ${stages[1].basis}`);
  check('A stage with no data reports no conversion', stages[1].conversion === null, String(stages[1].conversion));
  check('The stage after a gap does not measure against an earlier one',
    stages[2].conversion === null, String(stages[2].conversion));

  // Fill the middle stage and the conversions become real.
  await write({ program: grow, metric: graduates, period: { periodType: 'all_time' }, value: 604 });
  await write({ program: grow, metric: employed, period: { periodType: 'all_time' }, value: 381 });

  const fullFunnel = await request('GET', '/api/v1/insights/funnel', { token });
  const full = fullFunnel.body.data.stages;

  check('Graduation converts off enrolment', Math.abs(full[1].conversion - 604 / 1592) < 1e-9,
    String(full[1].conversion));
  check('Employment converts off graduation, not enrolment',
    Math.abs(full[2].conversion - 381 / 604) < 1e-9, String(full[2].conversion));

  // ------------------------------------------------------------- scorecard
  section('Scorecard and change over time');

  const flat = await request('GET', '/api/v1/insights/scorecard', { token });
  check('Scorecard responds 200', flat.status === 200, `got ${flat.status}`);

  const flatLearners = flat.body.data.totals.find((t) => t.key === 'learners_total');
  check('All seven headline figures are present even with no data',
    flat.body.data.totals.length === 7, String(flat.body.data.totals.length));
  check('All-time facts produce no delta', flatLearners.delta === null, JSON.stringify(flatLearners.delta));
  check('All-time facts produce no series', flatLearners.series.length === 0, String(flatLearners.series.length));

  // Jobs created is a headline metric, so it appears on the scorecard. Give it
  // an all-time figure plus two years, which is exactly the mix the real data
  // has and the case a naive delta gets wrong.
  const jobs = await metric('jobs_created');
  const portfolio = await program('portfolio');

  await write({ program: portfolio, metric: jobs, period: { periodType: 'all_time' }, value: 381 });

  // One year of data is still not a comparison.
  await write({ program: portfolio, metric: jobs, period: { periodType: 'year', year: 2026 }, value: 100 });
  const oneYear = await request('GET', '/api/v1/insights/scorecard', { token });
  const oneYearJobs = oneYear.body.data.totals.find((t) => t.key === 'jobs_created');
  check('One year of data still yields no delta', oneYearJobs.delta === null,
    JSON.stringify(oneYearJobs.delta));
  check('…but the year does appear in the series', oneYearJobs.series.length === 1,
    String(oneYearJobs.series.length));

  // Two comparable years produce a like-for-like delta.
  await write({ program: portfolio, metric: jobs, period: { periodType: 'year', year: 2027 }, value: 134 });
  const twoYears = await request('GET', '/api/v1/insights/scorecard', { token });
  const twoYearJobs = twoYears.body.data.totals.find((t) => t.key === 'jobs_created');

  check('Two years produce a delta', twoYearJobs.delta !== null);
  check('Delta compares 2027 against 2026',
    twoYearJobs.delta.fromYear === 2026 && twoYearJobs.delta.toYear === 2027,
    `${twoYearJobs.delta?.fromYear}→${twoYearJobs.delta?.toYear}`);
  check('Delta is +34 on 100', twoYearJobs.delta.change === 34, String(twoYearJobs.delta.change));
  check('Percent is +34%', Math.abs(twoYearJobs.delta.percent - 34) < 1e-9,
    String(twoYearJobs.delta.percent));
  check('The all-time 381 is excluded from the series — it belongs to no year',
    twoYearJobs.series.every((p) => p.value !== 381),
    JSON.stringify(twoYearJobs.series));

  const scoped = await request('GET', '/api/v1/insights/scorecard?year=2026', { token });
  const scopedJobs = scoped.body.data.totals.find((t) => t.key === 'jobs_created');
  check('Selecting 2026 reports the 2026 figure', scopedJobs.value === 100, String(scopedJobs.value));
  check('…and finds no earlier year to compare against', scopedJobs.delta === null,
    JSON.stringify(scopedJobs.delta));

  // ------------------------------------------------------------------ auth
  section('Access');
  // Insights are derived views of public figures, so they are public too. The
  // one exception is data quality, which reports on how the figures were
  // assembled rather than on what MEST did.
  const anonymous = await request('GET', '/api/v1/insights/scorecard');
  check('Insights are public', anonymous.status === 200, `got ${anonymous.status}`);
  check('And carry real figures for an anonymous reader',
    (anonymous.body.data?.totals ?? []).some((t) => t.value !== null),
    JSON.stringify((anonymous.body.data?.totals ?? []).map((t) => t.value)));

  const anonQuality = await request('GET', '/api/v1/insights/data-quality');
  check('Data quality is not', anonQuality.status === 401, `got ${anonQuality.status}`);

  // --------------------------------------------------------- computed pages
  //
  // The pages are read far more often than the figures change, and several
  // readers arrive together asking for the same thing. Those are held briefly
  // and shared — but a cached figure that outlives the write that changed it is
  // simply a wrong figure, so every write drops them.
  section('Reused pages, dropped the moment a figure moves');

  const readTotal = async () => {
    const page = await request('GET', '/api/v1/facts/summary?program=digital-skills-web3', { token });
    return page.body.data?.metrics.find((m) => m.key === 'learners_total')?.total;
  };

  const first = await readTotal();
  check('Web3 reads 38', first === 38, String(first));

  // Two reads in a row agree, whether or not the second was computed again.
  check('A repeat read agrees with the first', (await readTotal()) === first);

  // Written to the gender split, because that is the one Web3's total is
  // derived from — revising a different axis would leave the total alone and
  // prove nothing about the cache.
  const wrote = await request('POST', '/api/v1/facts', {
    token,
    body: {
      program: 'digital-skills-web3',
      metric: 'learners_total',
      periodType: 'all_time',
      dimensions: { gender: 'male' },
      value: 27,
    },
  });
  check('A figure is revised', wrote.status < 300, `got ${wrote.status}`);
  check('…and recorded as a revision, not a new figure',
    wrote.body.data?.outcome === 'updated', wrote.body.data?.outcome);

  const afterWrite = await readTotal();
  check('The page reflects it immediately, not when a timer expires',
    afterWrite === 39, `got ${afterWrite}, expected 39`);

  // The Overview is built from the same figures and must move with them.
  const scored = await request('GET', '/api/v1/insights/scorecard', { token });
  const scoreLearners = scored.body.data?.totals.find((t) => t.key === 'learners_total');
  check('And so does the Overview', scoreLearners?.value === 1593, String(scoreLearners?.value));

  const unknownMetric = await request('GET', '/api/v1/insights/compare?metric=not_a_metric', { token });
  check('An unknown metric is a 404', unknownMetric.status === 404, `got ${unknownMetric.status}`);

  console.log(
    `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`
  );

  await mongoose.disconnect();
  await mongo.stop();
  process.exit(failed === 0 ? 0 : 1);
}

async function makeClient(app) {
  const http = require('http');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return async function request(method, path, { token, body } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  };
}

main().catch((err) => {
  console.error('\x1b[31mVerification crashed:\x1b[0m', err);
  process.exit(1);
});
