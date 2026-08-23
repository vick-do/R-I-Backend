/**
 * Connects the two roster tabs in the Data Summary spreadsheet.
 *
 *   node scripts/connect-rosters.js [--dry-run]
 *
 * Neither tab states a figure the platform can read — Hospitality states none
 * at all — so both are counted row by row.
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
const ALL_TIME = { periodType: 'all_time' };
const dryRun = process.argv.includes('--dry-run');

const TABS = [
  {
    tabName: 'Hospitality',
    program: 'digital-skills-hospitality',
    blocks: [
      {
        name: 'Applicants counted',
        mapping: {
          layout: 'roster', headerRow: 2, firstDataRow: 3,
          identityColumn: 'B', metric: 'learners_total', defaultPeriod: ALL_TIME,
        },
      },
      {
        name: 'Applicants by gender',
        mapping: {
          layout: 'roster', headerRow: 2, firstDataRow: 3,
          identityColumn: 'B', metric: 'learners_total', defaultPeriod: ALL_TIME,
          groupBy: { column: 'G', target: 'gender' },
        },
      },
    ],
  },
  {
    tabName: 'Doulogic',
    program: 'digital-skills-doulogic',
    blocks: [
      {
        name: 'Participants counted',
        mapping: {
          layout: 'roster', headerRow: 1, firstDataRow: 2,
          identityColumn: 'A', metric: 'learners_total', defaultPeriod: ALL_TIME,
          // The sheet's own tally sits at H2. It says 34 where the roster has
          // 40, so this check is expected to fail and hold the sync.
          statedTotalCells: ['H2'],
        },
      },
      {
        name: 'Participants by gender',
        mapping: {
          layout: 'roster', headerRow: 1, firstDataRow: 2,
          identityColumn: 'A', metric: 'learners_total', defaultPeriod: ALL_TIME,
          groupBy: { column: 'F', target: 'gender' },
        },
      },
    ],
  },
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const description = await sheets.describe(SPREADSHEET_ID);
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  console.log(`\n${description.title}\n`);

  for (const tab of TABS) {
    const program = await Program.findOne({ pageKey: tab.program });
    if (!program) { console.log(`  ✗ ${tab.tabName} — programme "${tab.program}" not seeded`); continue; }

    const source = await SheetSource.findOneAndUpdate(
      { spreadsheetId: SPREADSHEET_ID, tabName: tab.tabName },
      {
        spreadsheetId: SPREADSHEET_ID, tabName: tab.tabName, spreadsheetTitle: description.title,
        program: program._id, mapping: {},
        blocks: tab.blocks.map((b) => ({ name: b.name, program: program._id, mapping: b.mapping })),
        createdBy: admin?._id ?? null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: tab.tabName });
    const plan = await sync.planBlocks({ worksheet, source, fileName: `${description.title} (live)` });

    console.log(`  ${tab.tabName} → ${program.name}`);
    for (const c of plan.candidates) {
      const dims = Object.entries(c.dimensions ?? {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'overall';
      console.log(`      ${String(c.value).padStart(5)}  ${c.metric.label}  ${dims}`);
    }
    for (const c of plan.checks) {
      const mark = c.status === 'pass' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`      ${mark} states ${c.expected}, counted ${c.actual}`);
    }
    for (const i of plan.issues) console.log(`      · ${i.message}`);

    if (dryRun) await SheetSource.deleteOne({ _id: source._id });
  }

  console.log(dryRun ? '\nDry run — nothing was kept.' : '\nConnected.');
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
