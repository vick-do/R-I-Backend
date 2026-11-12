/**
 * Connects the Portfolio tab and reads what it says.
 *
 *   node scripts/connect-portfolio.js [--dry-run]
 *
 * The tab, the blocks read from it and the anchors that guard them live in
 * `src/seeds/portfolio.js`, which documents the shape of the sheet.
 *
 * Unlike the other connectors this one also reads the tab, because most of the
 * Portfolio tab is not a table the mapper can describe: three rosters of
 * company names laid three to a row, and a snapshot whose figures share a cell
 * with their own captions. Those are read here, turned into ordinary candidates
 * — one enterprise per name — and committed through the same pipeline as
 * everything else.
 *
 * It reads the workbook's published .xlsx export rather than going through the
 * service account, so it runs without credentials. Once `GOOGLE_CLIENT_EMAIL` and
 * `GOOGLE_PRIVATE_KEY` are set the registered source is picked up by the
 * scheduled sync, which will keep the funding table current on its own; the
 * rosters need this script, so re-run it when the portfolio changes.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { env } = require('../src/config/env');
require('../src/models');
const Program = require('../src/models/Program.model');
const Metric = require('../src/models/Metric.model');
const SheetSource = require('../src/models/SheetSource.model');
const ImportBatch = require('../src/models/ImportBatch.model');
const User = require('../src/models/User.model');
const { readText } = require('../src/utils/workbook');
const sync = require('../src/services/sheetSync.service');
const imports = require('../src/services/import.service');
const { buildPeriod } = require('../src/utils/period');
const Dimension = require('../src/models/Dimension.model');
const catalogCache = require('../src/services/catalog.cache');

const {
  SPREADSHEET_ID, TAB, PROGRAM, BLOCKS, ROSTERS, ROSTER_COLUMNS, SNAPSHOT, ANCHORS,
} = require('../src/seeds/portfolio');

const dryRun = process.argv.includes('--dry-run');

/**
 * The tab, read out of the workbook's own .xlsx export.
 *
 * The other connectors read cell ranges through the visualisation endpoint,
 * which is fine for a dense table and wrong for this one: that endpoint drops
 * blank rows silently, and this tab has five of them between its sections, so
 * every roster came back shifted up by the number of gaps above it. Nothing
 * looked broken — the names simply belonged to the wrong rows.
 *
 * The .xlsx export has no such problem. It needs no credentials either, and it
 * arrives as the exact workbook format the importer already reads, so the cells
 * come back at their own addresses with nothing to re-align.
 */
