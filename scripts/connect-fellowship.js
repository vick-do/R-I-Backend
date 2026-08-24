/**
 * Connects the Fellowship tab — the Mastercard Foundation EdTech Fellowship
 * master dashboard.
 *
 *   node scripts/connect-fellowship.js [--dry-run]
 *
 * This is the tab that finally answers one of the Overview's headline questions.
 * "Learners impacted with EdTech solutions" has read "not yet recorded" since
 * the dashboard was built; the fellowship reports 823,776 of them.
 *
 * Every figure here is a single cell in a two-column list, so each is read on
 * its own row rather than as a range — the list mixes counts, currency, free
 * text and section headings, and only some of the rows are figures at all.
 *
 * The reach figures are apportioned rather than counted, which is why several
 * arrive fractional. They are stored as the sheet reports them; rounding on
 * import would quietly disagree with the source.
 *
 * Not imported, and worth knowing about:
 *   · the per-company learner counts (F12:H47) — the company is not an axis the
 *     catalog has, and 36 one-company figures would not read as a chart
 *   · the programme targets (F53:H64) — the system records what happened, and
 *     has nowhere yet to record what was aimed for
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
const TAB = 'Fellowship';
const PROGRAM = 'venture-support-edtech-fellowship';
const ALL_TIME = { periodType: 'all_time' };
const dryRun = process.argv.includes('--dry-run');

const val = (column, metric) => ({ column, matchBy: 'letter', role: 'metric', target: metric });
const dim = (column, target) => ({ column, matchBy: 'letter', role: 'dimension', target });

/** One figure, at one cell, on one row. */
const cell = (name, row, column, metric, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: row, lastDataRow: row,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions,
    columns: [val(column, metric)],
  },
});

/** A run of rows where one column names the value and another holds the figure. */
const run = (name, first, last, labelColumn, target, valueColumn, metric, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: first, lastDataRow: last,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions,
    columns: [dim(labelColumn, target), val(valueColumn, metric)],
  },
});

const GENDER = { 'Number of males': 'male', 'Number of females': 'female' };

const BLOCKS = [
  // ---- the fellowship's ventures -----------------------------------------
  cell('Companies in the fellowship', 3, 'F', 'enterprises_total'),
  run('Companies by cohort', 7, 9, 'E', 'cohort', 'G', 'enterprises_total'),

  // ---- who the solutions reach -------------------------------------------
  cell('Users and customers', 2, 'C', 'users_reached'),
  cell('Users — male', 3, 'C', 'users_reached', { gender: 'male' }),
  cell('Users — female', 4, 'C', 'users_reached', { gender: 'female' }),
  cell('Users — undisclosed', 5, 'C', 'users_reached', { gender: 'undisclosed' }),

  cell('Learners reached', 9, 'C', 'edtech_learners_impacted'),
  cell('Learners — male', 10, 'C', 'edtech_learners_impacted', { gender: 'male' }),
  cell('Learners — female', 11, 'C', 'edtech_learners_impacted', { gender: 'female' }),
  cell('Learners — undisclosed', 12, 'C', 'edtech_learners_impacted', { gender: 'undisclosed' }),

  cell('Educators trained', 30, 'C', 'educators_trained'),
  cell('Educators trained — male', 31, 'C', 'educators_trained', { gender: 'male' }),
  cell('Educators trained — female', 32, 'C', 'educators_trained', { gender: 'female' }),
  cell('Educators trained — undisclosed', 33, 'C', 'educators_trained', { gender: 'undisclosed' }),

  // ---- reach and partnerships --------------------------------------------
  cell('Learning institutions reached', 40, 'C', 'institutions_reached'),
  cell('Partnerships formed', 42, 'C', 'partnerships'),

  // ---- the ventures as employers -----------------------------------------
  cell('Employees hired', 54, 'C', 'employees_hired'),
  cell('Employees hired — women', 55, 'C', 'employees_hired', { gender: 'female' }),
  cell('Monthly revenue', 53, 'C', 'monthly_revenue'),
];

/** What each block's cell should still say, so a restructured sheet is caught. */
const ANCHORS = [
  ['B2', 'Total Number of users'], ['B9', 'Total Number of learners'],
  ['B30', 'Educators (teachers) trained'], ['B42', 'Partnerships formed'],
  ['B54', 'Employees hired'], ['B53', 'Monthly revenue (GHS)'],
  ['E3', 'Total Companies'], ['B3', 'Number of males'], ['B4', 'Number of females'],
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found.`);

  const description = await sheets.describe(SPREADSHEET_ID);
  const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });
  const read = (a) => { const c = worksheet.getCell(a); return String((c && typeof c === 'object' ? c.value ?? c.text : c) ?? '').trim(); };

  const drift = ANCHORS.filter(([a, text]) => read(a) !== text).map(([a, text]) => `${a} reads "${read(a)}", expected "${text}"`);
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
          .map((c) => `${Object.values(c.dimensions).join('/')} ${Math.round(c.value).toLocaleString()}`).join(', ')
      : '';
    console.log(`  ${key.padEnd(38)} ${Math.round(total).toLocaleString().padStart(12)}   ${detail}`);
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
