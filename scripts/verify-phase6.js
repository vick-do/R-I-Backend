/**
 * Phase 6 verification — Google Sheets sync and data-quality detection.
 *
 * Proves, without touching the network, that:
 *   • the Sheets adapter satisfies the exact worksheet surface the importer
 *     uses, so a live sheet runs the same pipeline as an uploaded workbook
 *   • a clean sync commits itself and a dirty one is held for review
 *   • the auto-commit threshold catches a figure that moves too far
 *   • signature divergence finds the Pre-Mest style conflict
 *
 *   node scripts/verify-phase6.js
 */

process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION ?? '6.0.14';

// Set before anything loads dotenv. These assert the no-credentials path, and
// dotenv skips a key already present in the environment — so an empty string
// here keeps the run deterministic on a machine that does have a service
// account configured in .env.
process.env.GOOGLE_CLIENT_EMAIL = '';
process.env.GOOGLE_PRIVATE_KEY = '';

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
  process.env.PORT = '4997';
  process.env.MONGODB_URI = mongo.getUri('ri_sheets_test');
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

  require('../src/models');
  const { seedPrograms, seedMetrics, seedDimensions, seedAdmin } = require('../src/seeds/seed');
  const Program = require('../src/models/Program.model');
  const Metric = require('../src/models/Metric.model');
  const Fact = require('../src/models/Fact.model');

  const sheets = require('../src/services/sheets.service');
  const sheetSync = require('../src/services/sheetSync.service');
  const dataQuality = require('../src/services/dataQuality.service');
  const imports = require('../src/services/import.service');
  const facts = require('../src/services/facts.service');
  const { buildPeriod } = require('../src/utils/period');
  const { readText, readNumber } = require('../src/utils/workbook');

  await seedPrograms();
  await seedMetrics();
  await seedDimensions();
  await seedAdmin();

  const grow = await Program.findOne({ pageKey: 'digital-skills-grow' });
  const preMest = await Program.findOne({ pageKey: 'digital-skills-pre-mest' });
  const edtech = await Program.findOne({ pageKey: 'ecosystem-edtech-mondays' });
  const learners = await Metric.findOne({ key: 'learners_total' });

  // ------------------------------------------------------------- the adapter
  section('The adapter speaks worksheet');

  // Shaped like the real Grow block: a label column, a value column, and a
  // stated total the importer must treat as a check rather than a fact.
  const grid = [
    ['Grow — Digital Skills'],
    [],
    ['Hub', 'Total Learners'],
    ['Accra', 402],
    ['Whizzy Academy', 236],
    ["Woman's Haven Africa", 155],
    ['Total', 793],
  ];

  const worksheet = sheets.toWorksheet({ name: 'Grow', values: grid });

  check('Exposes name, rowCount and columnCount',
    worksheet.name === 'Grow' && worksheet.rowCount === 7 && worksheet.columnCount === 2,
    `${worksheet.name} ${worksheet.rowCount}x${worksheet.columnCount}`);

  check('getCell(row, col) reads a value', readNumber(worksheet.getCell(4, 2)) === 402,
    String(readNumber(worksheet.getCell(4, 2))));
  check('getCell("B4") reads the same cell', readNumber(worksheet.getCell('B4')) === 402,
    String(readNumber(worksheet.getCell('B4'))));
  check('Text cells read as text', readText(worksheet.getCell('A4')) === 'Accra',
    readText(worksheet.getCell('A4')));
  check('A short row pads rather than throwing', worksheet.getCell(2, 2).value === null);
  check('Reading past the grid returns empty, not an error', worksheet.getCell(99, 99).value === null);
  check('Blank strings read as empty', sheets.toWorksheet({ name: 'x', values: [['']] }).getCell(1, 1).value === null);

  // The live API returns real numbers, so none of the xlsx formula unwrapping
  // is needed — but the same reader must still handle them.
  check('Numbers arrive as numbers, not formula wrappers',
    typeof worksheet.getCell(4, 2).value === 'number');

  // ---------------------------------------------------------------- the plan
  section('A sheet runs the importer unchanged');

  const mapping = {
    layout: 'long',
    headerRow: 3,
    firstDataRow: 4,
    lastDataRow: 7,
    totalRowLabels: ['Total'],
    defaultPeriod: { periodType: 'all_time' },
    columns: [
      { role: 'dimension', column: 'A', target: 'hub' },
      { role: 'metric', column: 'B', target: 'learners_total' },
    ],
  };

  const planResult = await imports.plan({
    worksheet,
    mapping,
    fileName: 'Data Summary (live)',
    programId: grow._id,
  });

  check('Three hub rows planned, the stated total excluded',
    planResult.summary.created === 3, JSON.stringify(planResult.summary));
  check('The stated total became a reconciliation check', planResult.checks.length === 1,
    String(planResult.checks.length));
  check('And it reconciles: 793 = 402 + 236 + 155',
    planResult.checks[0]?.status === 'pass' && planResult.checks[0]?.actual === 793,
    JSON.stringify(planResult.checks[0]));
  check('Provenance names the sheet, not a file path',
    planResult.candidates[0].sourceRef.includes('Grow'), planResult.candidates[0].sourceRef);

  // ------------------------------------------- a total that spans the periods
  //
  // The EdTech Mondays season sheets state one total per platform at the end of
  // a row of months. Two things about that shape used to defeat reconciliation:
  // the total sits on no month, so a month-by-month comparison found nothing to
  // compare it with; and every platform's total was checked against every
  // platform's figures added together. All 35 checks failed on a sheet whose
  // arithmetic was in fact exact.
  section('Row totals across a period axis');

  const season = sheets.toWorksheet({
    name: 'EdTech Mondays',
    values: [
      ['', '', '', 'Feb', 'Mar', 'Total'],
      ['', '', 'Posts', 6, 8, 14],
    ],
  });

  const seasonPlan = async (channel, platform) => imports.plan({
    worksheet: season,
    fileName: 'Data Summary (live)',
    programId: edtech._id,
    mapping: {
      layout: 'crosstab',
      fixedDimensions: { channel, platform },
      crosstab: {
        headerRow: 1, labelColumn: 'C', firstDataRow: 2, lastDataRow: 2,
        firstDataColumn: 'D', lastDataColumn: 'F',
        headerRole: 'period', defaultYear: 2023,
      },
    },
  });

  const facebook = await seasonPlan('mest-africa', 'facebook');
  check('Two months planned, the total column excluded',
    facebook.candidates.length === 2, String(facebook.candidates.length));
  check('The stated 14 reconciles against Feb + Mar',
    facebook.checks[0]?.status === 'pass' && facebook.checks[0]?.actual === 14,
    JSON.stringify(facebook.checks[0]));
  check('The check says it spans every period rather than naming one month',
    /all periods/.test(facebook.checks[0]?.label ?? ''), facebook.checks[0]?.label);
  check('And it names the platform the total belongs to',
    /facebook/.test(facebook.checks[0]?.label ?? ''), facebook.checks[0]?.label);

  // --------------------------------------------------------- the safety gate
  section('Auto-commit gate');

  const source = { maxChangePercent: 10, autoCommit: true };

  check('A clean plan is judged safe to commit', sheetSync.assess(planResult, source).clean);

  const failing = {
    ...planResult,
    checks: [{ label: 'Learners — All time', expected: 800, actual: 793, difference: -7, status: 'fail' }],
  };
  const failVerdict = sheetSync.assess(failing, source);
  check('A failed reconciliation holds the sync', !failVerdict.clean);
  check('…and says which total disagreed', failVerdict.reasons[0].includes('800'), failVerdict.reasons[0]);

  const bigMove = {
    ...planResult,
    diff: {
      ...planResult.diff,
      updated: [{ metricLabel: 'Learners trained', period: 'All time', value: 900, previousValue: 402 }],
    },
  };
  const moveVerdict = sheetSync.assess(bigMove, source);
  check('A figure moving 124% holds the sync', !moveVerdict.clean);
  check('…and reports the movement', moveVerdict.reasons[0].includes('123.9%'), moveVerdict.reasons[0]);

  const smallMove = {
    ...planResult,
    diff: {
      ...planResult.diff,
      updated: [{ metricLabel: 'Learners trained', period: 'All time', value: 420, previousValue: 402 }],
    },
  };
  check('A 4.5% move stays clean', sheetSync.assess(smallMove, source).clean);

  check('A duplicated coordinate holds the sync',
    !sheetSync.assess({ ...planResult, diff: { ...planResult.diff, conflicts: [{ message: 'twice' }] } }, source).clean);

  // ------------------------------------------------------ divergence finding
  section('Discrepancy detection');

  const write = ({ program, metric, dimensions, value }) =>
    facts.writeFact({
      program, metric, period: buildPeriod({ periodType: 'all_time' }),
      dimensions, value, source: 'manual',
    });

  // Grow agrees with itself: total 793, hubs sum to 793.
  await write({ program: grow, metric: learners, value: 793 });
  await write({ program: grow, metric: learners, dimensions: { hub: 'accra' }, value: 402 });
  await write({ program: grow, metric: learners, dimensions: { hub: 'whizzy-academy' }, value: 236 });
  await write({ program: grow, metric: learners, dimensions: { hub: 'womans-haven-africa' }, value: 155 });

  // Pre-Mest does not: stated 761, gender rows sum to 759.
  await write({ program: preMest, metric: learners, value: 761 });
  await write({ program: preMest, metric: learners, dimensions: { gender: 'female' }, value: 403 });
  await write({ program: preMest, metric: learners, dimensions: { gender: 'male' }, value: 356 });

  const divergence = await dataQuality.signatureDivergence();

  check('Exactly one conflict found', divergence.length === 1, `${divergence.length} found`);
  check('It is Pre-Mest, not Grow', divergence[0]?.programName === 'Pre-Mest', divergence[0]?.programName);
  check('Grow is silent because its breakdown reconciles',
    !divergence.some((d) => d.programName === 'Grow'));
  check('The spread is reported as 2', divergence[0]?.spread === 2, String(divergence[0]?.spread));
  check('Both readings are shown', divergence[0]?.readings.length === 2,
    JSON.stringify(divergence[0]?.readings));
  check('Each reading names its basis in plain words',
    divergence[0]?.readings.some((r) => r.basis === 'Recorded programme total') &&
    divergence[0]?.readings.some((r) => r.basis.includes('gender')),
    JSON.stringify(divergence[0]?.readings.map((r) => r.basis)));
  check('Severity is an error, not a warning', divergence[0]?.severity === 'error');

  const report = await dataQuality.report();
  check('The report counts the issue', report.counts.errors === 1, JSON.stringify(report.counts));
  check('Coverage lists every reportable programme',
    report.coverage.programs.length > 0 && report.coverage.metrics.length > 0);
  check('Coverage knows Grow has recorded learners',
    report.coverage.programs.find((p) => p.pageKey === 'digital-skills-grow')?.recorded.includes('learners_total'));

  // --------------------------------------------------------- unconfigured is safe
  section('Missing credentials degrade quietly');

  check('Sheets reports itself unconfigured', sheets.isConfigured() === false);
  check('A scheduled run with no credentials is a no-op, not a crash',
    (await sheetSync.syncAll()).length === 0);

  let threw = null;
  try {
    await sheets.describe('anything');
  } catch (err) {
    threw = err;
  }
  check('A direct call explains what is missing', threw?.status === 503 && /GOOGLE_CLIENT_EMAIL/.test(threw.message),
    threw?.message);

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);

  await mongoose.disconnect();
  await mongo.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\x1b[31mVerification crashed:\x1b[0m', err);
  process.exit(1);
});
