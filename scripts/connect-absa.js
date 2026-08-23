/**
 * Connects the Absa tab — female entrepreneurs by region and district.
 *
 *   node scripts/connect-absa.js [--dry-run]
 *
 * The region is written once above each run of districts, and many districts
 * share one region, so this block relies on both fill-down and summing.
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
const TAB = 'Absa';
const PROGRAM = 'venture-support-absa';
const ALL_TIME = { periodType: 'all_time' };
const dryRun = process.argv.includes('--dry-run');
const col = (column, role, target, extra = {}) => ({ column, matchBy: 'letter', role, target, ...extra });

const BLOCKS = [
  {
    name: 'Female entrepreneurs by region',
    mapping: {
      layout: 'long',
      headerRow: 1,
      firstDataRow: 2,
      lastDataRow: 72,
      defaultPeriod: ALL_TIME,
      // Every entrepreneur in this sheet is a woman; the column header says so
      // rather than any row.
      fixedDimensions: { gender: 'female' },
      aggregate: 'sum',
      // The sheet's own total, seven rows below the last district.
      statedTotalCells: ['C79'],
      columns: [
        col('A', 'dimension', 'region', { fillDown: true }),
        col('C', 'metric', 'enterprises_total'),
      ],
    },
  },
  {
    name: 'Female entrepreneurs by district',
    mapping: {
      layout: 'long',
      headerRow: 1,
      firstDataRow: 2,
      lastDataRow: 72,
      defaultPeriod: ALL_TIME,
      fixedDimensions: { gender: 'female' },
      aggregate: 'sum',
      columns: [
        col('B', 'dimension', 'district'),
        col('C', 'metric', 'enterprises_total'),
      ],
    },
  },
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);

  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found.`);

  const description = await sheets.describe(SPREADSHEET_ID);
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

  const byRegion = plan.candidates.filter((c) => c.dimensions.region);
  const byDistrict = plan.candidates.filter((c) => c.dimensions.district);

  console.log(`By region (${byRegion.length}):`);
  for (const c of [...byRegion].sort((a, b) => b.value - a.value)) {
    console.log(`   ${String(c.value).padStart(4)}  ${c.dimensions.region}`);
  }
  console.log(`   ${String(byRegion.reduce((s, c) => s + c.value, 0)).padStart(4)}  TOTAL`);
  console.log(`\nBy district: ${byDistrict.length} districts, ${byDistrict.reduce((s, c) => s + c.value, 0)} total`);

  for (const c of plan.checks) {
    console.log(`   ${c.status === 'pass' ? '✓' : '✗'} states ${c.expected}, rows sum to ${c.actual}`);
  }
  for (const i of plan.issues.slice(0, 5)) console.log(`   · ${i.severity}: ${i.message}`);

  if (dryRun) {
    await SheetSource.deleteOne({ _id: source._id });
    console.log('\nDry run — the source was not kept.');
  } else {
    console.log('\nConnected.');
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
