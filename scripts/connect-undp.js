/**
 * Connects the UNDP-YAI tab.
 *
 *   node scripts/connect-undp.js [--dry-run]
 *
 * The tab is a wall of pivot tables built off one innovator database. What it
 * reports is jobs and revenue: jobs by hub, by gender, by programme stage and
 * by hub × gender — all four agreeing at 1,372 — and total revenue by hub.
 *
 * It used to carry two pivots counting innovators, and this script used to read
 * one of them as `enterprises_total`. Both have since been deleted from the
 * sheet, which now ends at row 100. The programme therefore states no count of
 * the ventures it supports, and none is recorded: an enterprise figure with
 * nothing behind it is worse than an absent one. If that count is wanted back,
 * it needs to come back to the sheet first.
 *
 * Also not imported, deliberately:
 *   · the Q1 revenue pivots — Q1 revenue is part of the total revenue reported
 *     here, and the two have no period axis to keep them apart, so importing
 *     both would count the same money twice;
 *   · the per-stage jobs pivots repeated at rows 15–25 and 30–40, which restate
 *     rows 4–11 broken out by hub. Reading them as well would put the same
 *     1,372 jobs on a third axis for no gain;
 *   · the Direct Jobs table at rows 96–100, which the sheet cuts off after four
 *     of its nine hubs.
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
const TAB = 'UNDP-YAI';
const PROGRAM = 'venture-support-undp';
const ALL_TIME = { periodType: 'all_time' };
const dryRun = process.argv.includes('--dry-run');

const dim = (column, target) => ({ column, matchBy: 'letter', role: 'dimension', target });
const val = (column, metric) => ({ column, matchBy: 'letter', role: 'metric', target: metric });
const tally = (name, first, last, columns, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: first, lastDataRow: last,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions, columns,
  },
});

// The hub axis of the gender pivot runs across columns G–O of row 6, in this
// order. Checked against the sheet's own header row before anything is written.
/**
 * A cell inside each block, checked before anything is written.
 *
 * Every one of these sits in a range a block reads, so a table that moves or is
 * deleted is caught here by name rather than discovered later as a figure that
 * quietly stopped changing.
 */
const ANCHOR_CELLS = [
  ['B3', 'Stage'], ['C3', 'SUM of Total Jobs'], ['B4', '1 Cohort 1'], ['B11', '3 Pilot'],
  ['F5', 'SUM of Total Jobs'], ['G5', 'Hub'], ['F6', 'Gender'], ['P6', 'Grand Total'],
  ['B69', 'Hub'], ['C69', 'SUM of Total Jobs'], ['D69', 'SUM of Total Revenue'],
  ['B70', 'AFRIDELF'], ['B78', 'Wan-Hive'],
];

const HUB_COLUMNS = [
  ['G', 'AFRIDELF'], ['H', 'Agrico Hub'], ['I', 'Behive'], ['J', 'Fab Hub Ashanti'],
  ['K', 'Green Growth Africa'], ['L', 'Innovators Up'], ['M', 'MEST'], ['N', 'SIASD'], ['O', 'Wan-Hive'],
];
const GENDER_ROWS = [[7, 'female'], [8, 'male']];

const BLOCKS = [
  tally('Jobs by programme stage', 4, 11, [dim('B', 'program_stage'), val('C', 'jobs_created')]),
  tally('Jobs by hub', 70, 78, [dim('B', 'hub'), val('C', 'jobs_created')]),
  tally('Revenue by hub', 70, 78, [dim('B', 'hub'), val('D', 'revenue')]),
  ...GENDER_ROWS.map(([row, gender]) =>
    tally(`Jobs — ${gender}`, row, row, [val('P', 'jobs_created')], { gender })),

  // The hub × gender cross. One block per cell, because the hubs run across the
  // columns while the genders run down the rows, and the readers all walk rows.
  ...GENDER_ROWS.flatMap(([row, gender]) =>
    HUB_COLUMNS.map(([column, hub]) =>
      tally(`Jobs — ${gender}, ${hub}`, row, row, [val(column, 'jobs_created')],
        { gender, hub: hub.toLowerCase().replace(/[^a-z0-9]+/g, '-') }))),
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found.`);

  const description = await sheets.describe(SPREADSHEET_ID);
  const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });

  // The cell addresses above are fixed, so the sheet is asked to confirm they
  // still mean what they meant when they were written.
  const cell = (a) => { const c = worksheet.getCell(a); return String((c && typeof c === 'object' ? c.value ?? c.text : c) ?? '').trim(); };
  const drift = HUB_COLUMNS.filter(([col, hub]) => cell(`${col}6`) !== hub)
    .map(([col, hub]) => `${col}6 reads "${cell(`${col}6`)}", expected "${hub}"`)
    .concat(GENDER_ROWS.filter(([row, g]) => cell(`F${row}`).toLowerCase() !== g).map(([row, g]) => `F${row} is not ${g}`))
    .concat(ANCHOR_CELLS.filter(([a, t]) => cell(a) !== t).map(([a, t]) => `${a} reads "${cell(a)}", expected "${t}"`));
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
    const detail = rows.length > 1 && rows.length <= 10
      ? [...rows].sort((a, b) => b.value - a.value)
          .map((c) => `${Object.values(c.dimensions).join('/')} ${c.value}`).join(', ')
      : `${rows.length} coordinates`;
    console.log(`  ${key.padEnd(38)} ${String(total).padStart(9)}   ${detail}`);
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
