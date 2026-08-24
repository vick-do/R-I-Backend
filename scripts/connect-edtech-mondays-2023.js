/**
 * Connects the 2023 season of EdTech Mondays.
 *
 *   node scripts/connect-edtech-mondays-2023.js [--dry-run]
 *
 * The dashboard has only ever held the 2026 months, recorded per channel. This
 * tab is the 2023 season, and it is finer: each channel is broken out by the
 * platform it ran on, so a figure lands on {channel, platform} rather than on
 * {channel} alone. The two seasons therefore never share a coordinate, and the
 * year filter keeps them apart on the page.
 *
 * Each platform block is its own cross-tab: the months run across row 4 and the
 * measures down column C, which is exactly the shape the cross-tab reader wants.
 *
 * Two rows are deliberately left out. MEST LinkedIn reports an engagement rate
 * of "0.4135" and a click-through rate of "0.1777" with no unit anywhere on the
 * sheet, and 41% and 0.41% are both defensible readings of the same cell. A
 * figure that could be off by a hundredfold is worse than an absent one, so
 * those two rows stay out until the sheet says which it means. The Pulse
 * Website block is out for the same kind of reason — page views and an average
 * session time are not measures this catalog has.
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
const TAB = 'EdTech Mondays ';
const PROGRAM = 'ecosystem-edtech-mondays';
const dryRun = process.argv.includes('--dry-run');

/** Months run D–M across row 4; N restates the row as a total. */
const season = (name, first, last, channel, platform) => ({
  name,
  mapping: {
    layout: 'crosstab',
    fixedDimensions: { channel, platform },
    crosstab: {
      headerRow: 4, labelColumn: 'C',
      firstDataRow: first, lastDataRow: last,
      firstDataColumn: 'D', lastDataColumn: 'N',
      headerRole: 'period', defaultYear: 2023,
    },
  },
});

const BLOCKS = [
  season('MEST Facebook', 6, 14, 'mest-africa', 'facebook'),
  // Split around rows 19 and 22 — the two rate rows whose unit the sheet never states.
  season('MEST LinkedIn — volume', 17, 18, 'mest-africa', 'linkedin'),
  season('MEST LinkedIn — clicks and reactions', 20, 21, 'mest-africa', 'linkedin'),
  season('MEST LinkedIn — comments and reposts', 23, 24, 'mest-africa', 'linkedin'),
  season('MEST YouTube', 27, 29, 'mest-africa', 'youtube'),
  season('Citi FM Facebook', 32, 37, 'citi-fm', 'facebook'),
  season('Citi FM Twitter', 40, 43, 'citi-fm', 'twitter'),
  season('Citi FM Instagram', 46, 49, 'citi-fm', 'instagram'),
  season('Citi FM YouTube', 52, 54, 'citi-fm', 'youtube'),
];

const ANCHORS = [
  ['C5', 'MEST Facebook'], ['C16', 'MEST Linkedin'], ['C26', 'MEST YouTube'],
  ['C31', 'Citi FM Facebook'], ['C39', 'Citi FM Twitter'], ['C45', 'Citi FM Instagram'],
  ['C51', 'Citi FM Youtube'], ['D4', 'Feb'], ['M4', 'Nov'], ['N4', 'Total'],
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found.`);

  const description = await sheets.describe(SPREADSHEET_ID);
  const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: TAB });
  const read = (a) => { const c = worksheet.getCell(a); return String((c && typeof c === 'object' ? c.value ?? c.text : c) ?? '').trim(); };

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

  const plan = await sync.planBlocks({ worksheet, source, fileName: `${description.title} (live)` });

  console.log(`\n${description.title} › ${TAB} → ${program.name}`);
  console.log(`${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged\n`);

  const byMetric = new Map();
  for (const c of plan.candidates) {
    const k = c.metric.key;
    byMetric.set(k, (byMetric.get(k) ?? 0) + c.value);
  }
  const months = new Set(plan.candidates.map((c) => c.period.periodLabel));
  console.log(`  ${plan.candidates.length} figures across ${months.size} months and ${new Set(plan.candidates.map((c) => `${c.dimensions.channel}/${c.dimensions.platform}`)).size} channel-platform pairs`);
  for (const [k, v] of [...byMetric].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${Math.round(v).toLocaleString().padStart(12)}`);
  }
  const failed = plan.checks.filter((c) => c.status !== 'pass');
  console.log(`\n  ${plan.checks.length - failed.length}/${plan.checks.length} of the sheet's own row totals reconcile`);
  for (const c of failed.slice(0, 8)) console.log(`   ✗ ${c.label}: states ${c.expected}, months sum to ${c.actual}`);
  for (const i of plan.issues.slice(0, 6)) console.log(`  · ${i.severity}: ${i.message}`);

  if (dryRun) {
    await SheetSource.deleteOne({ _id: source._id });
    console.log('\nDry run — the source was not kept.');
  } else {
    console.log('\nConnected.');
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
