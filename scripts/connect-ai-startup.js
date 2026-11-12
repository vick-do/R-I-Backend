/**
 * Connects the AI Startup 2026 tab.
 *
 *   node scripts/connect-ai-startup.js [--dry-run]
 *
 * Three things are read from it.
 *
 * Satisfaction, monthly, three times over. The sheet asks three separate
 * questions under three headings of its own: General Satisfaction (row 4),
 * Team Satisfaction (row 8) and Track Satisfaction (row 12). The first two are
 * a single series each, on rows 6 and 10; the third is a cross-tab with the
 * months across row 13 and Tech / Business / Product down column C. July
 * onward is blank on all three because the cohort is still running, and blank
 * months are simply absent rather than recorded as zero.
 *
 * The General and Team rows are both labelled plainly "Satisfaction" in column
 * C, so they are read with `labelRole: 'none'` and a fixed metric: what tells
 * them apart is the heading two rows above, which no row label repeats.
 *
 * Skill confidence, before and after — six "Learning Impact Summary" blocks
 * laid out three across and two down. Each rates a list of topics from 0 to 1,
 * before the teaching and after it, under a discipline heading written once at
 * the top of its run. The heading is carried down the run, and the topics are
 * averaged: a discipline's confidence is the mean of its topics, because thirty
 * ratings of 80% do not make 2400%.
 *
 * Individual topics are not imported. There are over two hundred of them, they
 * are free text that changes between blocks, and "Designing a Grounded Answer
 * Layout" is not an axis anything else in the system shares.
 *
 * Previously open, now settled: rows 6 and 10 used to sit under one repeated
 * "General Satisfaction" heading with nothing to tell them apart, and they
 * disagree — January reads 0.8929 on one and 0.6786 on the other. The sheet has
 * since been given its own headings for them, so they are no longer a guess:
 * the 0.8929 series is General and the 0.6786 series is Team.
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
const TAB = 'AI Startup 2026';
const PROGRAM = 'ai-startup-lab';
const YEAR = 2026;
const dryRun = process.argv.includes('--dry-run');

/**
 * The six Learning Impact blocks, laid out three across and twice down.
 *
 * Every one of them is titled "Learning Impact Summary" and nothing else on the
 * sheet names them. Their topics read as a clear progression — the first Tech
 * list is Python and GitHub, the last is caching and KPIs — so they are plainly
 * a sequence of teaching blocks, but the sheet never says which block is which,
 * and numbering them by position would put an axis on the page that the source
 * does not have.
 *
 * So they are read as six samples of one figure. A discipline's confidence is
 * the average of every topic rated for it, wherever on the page that rating
 * sits: `aggregate: 'mean'` averages the topics inside each block, and the
 * source's `mergeBlocks: 'mean'` averages the blocks with each other.
 */
const IMPACT_BLOCKS = [
  { rows: [24, 49], discipline: 'C', before: 'E', after: 'F' },
  { rows: [24, 49], discipline: 'K', before: 'M', after: 'N' },
  { rows: [24, 49], discipline: 'S', before: 'U', after: 'V' },
  { rows: [54, 84], discipline: 'C', before: 'E', after: 'F' },
  { rows: [54, 84], discipline: 'K', before: 'M', after: 'N' },
  { rows: [54, 84], discipline: 'S', before: 'U', after: 'V' },
];

const confidence = ({ rows: [first, last], discipline, before, after }, index) =>
  [['before', before], ['after', after]].map(([point, column]) => ({
    name: `Skill confidence ${point} — block ${index + 1}`,
    mapping: {
      layout: 'long',
      headerRow: 23,
      firstDataRow: first,
      lastDataRow: last,
      defaultPeriod: { periodType: 'year', year: YEAR },
      // The topics under one discipline are averaged into that discipline's
      // figure; the sheet states no such average itself.
      aggregate: 'mean',
      percentScale: 'fraction',
      columns: [
        // Written once above each run of topics, so it is carried down.
        { column: discipline, matchBy: 'letter', role: 'dimension', target: 'discipline', fillDown: true },
        { column, matchBy: 'letter', role: 'metric', target: `skill_confidence_${point}` },
      ],
    },
  }));

/**
 * The two single-row satisfaction series, each under its own heading.
 *
 * Same shape as the track cross-tab below — months across, one row of figures
 * — except that the row is the whole block, so there is no axis to put on it.
 */
const SINGLE_SERIES = [
  { name: 'General satisfaction, monthly', metric: 'satisfaction_general', heading: 4 },
  { name: 'Team satisfaction, monthly', metric: 'satisfaction_team', heading: 8 },
];

const series = ({ name, metric, heading }) => ({
  name,
  mapping: {
    layout: 'crosstab',
    percentScale: 'fraction',
    crosstab: {
      // The heading, then the month header, then the figures.
      headerRow: heading + 1, labelColumn: 'C',
      firstDataRow: heading + 2, lastDataRow: heading + 2,
      firstDataColumn: 'D', lastDataColumn: 'O',
      headerRole: 'period', defaultYear: YEAR,
      // Both rows read "Satisfaction", so the label decides nothing.
      labelRole: 'none', metric,
    },
  },
});

const BLOCKS = [
  ...SINGLE_SERIES.map(series),
  {
    name: 'Satisfaction by track, monthly',
    mapping: {
      layout: 'crosstab',
      percentScale: 'fraction',
      crosstab: {
        headerRow: 13, labelColumn: 'C',
        firstDataRow: 14, lastDataRow: 16,
        firstDataColumn: 'D', lastDataColumn: 'O',
        headerRole: 'period', defaultYear: YEAR,
        // The rows are disciplines rather than metrics, so the metric is fixed
        // for the block and the row label becomes the axis. This is the sheet's
        // "Track Satisfaction", which `satisfaction` is now labelled as.
        labelRole: 'dimension', labelDimension: 'discipline', metric: 'satisfaction',
      },
    },
  },
  ...IMPACT_BLOCKS.flatMap(confidence),
];

const ANCHORS = [
  ['C4', 'General Satisfaction'], ['C5', 'Month'], ['D5', 'January'],
  ['C8', 'Team Satisfaction'], ['C9', 'Month'], ['D9', 'January'],
  ['C12', 'Track Satisfaction'], ['C13', 'Month'], ['D13', 'January'],
  ['C14', 'Tech'], ['C15', 'Business'], ['C16', 'Product/Design'],
  ['C22', 'Learning Impact Summary'], ['C24', 'Tech'], ['E23', 'BEFORE'], ['F23', 'AFTER'],
  ['K22', 'Learning Impact Summary'], ['S22', 'Learning Impact Summary'],
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
      // The six impact blocks are samples of one figure, not six figures.
      mergeBlocks: 'mean',
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
    console.log(`  ${key}  (${rows.length})`);
    for (const c of rows.slice(0, 8)) {
      const where = [...Object.values(c.dimensions), c.period.periodLabel].join(' · ');
      console.log(`      ${where.padEnd(34)} ${c.value.toFixed(1)}%`);
    }
    if (rows.length > 8) console.log(`      … and ${rows.length - 8} more`);
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
