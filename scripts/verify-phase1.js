/**
 * Phase 1 verification.
 *
 * Boots an in-memory MongoDB, runs the real seed, then exercises the API
 * surface through the actual Express app to confirm:
 *   • the catalog seeds cleanly and idempotently
 *   • auth works and roles are enforced
 *   • facts are append-only with full history
 *   • aggregation refuses to mix dimension signatures (the anti-double-count rule)
 *   • org totals are derived, never typed
 *
 *   node scripts/verify-phase1.js
 */

// MongoDB 8 aborts with SIGABRT on macOS 12; 6.0.x is the newest server build
// that runs there and is compatible with everything ri-api uses. Must be set
// before mongodb-memory-server is required.
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
  process.env.PORT = '4999';
  process.env.MONGODB_URI = mongo.getUri('ri_impact_test');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-value-for-verification';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-for-verification';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.BCRYPT_SALT_ROUNDS = '4'; // fast for tests
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
  const Fact = require('../src/models/Fact.model');
  const User = require('../src/models/User.model');

  // ---------------------------------------------------------------- seeding
  section('Seed');
  await seedPrograms();
  await seedMetrics();
  await seedDimensions();
  await seedAdmin();

  const programCount = await Program.countDocuments();
  const metricCount = await Metric.countDocuments();
  check(`Seeded ${programCount} programmes covering the whole nav tree`, programCount === 25, `got ${programCount}`);
  check(`Seeded ${metricCount} metrics`, metricCount === 23, `got ${metricCount}`);

  const headline = await Metric.find({ headlineOrder: { $ne: null } }).sort({ headlineOrder: 1 });
  check('Seven headline metrics, in reporting order',
    headline.length === 7 && headline.map((m) => m.headlineOrder).join(',') === '1,2,3,4,5,6,7',
    headline.map((m) => `${m.headlineOrder}:${m.key}`).join(' '));

  const grow = await Program.findOne({ pageKey: 'digital-skills-grow' });
  const mestX = await Program.findOne({ pageKey: 'mest-x' });
  // mest-x › digital-skills › grow
  check('Grow nests under MEST X › Digital Skills',
    grow.ancestors.length === 2 && grow.depth === 2, `ancestors=${grow.ancestors.length} depth=${grow.depth}`);
  check('Container nodes are non-reportable', mestX.isReportable === false);

  // Re-running must not duplicate.
  await seedPrograms();
  await seedMetrics();
  check('Seed is idempotent', (await Program.countDocuments()) === programCount);

  // ------------------------------------------------------------------- auth
  section('Auth and roles');
  const badLogin = await request('POST', '/api/v1/auth/login', {
    body: { email: 'admin@mest.local', password: 'wrong-password' },
  });
  check('Wrong password is rejected', badLogin.status === 401);

  const login = await request('POST', '/api/v1/auth/login', {
    body: { email: 'admin@mest.local', password: 'VerifyPassword123!' },
  });
  check('Admin can sign in', login.status === 200 && !!login.body.data.accessToken);
  const adminToken = login.body.data.accessToken;

  const anon = await request('GET', '/api/v1/facts/org-totals');
  check('Unauthenticated reads are refused', anon.status === 401);

  await User.create({
    firstName: 'Read', lastName: 'Only', email: 'viewer@mest.local',
    password: 'ViewerPassword123!', role: 'viewer', isActive: true,
  });
  const viewerLogin = await request('POST', '/api/v1/auth/login', {
    body: { email: 'viewer@mest.local', password: 'ViewerPassword123!' },
  });
  const viewerToken = viewerLogin.body.data.accessToken;

  const viewerRead = await request('GET', '/api/v1/programs', { token: viewerToken });
  check('Viewer can read the programme tree', viewerRead.status === 200);

  const viewerWrite = await request('POST', '/api/v1/facts', {
    token: viewerToken,
    body: { program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 1 },
  });
  check('Viewer cannot write facts', viewerWrite.status === 403, `got ${viewerWrite.status}`);

  const viewerRefresh = await request('POST', '/api/v1/auth/refresh', {
    body: { refreshToken: viewerLogin.body.data.refreshToken },
  });
  check('Refresh token rotates a session', viewerRefresh.status === 200 && !!viewerRefresh.body.data.accessToken);

  // ------------------------------------------------------- fact write rules
  section('Facts are append-only');
  const write = (body) => request('POST', '/api/v1/facts', { token: adminToken, body });

  const first = await write({
    program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 793,
  });
  check('Records a programme total', first.status === 201 && first.body.data.outcome === 'created');

  const same = await write({
    program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 793,
  });
  check('Re-writing the same value is a no-op', same.body.data.outcome === 'unchanged');

  const revised = await write({
    program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 800,
  });
  check('Revising supersedes rather than overwrites', revised.body.data.outcome === 'updated');

  const versions = await Fact.find({ program: grow._id, dimensionKey: '' }).sort({ version: 1 });
  check('Both versions are retained', versions.length === 2, `got ${versions.length}`);
  check('Only one version is current', versions.filter((v) => v.isCurrent).length === 1);
  check('Superseded version keeps its original value', versions[0].value === 793 && !versions[0].isCurrent);

  // Put it back to the real figure for the aggregation checks below.
  await write({ program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 793 });

  const history = await request('GET',
    '/api/v1/facts/history?program=digital-skills-grow&metric=learners_total&periodType=all_time',
    { token: adminToken });
  check('History exposes every revision', history.body.data.versions.length === 3, `got ${history.body.data.versions.length}`);

  const badDimension = await write({
    program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time',
    value: 5, dimensions: { platform: 'facebook' },
  });
  check('Rejects a dimension the metric does not allow', badDimension.status === 422);

  const containerWrite = await write({
    program: 'mest-x', metric: 'learners_total', periodType: 'all_time', value: 10,
  });
  check('Rejects writing to a container node', containerWrite.status === 422);

  // ------------------------------------------------ open vs closed axes
  section('Breakdown values that grow over time');
  const Dimension = require('../src/models/Dimension.model');

  const newCohort = await write({
    program: 'digital-skills-grow', metric: 'learners_total', periodType: 'year',
    year: 2026, value: 61, dimensions: { cohort: '7' },
  });
  check('An unseen cohort is accepted and added to the catalog',
    newCohort.status === 201 && /Cohort 7/.test(newCohort.body.message), newCohort.body.message);

  // "Cohort 8", "8" and "cohort 8" must all mean one cohort. They previously
  // produced two catalog entries, splitting one cohort's figures in two.
  for (const spelling of ['Cohort 8', '8', 'cohort 8']) {
    await write({
      program: 'digital-skills-grow', metric: 'learners_total', periodType: 'year',
      year: 2026, value: 44, dimensions: { cohort: spelling },
    });
  }
  const cohorts = await Dimension.findOne({ name: 'cohort' });
  check('Three spellings of cohort 8 create exactly one catalog entry',
    cohorts.values.filter((v) => v.label === 'Cohort 8').length === 1,
    cohorts.values.map((v) => `${v.value}=${v.label}`).join(', '));
  check('The auto-created cohort is labelled from the template',
    cohorts.values.find((v) => v.value === '8')?.label === 'Cohort 8');

  const closedAxis = await write({
    program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time',
    value: 5, dimensions: { gender: 'martian' },
  });
  check('A closed axis rejects an unknown value and lists the valid ones',
    closedAxis.status === 422 && /Male, Female/.test(closedAxis.body.error.message),
    closedAxis.body.error?.message);

  // Remove the exploratory cohort facts so they cannot affect later checks.
  await Fact.deleteMany({ 'dimensions.cohort': { $in: ['7', '8'] } });

  // --------------------------------------------- the anti-double-count rule
  section('Aggregation never mixes dimension signatures');
  // Real Grow hub split from Data Summary Sheet.xlsx: 402 + 236 + 155 = 793.
  for (const [hub, value] of [['accra', 402], ['whizzy-academy', 236], ['womans-haven-africa', 155]]) {
    await write({
      program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time',
      value, dimensions: { hub },
    });
  }

  const byHub = await request('GET',
    '/api/v1/facts/aggregate?program=digital-skills-grow&metric=learners_total&groupBy=hub',
    { token: adminToken });
  const hubSum = byHub.body.data.rows.reduce((s, r) => s + r.value, 0);
  check('Hub breakdown returns 3 rows', byHub.body.data.rows.length === 3, `got ${byHub.body.data.rows.length}`);
  check('Hub breakdown sums to 793', hubSum === 793, `got ${hubSum}`);

  const total = await request('GET',
    '/api/v1/facts/total?program=digital-skills-grow&metric=learners_total',
    { token: adminToken });
  check('Total is 793, not 1,586 — breakdown and total are not summed together',
    total.body.data.total === 793, `got ${total.body.data.total}`);
  check('Total reports it came from a recorded figure',
    total.body.data.basis === 'recorded_total', total.body.data.basis);

  // A programme with only a breakdown must still yield a total, and say so.
  for (const [gender, value] of [['male', 26], ['female', 12]]) {
    await write({
      program: 'digital-skills-web3', metric: 'learners_total', periodType: 'all_time',
      value, dimensions: { gender },
    });
  }
  const web3Total = await request('GET',
    '/api/v1/facts/total?program=digital-skills-web3&metric=learners_total',
    { token: adminToken });
  check('Derives a total from the breakdown when none was recorded',
    web3Total.body.data.total === 38, `got ${web3Total.body.data.total}`);
  check('And flags that the figure is derived',
    web3Total.body.data.basis === 'derived_from_breakdown', web3Total.body.data.basis);

  // ------------------------------------------------------------ org rollups
  section('Org totals are derived');
  await write({
    program: 'digital-skills-pre-mest', metric: 'learners_total', periodType: 'all_time', value: 761,
  });

  const org = await request('GET', '/api/v1/facts/org-totals', { token: adminToken });
  const learners = org.body.data.totals.find((t) => t.key === 'learners_total');

  // Each programme contributes exactly one figure: Grow's recorded 793, Pre
  // Mest's recorded 761, and Web3's 38 summed from its gender split because it
  // records no standalone total. Taking one figure per programme is what keeps
  // the roll-up safe while still counting programmes that only hold breakdowns.
  check('Org learner total takes one figure per programme (793 + 761 + 38)',
    learners.value === 1592, `got ${learners.value}`);
  check('All three contributing programmes are counted',
    learners.programCount === 3, `got ${learners.programCount}`);
  check('Roll-up reports that part of it was derived',
    learners.basis === 'partly_derived', learners.basis);

  check('Headline figures come back in reporting order',
    org.body.data.totals.map((t) => t.key).join(',') ===
      'learners_total,enterprises_total,jobs_created,edtech_learners_impacted,amount_invested,edtech_advocacy,venture_acceleration',
    org.body.data.totals.map((t) => t.key).join(','));

  const noData = org.body.data.totals.find((t) => t.key === 'amount_invested');
  check('Metrics with no data report no_data rather than a fabricated zero',
    noData.value === null && noData.basis === 'no_data');

  // -------------------------------------------------------- period handling
  section('Periods');
  const { buildPeriod, parsePeriodLabel } = require('../src/utils/period');
  check('Month period spans exactly one month',
    buildPeriod({ periodType: 'month', year: 2026, month: 4 }).periodEnd.toISOString().startsWith('2026-05-01'));
  check('Parses "April 2026"', parsePeriodLabel('April 2026')?.periodLabel === 'April 2026');
  check('Parses bare "FEB" with a contextual year',
    parsePeriodLabel('FEB', { defaultYear: 2026 })?.periodLabel === 'February 2026');
  check('Rejects bare "FEB" without a year', parsePeriodLabel('FEB') === null);
  check('Parses "Q3 2025"', parsePeriodLabel('Q3 2025')?.periodLabel === 'Q3 2025');
  check('Treats non-period text as not a period', parsePeriodLabel('Hub Breakdown') === null);

  const monthly = await write({
    program: 'ecosystem-edtech-mondays', metric: 'impressions',
    periodType: 'month', year: 2026, month: 4, value: 7455,
    dimensions: { channel: 'mest-africa' },
  });
  check('Records a monthly social metric', monthly.status === 201);

  const byYear = await request('GET',
    '/api/v1/facts/aggregate?program=ecosystem-edtech-mondays&metric=impressions&groupBy=channel&year=2026',
    { token: adminToken });
  check('Filters by year', byYear.body.data.rows[0]?.value === 7455);

  const byWrongYear = await request('GET',
    '/api/v1/facts/aggregate?program=ecosystem-edtech-mondays&metric=impressions&groupBy=channel&year=2025',
    { token: adminToken });
  check('Excludes other years', byWrongYear.body.data.rows.length === 0);

  // ---------------------------------------------------- workbook cell reads
  section('Workbook reading (Google Sheets formula wrappers)');
  const { loadWorkbook, readNumber, readText } = require('../src/utils/workbook');
  const wb = await loadWorkbook('/Users/kod/Desktop/vic/Data Summary Sheet.xlsx');
  const growSheet = wb.getWorksheet('Grow');
  check('Unwraps a DUMMYFUNCTION-wrapped number', readNumber(growSheet.getCell('A4')) === 793);
  check('Unwraps a DUMMYFUNCTION-wrapped string', readText(growSheet.getCell('H4')) === 'Accra');
  check('Reads the Accra hub figure', readNumber(growSheet.getCell('I4')) === 402);
  check('Empty cells read as null', readNumber(growSheet.getCell('Z99')) === null);

  const edtech = await loadWorkbook('/Users/kod/Desktop/vic/EdTech Mondays Analytics 2026.xlsx');
  check('Reads the 27-sheet EdTech workbook', edtech.worksheets.length === 27, `got ${edtech.worksheets.length}`);
  const fbAnnual = edtech.getWorksheet('Facebook Annual');
  check('Handles "-" placeholders as null', readNumber(fbAnnual.getCell('J5')) === null);

  // ------------------------------------------------------------------- done
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);

  await mongoose.connection.close();
  await mongo.stop();
  process.exit(failed === 0 ? 0 : 1);
}

/** Minimal in-process HTTP client so no extra test dependency is needed. */
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
