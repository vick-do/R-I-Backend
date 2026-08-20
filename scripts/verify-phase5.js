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
  //   Web3     — a gender split and NO total, so its figure must be derived
  section('Fixture');

  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, value: 793 });
  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'accra' }, value: 402 });
  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'whizzy-academy' }, value: 236 });
  await write({ program: grow, metric: learners, period: { periodType: 'all_time' }, dimensions: { hub: 'womans-haven-africa' }, value: 155 });

  await write({ program: preMest, metric: learners, period: { periodType: 'all_time' }, value: 761 });

  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { gender: 'male' }, value: 26 });
  await write({ program: web3, metric: learners, period: { periodType: 'all_time' }, dimensions: { gender: 'female' }, value: 12 });

  check('Grow holds a total and a hub breakdown of equal size', true);
  check('Web3 holds only a gender split', true);

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
  check('Web3 is counted at 38, summed from its gender split', web3Row && web3Row.value === 38,
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
  const anonymous = await request('GET', '/api/v1/insights/scorecard');
  check('Insights require a signed-in user', anonymous.status === 401, `got ${anonymous.status}`);

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