async function loadWorksheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The published workbook answered ${response.status}.`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));

  const worksheet = workbook.getWorksheet(TAB);
  if (!worksheet) {
    throw new Error(
      `The workbook has no tab named ${JSON.stringify(TAB)}. It has: ` +
        workbook.worksheets.map((w) => JSON.stringify(w.name)).join(', ')
    );
  }

  return worksheet;
}

/** The figure inside a snapshot cell, which holds its caption on the line above. */
function snapshotValue(text) {
  const last = String(text ?? '').split('\n').pop().trim().replace(/,/g, '');
  const value = Number(last);
  return Number.isFinite(value) ? value : null;
}

(async () => {
  console.log(`Reading ${TAB.trim()} from the published workbook…`);
  const worksheet = await loadWorksheet();

  await mongoose.connect(env.MONGODB_URI);

  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found. Run \`npm run seed\` first.`);

  const read = (a) => readText(worksheet.getCell(a)) ?? '';

  const drift = ANCHORS.filter(([cell, text]) => read(cell) !== text)
    .map(([cell, text]) => `${cell} reads "${read(cell)}", expected "${text}"`);
  if (drift.length) {
    console.error('The sheet has been restructured — stopping rather than importing into the wrong coordinates:');
    drift.forEach((d) => console.error(`  · ${d}`));
    process.exit(1);
  }

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  const source = await SheetSource.findOneAndUpdate(
    { spreadsheetId: SPREADSHEET_ID, tabName: TAB },
    {
      spreadsheetId: SPREADSHEET_ID, tabName: TAB, spreadsheetTitle: 'Data Summary Sheet',
      program: program._id, mapping: {},
      blocks: BLOCKS.map((b) => ({ name: b.name, program: program._id, mapping: b.mapping })),
      createdBy: admin?._id ?? null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate('program', 'pageKey name').populate('blocks.program', 'pageKey name');

  const fileName = 'Data Summary Sheet (published link)';
  const plan = await sync.planBlocks({ worksheet, source, fileName });

  // ---- the snapshot, checked against the funding table --------------------
  console.log('\n  snapshot');
  for (const { cell, caption, expected } of SNAPSHOT) {
    const text = read(cell);
    if (!text.startsWith(caption)) {
      console.error(`  ✗ ${cell} should start "${caption}" and reads "${text.split('\n')[0]}".`);
      process.exit(1);
    }
    const value = snapshotValue(text);
    const mark = value === expected ? '·' : '!';
    console.log(`  ${mark} ${caption.padEnd(28)} ${String(value).padStart(8)}`);
  }

  // ---- the rosters --------------------------------------------------------
  const enterprises = await Metric.findOne({ key: 'enterprises_total' });
  const period = buildPeriod({ periodType: 'all_time' });

  /**
   * Names are registered on the `company` axis as they are read.
   *
   * Through the dimension's own `resolveOrCreate`, which is what the importer
   * uses for every other open axis, so the catalog keeps the name as written.
   * Slugging them here instead would store the slug and leave the dashboard to
   * guess a label back out of it, which turns CodeLn into "Codeln", SAYeTECH
   * into "Sayetech" and MeQasa into "Meqasa".
   */
  const companyAxis = await Dimension.findOne({ name: 'company' });
  if (!companyAxis) throw new Error('The "company" dimension is missing. Run `npm run seed` first.');

  console.log('\n  rosters');
  for (const roster of ROSTERS) {
    const names = [];
    for (let row = roster.first; row <= roster.last; row += 1) {
      for (const column of ROSTER_COLUMNS) {
        const name = read(`${column}${row}`);
        if (name) names.push(name);
      }
    }

    const unique = [...new Set(names)];
    const mark = unique.length === roster.expected ? '·' : '!';
    console.log(
      `  ${mark} ${roster.name.padEnd(28)} ${String(unique.length).padStart(3)} names` +
        (unique.length === roster.expected ? '' : `, the sheet states ${roster.expected}`) +
        (names.length !== unique.length ? ` (${names.length - unique.length} repeated)` : '')
    );

    for (const name of unique) {
      const resolved = await companyAxis.resolveOrCreate(name);
      if (!resolved.value) {
        console.error(`  ✗ could not resolve "${name}" as a company.`);
        continue;
      }

      plan.candidates.push({
        programId: program._id,
        metric: enterprises,
        period,
        dimensions: { ...roster.dimensions, company: resolved.value },
        value: 1,
        sourceRef: `${TAB.trim()} › ${roster.name}`,
      });
    }
  }

  catalogCache.invalidate('dimensions');
  console.log(`\n  ${plan.candidates.length} figures in total`);
  for (const i of plan.issues.slice(0, 8)) console.log(`  · ${i.severity}: ${i.message}`);

  if (dryRun) {
    console.log('\nDry run — nothing was written.');
    await mongoose.disconnect();
    return;
  }

  const batch = await ImportBatch.create({
    fileName,
    sheetName: TAB,
    program: program._id,
    status: 'previewed',
    checks: plan.checks,
    issues: plan.issues,
    importedBy: admin?._id ?? null,
  });

  const { created, updated } = await imports.commit({ planResult: plan, batch, user: admin });

  batch.status = 'committed';
  batch.committedAt = new Date();
  batch.factsCreated = created;
  batch.factsSuperseded = updated;
  await batch.save();

  console.log(`\n${created} new · ${updated} revised.`);
  console.log(`Reversible: batch ${batch._id}.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
