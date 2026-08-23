/**
 * Connects the GROW participants database, Summary tab — every block on it.
 *
 *   node scripts/connect-grow-summary.js [--dry-run]
 *
 * The tab stacks twenty-one unrelated tables. Two things it gets right that a
 * naive reading does not:
 *
 *   • the cohort tables carry their year in column A, so cohorts are recorded
 *     against the year they ran rather than collapsed into one all-time figure;
 *   • the male/female columns inside those tables are dimension VALUES, not
 *     metrics, so each is its own block with the gender pinned.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const Program = require('../src/models/Program.model');
const SheetSource = require('../src/models/SheetSource.model');
const User = require('../src/models/User.model');
const sheets = require('../src/services/sheets.service');
const sync = require('../src/services/sheetSync.service');

const SPREADSHEET_ID = '1NdPONRLXpyK-QJ3S8GN3hjffssF2Ac3Ukh1HZA4F8-s';
const TAB = 'Summary';
const GROW = 'digital-skills-grow';
const ALL_TIME = { periodType: 'all_time' };

const dryRun = process.argv.includes('--dry-run');
const col = (column, role, target) => ({ column, matchBy: 'letter', role, target });

/** One cell holding a programme total. */
const scalar = (name, metric, column, row) => ({
  name,
  mapping: {
    layout: 'long',
    headerRow: row - 1,
    firstDataRow: row,
    lastDataRow: row,
    defaultPeriod: ALL_TIME,
    columns: [col(column, 'metric', metric)],
  },
});

/** A label column beside a value column. */
const breakdown = (name, metric, dimension, labelColumn, valueColumn, firstRow, lastRow) => ({
  name,
  mapping: {
    layout: 'long',
    headerRow: firstRow - 1,
    firstDataRow: firstRow,
    lastDataRow: lastRow,
    defaultPeriod: ALL_TIME,
    totalRowLabels: ['Total'],
    columns: [col(labelColumn, 'dimension', dimension), col(valueColumn, 'metric', metric)],
  },
});

/**
 * A cohort table. The year comes from column A, the cohort from column B, and
 * the hub is pinned for every row.
 *
 * The table's own "Total" row is excluded rather than used as a check: it spans
 * every year at once, so it can never reconcile against rows that are now
 * correctly split by year. The divergence detector compares the cohort sum
 * against the programme total instead.
 */
const cohortTable = (name, hub, firstRow, lastRow, metricColumns, extraDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long',
    headerRow: firstRow - 1,
    firstDataRow: firstRow,
    lastDataRow: lastRow,
    fixedDimensions: { hub, ...extraDimensions },
    columns: [
      col('A', 'period'),
      col('B', 'dimension', 'cohort'),
      ...metricColumns.map(([column, target]) => col(column, 'metric', target)),
    ],
  },
});

/** Rows are metric names, columns are a dimension's values. */
const crosstab = (name, { labelColumn, headerRow, firstDataRow, lastDataRow, firstDataColumn, lastDataColumn, headerDimension, period, fixedDimensions }) => ({
  name,
  mapping: {
    layout: 'crosstab',
    defaultPeriod: period,
    ...(fixedDimensions ? { fixedDimensions } : {}),
    crosstab: {
      labelColumn, headerRow, firstDataRow, lastDataRow, firstDataColumn, lastDataColumn,
      headerRole: headerDimension ? 'dimension' : 'none',
      ...(headerDimension ? { headerDimension } : {}),
    },
  },
});

