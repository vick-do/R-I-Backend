/**
 * Connects the EdTech Mondays tab of the consolidated workbook.
 *
 *   node scripts/connect-edtech-mondays.js [--dry-run]
 *
 * The tab is the season's own consolidated report — "All data is automatically
 * pulled from monthly sheets", as row 2 puts it — so it is the one place the
 * figures should come from. It replaces both the 2023 season sheet that used to
 * sit here and the separate analytics workbook the dashboard was backfilled
 * from; `scripts/retire-edtech-history.js` clears those out.
 *
 * It reports the same season twice over, which is the whole point of it:
 *
 *   · down the left, by CHANNEL — MEST Africa, Citi FM, Channel One TV,
 *     Panelists — with the months running across;
 *   · down the right, by PLATFORM — YouTube, Facebook, Twitter, LinkedIn,
 *     Instagram — the same months again.
 *
 * They are two views of one season, not two seasons, so they land on separate
 * dimension signatures and are never added to each other.
 *
 * Beneath the platforms sits press coverage, whose rows are news sites rather
 * than measures. That is `article_reach`, kept apart from social reach because
 * the sheet's own summary keeps them apart, and adding them would count one
 * audience under two headings.
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
const YEAR = 2026;
const dryRun = process.argv.includes('--dry-run');

/** Months run across each half; the last column restates the row as a total. */
const season = ({ name, dimension, value, labelColumn, first, last, firstDataColumn, lastDataColumn }) => ({
  name,
  mapping: {
    layout: 'crosstab',
    fixedDimensions: { [dimension]: value },
    crosstab: {
      headerRow: 4, labelColumn,
      firstDataRow: first, lastDataRow: last,
      firstDataColumn, lastDataColumn,
      headerRole: 'period', defaultYear: YEAR,
    },
  },
});

const byChannel = (value, first, last) =>
  season({ name: `${value} — by month`, dimension: 'channel', value, labelColumn: 'A', first, last, firstDataColumn: 'B', lastDataColumn: 'L' });

const byPlatform = (value, first, last) =>
  season({ name: `${value} — by month`, dimension: 'platform', value, labelColumn: 'O', first, last, firstDataColumn: 'P', lastDataColumn: 'Z' });

const BLOCKS = [
  byChannel('mest-africa', 6, 14),
  byChannel('citi-fm', 16, 23),
  byChannel('channel-one-tv', 25, 30),
  byChannel('panelists', 32, 39),

  byPlatform('youtube', 6, 11),
  byPlatform('facebook', 13, 18),
  byPlatform('twitter', 20, 25),
  byPlatform('linkedin', 27, 32),
  byPlatform('instagram', 34, 39),

  {
    name: 'Press coverage — by month',
    mapping: {
      layout: 'crosstab',
      crosstab: {
        headerRow: 4, labelColumn: 'O',
        firstDataRow: 41, lastDataRow: 43,
        firstDataColumn: 'P', lastDataColumn: 'Z',
        headerRole: 'period', defaultYear: YEAR,
        // The rows here name news sites, not measures.
        labelRole: 'dimension', labelDimension: 'outlet', metric: 'article_reach',
      },
    },
  },
];

/** The sheet's own year-end summary, for checking the import against. */
const SUMMARY_ROWS = [
  ['posts', 51], ['impressions', 52], ['reach', 53], ['engagement', 54],
  ['reactions', 55], ['comments', 56], ['shares', 57], ['clicks', 58],
  ['video_views', 59], ['article_reach', 60],
];

const ANCHORS = [
  ['A1', '2026  CONSOLIDATED REPORT'], ['A4', 'PLATFORM'], ['B4', 'FEB'], ['L4', 'TOTAL'],
  ['O4', 'MEDIA'], ['P4', 'FEB'], ['Z4', 'TOTAL'],
  ['A5', 'MEST AFRICA'], ['A15', 'CITI FM'], ['A24', 'CHANNEL ONE TV'], ['A31', 'PANELISTS'],
  ['O5', 'YOUTUBE'], ['O12', 'FACEBOOK'], ['O19', 'TWITTER'], ['O26', 'LINKEDIN'],
  ['O33', 'INSTAGRAM'], ['O40', 'ARTICLES'], ['A49', 'SUMMARY (ALL CHANNELS)'],
];

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
