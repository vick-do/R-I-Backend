/**
 * Re-reads the Fellowship tab and writes what it now says.
 *
 *   node scripts/backfill-fellowship.js [--dry-run]
 *
 * The same stopgap as `backfill-edtech-mondays.js`, for the same reason: the
 * scheduled sync owns this tab but reads through the service account, and where
 * `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` are unset every run fails and
 * the page keeps serving whatever was last read.
 *
 * This reads the same tab through the spreadsheet's published link, which needs
 * no credentials, and hands the cells to the ordinary import pipeline: the
 * blocks from `src/seeds/fellowship.js`, the same anchor check, the same
 * reversible batch. Only the transport differs.
 *
 * Configure the credentials, run connect-fellowship.js, and delete this.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const SheetSource = require('../src/models/SheetSource.model');
const ImportBatch = require('../src/models/ImportBatch.model');
const User = require('../src/models/User.model');
const sheets = require('../src/services/sheets.service');
const sync = require('../src/services/sheetSync.service');
const imports = require('../src/services/import.service');

const { SPREADSHEET_ID, TAB, ANCHORS, TARGETS } = require('../src/seeds/fellowship');
const Metric = require('../src/models/Metric.model');
const Target = require('../src/models/Target.model');
const { buildPeriod } = require('../src/utils/period');
const { buildDimensionFields } = require('../src/utils/dimensions');

const dryRun = process.argv.includes('--dry-run');

/**
 * The parts of the tab that hold data, each as a run of consecutive rows.
 *
 * The export drops blank rows, which for a mapping built out of row numbers
 * would shift a learner count into an educator's metric without anything
 * looking wrong. So the rows come in runs containing no blank row, and each
 * run's length is checked on arrival.
 *
 * It also types a column by the data under it and returns null for anything
 * that does not fit, so a header row inside a range of numbers comes back
 * empty. Nothing here reads a header, and column B is text throughout, so the
 * two halves are fetched whole.
 */
const RUNS = [
  // Row 52 is blank in columns A-C (the targets table beside it starts there),
  // and E4 separates the cohort summary from the cohort breakdown.
  { range: 'A1:C51', firstRow: 1, firstColumn: 1, rows: 51 },
  { range: 'A53:C58', firstRow: 53, firstColumn: 1, rows: 6 },
  { range: 'E2:H3', firstRow: 2, firstColumn: 5, rows: 2 },
  { range: 'E5:H9', firstRow: 5, firstColumn: 5, rows: 5 },
  // The per-company table's column totals: learners in 2024 and in 2025.
  { range: 'E48:H48', firstRow: 48, firstColumn: 5, rows: 1 },
  // The two target tables, with E58 blank between them.
  { range: 'E51:G57', firstRow: 51, firstColumn: 5, rows: 7 },
  { range: 'E59:G64', firstRow: 59, firstColumn: 5, rows: 6 },
];

const COLUMNS = 8;
const ROWS = 64;