const BLOCKS = [
  // ---- headline figures, rows 3-6 -----------------------------------------
  scalar('Total learners', 'learners_total', 'A', 4),
  scalar('Total mothers', 'mothers', 'K', 4),
  scalar('Total graduates employed', 'graduates_employed', 'N', 4),
  breakdown('Learners by gender', 'learners_total', 'gender', 'D', 'E', 4, 6),
  breakdown('Learners by hub', 'learners_total', 'hub', 'H', 'I', 4, 6),
  breakdown('Mothers by hub', 'mothers', 'hub', 'O', 'P', 11, 14),
  breakdown('Employed by hub', 'graduates_employed', 'hub', 'O', 'P', 25, 27),

  // ---- Accra (Web Dev) cohorts, rows 14-19 --------------------------------
  cohortTable('Accra cohorts', 'accra', 14, 19, [
    ['C', 'learners_total'], ['F', 'mothers'], ['G', 'graduates_employed'],
  ]),
  cohortTable('Accra cohorts — male', 'accra', 14, 19, [['D', 'learners_total']], { gender: 'male' }),
  cohortTable('Accra cohorts — female', 'accra', 14, 19, [['E', 'learners_total']], { gender: 'female' }),

  // ---- Whizzy Academy (Digital Marketing) cohorts, rows 26-30 -------------
  cohortTable('Whizzy cohorts', 'whizzy-academy', 26, 30, [
    ['C', 'learners_total'], ['E', 'mothers'], ['F', 'graduates_employed'],
  ]),
  cohortTable('Whizzy cohorts — female', 'whizzy-academy', 26, 30, [['D', 'learners_total']], { gender: 'female' }),

  // ---- Woman's Haven (Digital Marketing) cohorts, rows 37-40 -------------
  cohortTable("Woman's Haven cohorts", 'womans-haven-africa', 37, 40, [
    ['C', 'learners_total'], ['E', 'mothers'], ['F', 'graduates_employed'],
  ]),
  cohortTable("Woman's Haven cohorts — female", 'womans-haven-africa', 37, 40, [['D', 'learners_total']], { gender: 'female' }),

  // ---- 2026 extension intake, rows 47-48 ----------------------------------
  // Its cohort is also numbered 1, so recording it against the year is what
  // stops it colliding with Whizzy's 2024 cohort 1.
  {
    name: '2026 extension intake',
    mapping: {
      layout: 'long',
      headerRow: 46, firstDataRow: 47, lastDataRow: 49,
      defaultPeriod: { periodType: 'year', year: 2026 },
      totalRowLabels: ['Total'],
      fixedDimensions: { cohort: '1' },
      columns: [col('B', 'dimension', 'hub'), col('C', 'metric', 'learners_total')],
    },
  },
  {
    name: '2026 extension intake — female',
    mapping: {
      layout: 'long',
      headerRow: 46, firstDataRow: 47, lastDataRow: 48,
      defaultPeriod: { periodType: 'year', year: 2026 },
      fixedDimensions: { cohort: '1', gender: 'female' },
      columns: [col('B', 'dimension', 'hub'), col('D', 'metric', 'learners_total')],
    },
  },
  {
    name: '2026 extension intake — male',
    mapping: {
      layout: 'long',
      headerRow: 46, firstDataRow: 47, lastDataRow: 48,
      defaultPeriod: { periodType: 'year', year: 2026 },
      fixedDimensions: { cohort: '1', gender: 'male' },
      columns: [col('B', 'dimension', 'hub'), col('E', 'metric', 'learners_total')],
    },
  },

  // ---- year x track summaries, right-hand blocks --------------------------
  crosstab('2024 by track', {
    labelColumn: 'I', headerRow: 11, firstDataRow: 12, lastDataRow: 13,
    firstDataColumn: 'J', lastDataColumn: 'K',
    headerDimension: 'track', period: { periodType: 'year', year: 2024 },
  }),
  crosstab('2025 by track', {
    labelColumn: 'I', headerRow: 25, firstDataRow: 26, lastDataRow: 27,
    firstDataColumn: 'J', lastDataColumn: 'K',
    headerDimension: 'track', period: { periodType: 'year', year: 2025 },
  }),

  // The "Women" column beside those blocks is deliberately not mapped. It is a
  // single figure — "of whom, women" — not a gender split, and recording it as
  // one would put an incomplete breakdown (228 of 286) in competition with the
  // complete per-cohort gender data, which already sums to the same number.
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);

  const program = await Program.findOne({ pageKey: GROW });
  if (!program) throw new Error(`Programme "${GROW}" not found — run the seed first.`);

  const description = await sheets.describe(SPREADSHEET_ID);
  console.log(`\n${description.title} › ${TAB} — ${BLOCKS.length} blocks\n`);

  const resolved = BLOCKS.map((b) => ({ name: b.name, program: program._id, mapping: b.mapping }));
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });

  const source = await SheetSource.findOneAndUpdate(
    { spreadsheetId: SPREADSHEET_ID, tabName: TAB },
    {
      spreadsheetId: SPREADSHEET_ID, tabName: TAB, spreadsheetTitle: description.title,
      program: program._id, blocks: resolved, mapping: {}, createdBy: admin?._id ?? null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });
  const plan = await sync.planBlocks({ worksheet, source, fileName: `${description.title} (live)` });

  console.log(`${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged`);

  const failed = plan.checks.filter((c) => c.status === 'fail');
  console.log(`\nReconciliation: ${plan.checks.length - failed.length}/${plan.checks.length} pass`);
  for (const c of failed) console.log(`  \x1b[31m✗\x1b[0m ${c.label}: states ${c.expected}, rows sum to ${c.actual}`);

  const errors = plan.issues.filter((i) => i.severity === 'error');
  for (const e of errors.slice(0, 8)) console.log(`  \x1b[31m✗\x1b[0m ${e.message}`);

  // What lands, grouped by the shape of its coordinate.
  const bySig = new Map();
  for (const c of plan.candidates) {
    const sig = [c.period.periodLabel, ...Object.keys(c.dimensions ?? {}).sort()].join(' · ');
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(c);
  }
  console.log('\nCoordinates it writes:');
  for (const [sig, rows] of [...bySig.entries()].sort()) {
    const total = rows.reduce((s, r) => s + r.value, 0);
    console.log(`  ${String(rows.length).padStart(3)} facts  ${sig.padEnd(42)} sum ${total}`);
  }

  if (dryRun) {
    await SheetSource.deleteOne({ _id: source._id });
    console.log('\nDry run — the source was not kept.');
  } else {
    console.log('\nConnected.');
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
