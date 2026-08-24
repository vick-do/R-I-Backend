/**
 * Connects the MEST Scale and MEST Express partner rosters.
 *
 *   node scripts/connect-mest-rosters.js [--dry-run]
 *
 * These two tabs replace the single "MEST Scale & Express " summary the
 * dashboard read before. That tab stated 112 enterprises but broke only 88 of
 * them down, because its pivots covered the Express rows alone — which is why
 * every breakdown on that page fell short of its own headline.
 *
 * The rosters carry one row per enterprise with the owner's sex, the business
 * size, the sector, the region and the jobs reported, so each programme's
 * figures are counted from the same rows the partner reported rather than from
 * a pivot that had drifted away from them.
 *
 * Four enterprises — Swoove, Shaq Express, Somma Life and YomYom Logistics —
 * appear in both rosters, having transitioned from Express into Scale. They are
 * counted in both because both cohorts did support them; the two programmes are
 * never summed into one figure.
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

// Column letters are stable across both tabs — they are the same partner
// reporting template, filled in twice.
const NAME = 'B';   // Enterprise Name — the identity column
const SEX = 'F';    // Enterprise Owner Sex
const SIZE = 'H';   // Enterprise Size
const JOBS = 'J';   // Total Number of Youth in Work Reported
const SECTOR = 'O';
const REGION = 'U'; // Administrative Level1

const SOURCES = [
  { tab: 'MEST Scale ', program: 'venture-support-mest-scale', firstRow: 3, lastRow: 26, expected: 24 },
  { tab: 'MEST Express', program: 'venture-support-mest-express', firstRow: 3, lastRow: 90, expected: 88 },
];

/** One block per breakdown: a roster block emits exactly one signature. */
function blocksFor({ firstRow, lastRow }) {
  const roster = (name, groupBy) => ({
    name,
    mapping: {
      layout: 'roster',
      metric: 'enterprises_total',
      identityColumn: NAME,
      firstDataRow: firstRow,
      lastDataRow: lastRow,
      defaultPeriod: ALL_TIME,
      ...(groupBy ? { groupBy } : {}),
    },
  });

  // Jobs are summed from a column rather than counted from rows, so they use
  // the long reader with duplicate coordinates merged.
  const jobs = (name, dimensionColumn, target) => ({
    name,
    mapping: {
      layout: 'long',
      headerRow: 1,
      firstDataRow: firstRow,
      lastDataRow: lastRow,
      defaultPeriod: ALL_TIME,
      aggregate: 'sum',
      columns: [
        ...(dimensionColumn ? [{ column: dimensionColumn, matchBy: 'letter', role: 'dimension', target }] : []),
        { column: JOBS, matchBy: 'letter', role: 'metric', target: 'jobs_created' },
      ],
    },
  });

  return [
    roster('Enterprises supported', null),
    roster('Enterprises by owner gender', { column: SEX, target: 'gender' }),
    roster('Enterprises by size', { column: SIZE, target: 'enterprise_stage' }),
    roster('Enterprises by sector', { column: SECTOR, target: 'sector' }),
    roster('Enterprises by region', { column: REGION, target: 'region' }),
    jobs('Jobs reported', null),
    jobs('Jobs by owner gender', SEX, 'gender'),
    jobs('Jobs by sector', SECTOR, 'sector'),
    jobs('Jobs by region', REGION, 'region'),
  ];
}

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  const description = await sheets.describe(SPREADSHEET_ID);

  for (const spec of SOURCES) {
    const program = await Program.findOne({ pageKey: spec.program });
    if (!program) throw new Error(`Programme "${spec.program}" not found.`);

    const blocks = blocksFor(spec);
    const source = await SheetSource.findOneAndUpdate(
      { spreadsheetId: SPREADSHEET_ID, tabName: spec.tab },
      {
        spreadsheetId: SPREADSHEET_ID, tabName: spec.tab, spreadsheetTitle: description.title,
        program: program._id, mapping: {},
        blocks: blocks.map((b) => ({ name: b.name, program: program._id, mapping: b.mapping })),
        createdBy: admin?._id ?? null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const worksheet = await sheets.loadWorksheet({ spreadsheetId: SPREADSHEET_ID, tabName: spec.tab });
    const plan = await sync.planBlocks({ worksheet, source, fileName: `${description.title} (live)` });

    console.log(`\n${'='.repeat(64)}\n${program.name}  ←  "${spec.tab}"`);
    console.log(`${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged`);

    const show = (label, dim, metricKey) => {
      const rows = plan.candidates.filter(
        (c) => c.metric.key === metricKey && (dim ? c.dimensions[dim] : Object.keys(c.dimensions).length === 0)
      );
      if (!rows.length) return;
      const total = rows.reduce((s, c) => s + c.value, 0);
      const detail = dim
        ? [...rows].sort((a, b) => b.value - a.value).map((c) => `${c.dimensions[dim]} ${c.value}`).join(', ')
        : String(total);
      console.log(`  ${label.padEnd(26)} ${String(total).padStart(6)}   ${dim ? detail : ''}`);
    };

    show('Enterprises', null, 'enterprises_total');
    for (const d of ['gender', 'enterprise_stage', 'sector', 'region']) show(`  by ${d}`, d, 'enterprises_total');
    show('Jobs reported', null, 'jobs_created');
    for (const d of ['gender', 'sector', 'region']) show(`  by ${d}`, d, 'jobs_created');

    const counted = plan.candidates.find(
      (c) => c.metric.key === 'enterprises_total' && Object.keys(c.dimensions).length === 0
    )?.value;
    console.log(`  ${counted === spec.expected ? '✓' : '✗'} roster counts ${counted}, the sheet states ${spec.expected}`);
    for (const i of plan.issues.slice(0, 6)) console.log(`  · ${i.severity}: ${i.message}`);

    if (dryRun) await SheetSource.deleteOne({ _id: source._id });
  }

  console.log(dryRun ? '\nDry run — no sources were kept.\n' : '\nConnected.\n');
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
