/**
 * Re-reads the EdTech Mondays tab and writes what it now says.
 *
 *   node scripts/backfill-edtech-mondays.js [--dry-run]
 *
 * A stopgap for one specific failure: the scheduled sync owns this tab, but it
 * reads through the service account, and where `GOOGLE_CLIENT_EMAIL` and
 * `GOOGLE_PRIVATE_KEY` are unset every run fails and the page keeps serving
 * whatever was last read. The figures go stale silently apart from the badge.
 *
 * So this reads the same tab through the spreadsheet's published link, which
 * needs no credentials, and then hands the cells to the ordinary import
 * pipeline: same blocks from `src/seeds/edtechMondays.js`, same anchor check,
 * same reconciliation against the sheet's own year-end summary, same reversible
 * batch. Only the transport differs.
 *
 * It is not a replacement for the connector. A published link is readable by
 * anyone holding it and says nothing about who is asking, which is exactly what
 * the service account exists to fix. Configure the credentials and delete this.
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

const { SPREADSHEET_ID, TAB, SUMMARY_ROWS, ANCHORS } = require('../src/seeds/edtechMondays');

const dryRun = process.argv.includes('--dry-run');

/**
 * The parts of the tab that hold data, each as a run of consecutive rows.
 *
 * Two things about the export shape this list.
 *
 * It drops blank rows. Asked for A1:Z60 in one sweep it would leave out the
 * blank rows between the two halves and silently shift every row number after
 * them, which for a mapping built out of row numbers is the worst kind of
 * failure — it would import into the wrong metric rather than fail. So the rows
 * come in runs containing no blank row, and each run's length is checked on
 * arrival.
 *
 * And it types a column by the data under it, returning null for anything that
 * does not fit. Row 4 is the month header sitting over eleven columns of
 * numbers, so inside a taller range every month name comes back empty and the
 * TOTAL column stops being recognised as a total. Fetched as a row of its own
 * it is read as text, which is what it is.
 */
const RUNS = [
  { range: 'A1:A1', firstRow: 1, firstColumn: 1, rows: 1 },
  { range: 'A4:L4', firstRow: 4, firstColumn: 1, rows: 1 },
  { range: 'A5:L39', firstRow: 5, firstColumn: 1, rows: 35 },
  { range: 'O4:Z4', firstRow: 4, firstColumn: 15, rows: 1 },
  { range: 'O5:Z43', firstRow: 5, firstColumn: 15, rows: 39 },
  { range: 'A49:A49', firstRow: 49, firstColumn: 1, rows: 1 },
  { range: 'A51:B60', firstRow: 51, firstColumn: 1, rows: 10 },
];

const COLUMNS = 26;
const ROWS = 60;

/** One run of rows, as the published link returns them. */
async function fetchRun({ range, rows }) {
  const url =
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq` +
    `?tqx=out:json&sheet=${encodeURIComponent(TAB)}&headers=0&range=${range}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${range}: the published link answered ${response.status}.`);

  // The response is JSON wrapped in a callback, for a visualisation API nobody
  // is calling from a browser here.
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
        // Unformatted values, so "2,787,226" arrives as a number rather than as
        // a string the importer would have to unpick.
        grid[run.firstRow - 1 + index][run.firstColumn - 1 + offset] = cell?.v ?? null;
      });
    });
  }

  return grid;
}

(async () => {
  console.log(`Reading ${TAB.trim()} through the published link…`);
  const grid = await loadGrid();

  await mongoose.connect(env.MONGODB_URI);

  const source = await SheetSource.findOne({ spreadsheetId: SPREADSHEET_ID, tabName: TAB })
    .populate('program', 'pageKey name')
    .populate('blocks.program', 'pageKey name');
  if (!source) throw new Error('The tab is not connected yet. Run connect-edtech-mondays.js first.');

  const worksheet = sheets.toWorksheet({ name: TAB, values: grid });
  const read = (a) => String(worksheet.getCell(a)?.value ?? '').trim();
  const num = (a) => {
    const value = worksheet.getCell(a)?.value;
    return typeof value === 'number' ? value : null;
  };

  const drift = ANCHORS.filter(([cell, text]) => read(cell) !== text)
    .map(([cell, text]) => `${cell} reads "${read(cell)}", expected "${text}"`);
  if (drift.length) {
    console.error('The sheet has been restructured — stopping rather than importing into the wrong coordinates:');
    drift.forEach((d) => console.error(`  · ${d}`));
    process.exit(1);
  }

  const fileName = `${source.spreadsheetTitle || 'Google Sheet'} (published link)`;
  const plan = await sync.planBlocks({ worksheet, source, fileName });

  console.log(`\n${source.spreadsheetTitle} › ${TAB} → ${source.program.name}`);
  console.log(
    `${plan.summary.created} new · ${plan.summary.updated} revised · ${plan.summary.unchanged} unchanged\n`
  );

  // The channel view and the platform view describe the same season, so each
  // should reach the sheet's own year-end summary on its own.
  console.log('  metric            summary   by channel   by platform');
  for (const [key, row] of SUMMARY_ROWS) {
    const stated = num(`B${row}`);
    const sum = (pick) =>
      plan.candidates.filter((c) => c.metric.key === key && pick(c.dimensions)).reduce((t, c) => t + c.value, 0);
    const mark = (v) => (v === 0 ? '·'.padStart(11) : (v === stated ? '✓ ' : '✗ ') + String(v).padStart(9));
    console.log(
      `  ${key.padEnd(16)} ${String(stated ?? '—').padStart(9)} ` +
        `${mark(sum((d) => Boolean(d.channel)))} ${mark(sum((d) => Boolean(d.platform) || Boolean(d.outlet)))}`
    );
  }

  const failed = plan.checks.filter((c) => c.status !== 'pass');
  console.log(`\n  ${plan.checks.length - failed.length}/${plan.checks.length} of the sheet's own row totals reconcile`);
  for (const c of failed.slice(0, 8)) console.log(`   ✗ ${c.label}: states ${c.expected}, months sum to ${c.actual}`);
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
          'Read through the spreadsheet’s published link by scripts/backfill-edtech-mondays.js, ' +
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

  /**
   * The source's own status is left alone on purpose.
   *
   * It says the scheduled sync cannot reach the sheet, which is still true, and
   * the badge on the page saying so is the only thing telling anybody that the
   * credentials are missing. Marking it synced here would turn the badge green
   * until the next failed poll flipped it back, and hide the actual problem in
   * the meantime.
   */
  console.log(`\n${created} new · ${updated} revised.`);
  console.log(`Reversible: batch ${batch._id}.`);
  console.log(`The sheet source still reads "${source.lastStatus}" — that is the missing service account, not this import.`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
