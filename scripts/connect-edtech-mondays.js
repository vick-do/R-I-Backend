/**
 * Connects the EdTech Mondays tab of the consolidated workbook.
 *
 *   node scripts/connect-edtech-mondays.js [--dry-run]
 *
 * The tab, the blocks read from it and the anchors that guard them all live
 * in `src/seeds/edtechMondays.js`, which documents the shape of the sheet.
 * This script is the one-time connect: it checks the anchors, registers the
 * source so the scheduled sync owns it from then on, and prints what a first
 * read would write.
 *
 * It replaces both the 2023 season sheet that used to sit here and the
 * separate analytics workbook the dashboard was backfilled from;
 * `scripts/retire-edtech-history.js` clears those out.
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

const {
  SPREADSHEET_ID, TAB, PROGRAM, BLOCKS, SUMMARY_ROWS, ANCHORS,
} = require('../src/seeds/edtechMondays');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found.`);

  const description = await sheets.describe(SPREADSHEET_ID);
  const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });
  const read = (a) => { const c = worksheet.getCell(a); return String((c && typeof c === 'object' ? c.value ?? c.text : c) ?? '').trim(); };
  const num = (a) => { const c = worksheet.getCell(a); const v = c && typeof c === 'object' ? c.value : c; return typeof v === 'number' ? v : null; };

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
      // The season is still running, so the page re-reads it as it is opened.
      refreshIntervalMinutes: 5,
      createdBy: admin?._id ?? null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const plan = await sync.planBlocks({ worksheet, source, fileName: `${description.title} (live)` });

  console.log(`\n${description.title} › ${TAB} → ${program.name}`);
  console.log(`${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged\n`);

  const months = new Set(plan.candidates.map((c) => c.period.periodLabel));
  const channels = new Set(plan.candidates.filter((c) => c.dimensions.channel).map((c) => c.dimensions.channel));
  const platforms = new Set(plan.candidates.filter((c) => c.dimensions.platform).map((c) => c.dimensions.platform));
  console.log(`  ${plan.candidates.length} figures · ${months.size} months · ${channels.size} channels · ${platforms.size} platforms\n`);

  // The channel view and the platform view describe the same season, so each
  // should reach the sheet's own year-end summary on its own.
  console.log('  metric            summary   by channel   by platform');
  for (const [key, row] of SUMMARY_ROWS) {
    const stated = num(`B${row}`);
    const sum = (pick) => plan.candidates
      .filter((c) => c.metric.key === key && pick(c.dimensions))
      .reduce((t, c) => t + c.value, 0);
    const ch = sum((d) => Boolean(d.channel));
    const pf = sum((d) => Boolean(d.platform) || Boolean(d.outlet));
    const mark = (v) => (v === 0 ? '·'.padStart(11) : (v === stated ? '✓ ' : '✗ ') + String(v).padStart(9));
    console.log(`  ${key.padEnd(16)} ${String(stated ?? '—').padStart(9)} ${mark(ch)} ${mark(pf)}`);
  }

  const failed = plan.checks.filter((c) => c.status !== 'pass');
  console.log(`\n  ${plan.checks.length - failed.length}/${plan.checks.length} of the sheet's own row totals reconcile`);
  for (const c of failed.slice(0, 6)) console.log(`   ✗ ${c.label}: states ${c.expected}, months sum to ${c.actual}`);
  for (const i of plan.issues.slice(0, 6)) console.log(`  · ${i.severity}: ${i.message}`);

  if (dryRun) {
    await SheetSource.deleteOne({ _id: source._id });
    console.log('\nDry run — the source was not kept.');
  } else {
    console.log('\nConnected.');
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
