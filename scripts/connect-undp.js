/**
 * Connects the UNDP-YAI tab.
 *
 *   node scripts/connect-undp.js [--dry-run]
 *
 * The tab is a wall of pivot tables built off one innovator database. Four of
 * them are read here, chosen because between them they cover every axis the
 * pivots actually agree on: jobs by hub, by gender, by programme stage, and by
 * hub × gender; revenue by hub; and the innovator count by hub.
 *
 * Two pivots count innovators and disagree — 141 across eight hubs, 160 across
 * nine. The second is the one read, because it is the only one that includes
 * MEST's own four innovators, and its per-hub figures are equal or higher
 * everywhere else. The 141 pivot looks like an earlier run left in place.
 *
 * The Q1 revenue pivots are deliberately not imported: Q1 revenue is part of the
 * total revenue also reported here, and the two have no period axis to keep
 * them apart, so importing both would count the same money twice.
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
const HUB_COLUMNS = [
  ['G', 'AFRIDELF'], ['H', 'Agrico Hub'], ['I', 'Behive'], ['J', 'Fab Hub Ashanti'],
  ['K', 'Green Growth Africa'], ['L', 'Innovators Up'], ['M', 'MEST'], ['N', 'SIASD'], ['O', 'Wan-Hive'],
];
const GENDER_ROWS = [[7, 'female'], [8, 'male']];

const BLOCKS = [
  tally('Jobs by programme stage', 4, 11, [dim('B', 'program_stage'), val('C', 'jobs_created')]),
  tally('Jobs by hub', 70, 78, [dim('B', 'hub'), val('C', 'jobs_created')]),
  tally('Revenue by hub', 70, 78, [dim('B', 'hub'), val('D', 'revenue')]),
  tally('Innovators by hub', 118, 126, [dim('E', 'hub'), val('F', 'enterprises_total')]),
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
    .concat(GENDER_ROWS.filter(([row, g]) => cell(`F${row}`).toLowerCase() !== g).map(([row, g]) => `F${row} is not ${g}`));
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