/** One run of rows, as the published link returns them. */
async function fetchRun({ range, rows }) {
  const url =
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq` +
    `?tqx=out:json&sheet=${encodeURIComponent(TAB)}&headers=0&range=${range}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${range}: the published link answered ${response.status}.`);

  const body = await response.text();
  const open = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (open === -1 || close === -1) throw new Error(`${range}: no JSON in the reply.`);

  const payload = JSON.parse(body.slice(open, close + 1));
  if (payload.status !== 'ok') {
    throw new Error(`${range}: ${payload.errors?.[0]?.detailed_message ?? 'the link refused the range'}.`);
  }

  const returned = payload.table?.rows ?? [];
  if (returned.length !== rows) {
    throw new Error(
      `${range}: expected ${rows} rows and got ${returned.length}. A row has been added or removed, ` +
        'so the blocks would land on the wrong figures. Check the tab before importing.'
    );
  }

  return returned;
}

/** The whole tab as a grid, with every cell at its own address. */
async function loadGrid() {
  const grid = Array.from({ length: ROWS }, () => new Array(COLUMNS).fill(null));

  for (const run of RUNS) {
    const returned = await fetchRun(run);
    returned.forEach((row, index) => {
      (row.c ?? []).forEach((cell, offset) => {
        grid[run.firstRow - 1 + index][run.firstColumn - 1 + offset] = cell?.v ?? null;
      });
    });
  }

  return grid;
}

(async () => {
  console.log(`Reading ${TAB} through the published link…`);
  const grid = await loadGrid();

  await mongoose.connect(env.MONGODB_URI);

  const source = await SheetSource.findOne({ spreadsheetId: SPREADSHEET_ID, tabName: TAB })
    .populate('program', 'pageKey name')
    .populate('blocks.program', 'pageKey name');
  if (!source) throw new Error('The tab is not connected yet. Run connect-fellowship.js first.');

  const worksheet = sheets.toWorksheet({ name: TAB, values: grid });
  const read = (a) => String(worksheet.getCell(a)?.value ?? '').trim();

  const drift = ANCHORS.filter(([cell, text]) => read(cell) !== text)
    .map(([cell, text]) => `${cell} reads "${read(cell)}", expected "${text}"`);
  if (drift.length) {
    console.error('The sheet has been restructured — stopping rather than importing into the wrong coordinates:');
    drift.forEach((d) => console.error(`  · ${d}`));
    process.exit(1);
  }

  /**
   * The blocks are read from the catalog rather than from what the source was
   * registered with, because this run is also what adds the ones the source
   * has never held — every inclusion count, both active audiences, and the
   * learning outcomes.
   */
  const { BLOCKS } = require('../src/seeds/fellowship');
  source.blocks = BLOCKS.map((b) => ({ name: b.name, program: source.program._id, mapping: b.mapping }));

  const fileName = `${source.spreadsheetTitle || 'Google Sheet'} (published link)`;
  const plan = await sync.planBlocks({ worksheet, source, fileName });

  console.log(`\n${source.spreadsheetTitle} › ${TAB} → ${source.program.name}`);
  console.log(`${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged\n`);

  const groups = new Map();
  for (const c of plan.candidates) {
    const key = `${c.metric.key} by ${Object.keys(c.dimensions).sort().join(' × ') || '(total)'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const [key, rows] of [...groups].sort()) {
    const total = rows.reduce((s, c) => s + c.value, 0);
    const detail =
      rows.length > 1
        ? [...rows]
            .sort((a, b) => b.value - a.value)
            .map((c) => `${Object.values(c.dimensions).join('/')} ${Math.round(c.value).toLocaleString()}`)
            .join(', ')
        : '';
    console.log(`  ${key.padEnd(40)} ${Math.round(total).toLocaleString().padStart(12)}   ${detail}`);
  }
  for (const i of plan.issues.slice(0, 8)) console.log(`  · ${i.severity}: ${i.message}`);

  if (dryRun) {
    console.log('\nDry run — nothing was written.');
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  const batch = await ImportBatch.create({
    fileName,
    sheetName: TAB,
    program: source.program._id,
    mapping: source.mapping,
    status: 'previewed',
    checks: plan.checks,
    issues: [
      ...plan.issues,
      {
        severity: 'info',
        message:
          'Read through the spreadsheet’s published link by scripts/backfill-fellowship.js, ' +
          'because the service account is not configured and the scheduled sync has been failing.',
      },
    ],
    importedBy: admin?._id ?? source.createdBy,
  });

  const { created, updated } = await imports.commit({ planResult: plan, batch, user: admin });

  batch.status = 'committed';
  batch.committedAt = new Date();
  batch.factsCreated = created;
  batch.factsSuperseded = updated;
  await batch.save();

  // The extended block list is kept, so the scheduled sync reads everything
  // this run read once the credentials are in place.
  await source.save();

  /**
   * The targets, into their own collection.
   *
   * Upserted rather than appended: a target is a standing commitment, not an
   * observation with a history, so re-reading the sheet leaves one row per
   * coordinate rather than a pile of them.
   */
  const metrics = new Map(
    (await Metric.find({ key: { $in: [...new Set(TARGETS.map((t) => t.metric))] } })).map((m) => [m.key, m])
  );

  let targetsWritten = 0;
  console.log('');
  console.log('  target                                 target   sheet says');
  for (const spec of TARGETS) {
    const metric = metrics.get(spec.metric);
    if (!metric) throw new Error(`Metric "${spec.metric}" is not in the catalog.`);

    const value = worksheet.getCell(`F${spec.row}`)?.value;
    const stated = worksheet.getCell(`G${spec.row}`)?.value;
    if (typeof value !== 'number') continue;

    const period = spec.year
      ? buildPeriod({ periodType: 'year', year: spec.year })
      : buildPeriod({ periodType: 'all_time' });
    const dims = buildDimensionFields(spec.dimensions);

    await Target.findOneAndUpdate(
      {
        program: source.program._id,
        metric: metric._id,
        periodType: period.periodType,
        periodStart: period.periodStart,
        dimensionKey: dims.dimensionKey,
      },
      {
        $set: {
          program: source.program._id,
          metric: metric._id,
          ...period,
          ...dims,
          value,
          statedActual: typeof stated === 'number' ? stated : null,
          label: spec.label,
          sourceRef: `${TAB} › F${spec.row}`,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    targetsWritten += 1;
    const where = spec.year ? `${spec.label} (${spec.year})` : spec.label;
    console.log(
      `  ${where.padEnd(34)} ${value.toLocaleString().padStart(10)} ` +
        `${(typeof stated === 'number' ? stated.toLocaleString() : '—').padStart(12)}`
    );
  }

  console.log(`\n${created} new · ${updated} revised · ${targetsWritten} targets.`);
  console.log(`Reversible: batch ${batch._id}.`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
