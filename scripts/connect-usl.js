/**
 * Connects the USL tab.
 *
 *   node scripts/connect-usl.js [--dry-run]
 *
 * The tab is a set of small tallies laid out side by side across the top of the
 * sheet, plus a cohort table further down that is written out once per cohort
 * with its own header row. Each tally becomes its own block, because each one
 * counts the same 122 startups along a different axis.
 *
 * Several of those axes cover fewer than 122: gender and status describe 102,
 * portfolio type 98, sector 93. That is the sheet's own coverage, not an import
 * error — the Data quality page reports the shortfall rather than the import
 * inventing rows to close it.
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

const SPREADSHEET_ID = '1g_XYCeCXCM5z6O7DELzZ4bQi-SX-JNpPGh1CnoIC0VE';
const TAB = 'USL';
const PROGRAM = 'venture-support-usl';
const ALL_TIME = { periodType: 'all_time' };
const dryRun = process.argv.includes('--dry-run');

const dim = (column, target) => ({ column, matchBy: 'letter', role: 'dimension', target });
const val = (column, metric) => ({ column, matchBy: 'letter', role: 'metric', target: metric });

/** A tally of `metric` down one pair of columns. */
const tally = (name, first, last, columns, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: first, lastDataRow: last,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions, columns,
  },
});

// The cohort table repeats its header once per cohort, so the six figures sit on
// six scattered rows rather than in one run. Each is read on its own, and each
// is checked below against the label the sheet writes beside it — cohort 6 has
// already moved down a row once, and a mapping addressing cells by number finds
// nothing rather than failing when that happens.
const COHORT_ROWS = { 1: 30, 2: 35, 3: 40, 4: 45, 5: 49, 6: 53 };

const BLOCKS = [
  tally('Startups supported', 2, 2, [val('B', 'enterprises_total')]),
  tally('By founder gender', 3, 4, [dim('H', 'gender'), val('I', 'enterprises_total')]),
  tally('By current status', 3, 5, [dim('L', 'venture_status'), val('M', 'enterprises_total')]),
  tally('By product stage', 3, 7, [dim('O', 'venture_stage'), val('P', 'enterprises_total')]),
  tally('By sector', 12, 23, [dim('A', 'sector'), val('B', 'enterprises_total')]),
  tally('By open-source status', 11, 13, [dim('L', 'open_source'), val('M', 'enterprises_total')]),
  tally('Employees by contract', 12, 13, [dim('H', 'employment_type'), val('I', 'employees_hired')]),
  tally('Users and customers', 14, 14, [val('E', 'users_reached')]),
  tally('Schools reached', 12, 12, [val('E', 'institutions_reached')]),

  ...Object.entries(COHORT_ROWS).map(([cohort, row]) =>
    tally(`Cohort ${cohort}`, row, row, [val('B', 'enterprises_total')], { cohort })),
  // Cohort 6's founders are not split by gender in the sheet, so it has no
  // gender row here either.
  ...Object.entries(COHORT_ROWS).filter(([c]) => c !== '6').flatMap(([cohort, row]) => [
    tally(`Cohort ${cohort} — male founders`, row, row, [val('C', 'enterprises_total')], { cohort, gender: 'male' }),
    tally(`Cohort ${cohort} — female founders`, row, row, [val('D', 'enterprises_total')], { cohort, gender: 'female' }),
  ]),
];

/** A cell inside each block, so a table that moves is caught by name. */
const ANCHORS = [
  ['A2', 'Total Startups'], ['H2', 'Gender Breakdown of Co-founders'],
  ['L2', 'Cuurent Status'], ['O2', 'Portfolio Type'],
  ['H3', 'Female'], ['H4', 'Male'], ['L3', 'Active'], ['O3', 'Scaling'],
  ['A11', 'Industry/ Sector'], ['A12', 'Health & Nutrition'], ['A23', 'Skills, Employment & Human Capital'],
  ['H11', 'Employees Count'], ['H12', 'Full time'], ['H13', 'Part time'],
  ['D12', 'Schools'], ['D14', 'Total Users/Customers'],
  ['L11', 'Yes'], ['L12', 'No'], ['L13', 'N/A'],
  ...Object.entries(COHORT_ROWS).map(([cohort, row]) => [`A${row}`, `Cohort ${cohort}`]),
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found.`);

  const description = await sheets.describe(SPREADSHEET_ID);
  const probe = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });
  const read = (a) => { const c = probe.getCell(a); return String((c && typeof c === 'object' ? c.value ?? c.text : c) ?? '').trim(); };

  const drift = ANCHORS.filter(([a, t]) => read(a) !== t).map(([a, t]) => `${a} reads "${read(a)}", expected "${t}"`);
  if (drift.length) {
    console.error('The sheet has been restructured — stopping rather than importing into the wrong coordinates:');
    drift.forEach((d) => console.error(`  · ${d}`));
    process.exit(1);
  }

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });

  const source = await SheetSource.findOneAndUpdate(
    { spreadsheetId: SPREADSHEET_ID, tabName: TAB },
    {
      spreadsheetId: SPREADSHEET_ID, tabName: TAB, spreadsheetTitle: description.title,
      program: program._id, mapping: {},
      blocks: BLOCKS.map((b) => ({ name: b.name, program: program._id, mapping: b.mapping })),
      createdBy: admin?._id ?? null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });
  const plan = await sync.planBlocks({ worksheet, source, fileName: `${description.title} (live)` });

  console.log(`\n${description.title} › ${TAB} → ${program.name}`);
  console.log(`${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged\n`);

  const groups = new Map();
  for (const c of plan.candidates) {
    const key = `${c.metric.key} by ${Object.keys(c.dimensions).sort().join(' × ') || '(total)'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const [key, rows] of [...groups].sort()) {
    const total = rows.reduce((s, c) => s + c.value, 0);
    const detail = rows.length > 1
      ? [...rows].sort((a, b) => b.value - a.value)
          .map((c) => `${Object.values(c.dimensions).join('/')} ${c.value}`).join(', ')
      : '';
    console.log(`  ${key.padEnd(42)} ${String(total).padStart(8)}   ${detail}`);
  }
  for (const i of plan.issues.slice(0, 8)) console.log(`  · ${i.severity}: ${i.message}`);

  if (dryRun) {
    await SheetSource.deleteOne({ _id: source._id });
    console.log('\nDry run — the source was not kept.');
  } else {
    console.log('\nConnected.');
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
