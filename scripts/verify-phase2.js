/**
 * Phase 2 verification — the importer, against the real workbooks.
 *
 * Boots in-memory MongoDB, seeds the catalog, runs the full backfill, and then
 * checks the derived figures against the workbooks' own stated totals. The
 * 2026 Consolidated sheet is deliberately NOT imported: it is the independent
 * check that the monthly sheets were read correctly.
 *
 *   node scripts/verify-phase2.js
 */
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION ?? '6.0.14';

const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  const mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '4998';
  process.env.MONGODB_URI = mongo.getUri('ri_impact_phase2');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-value-for-verification';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-for-verification';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.BCRYPT_SALT_ROUNDS = '4';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.SEED_ADMIN_EMAIL = 'admin@mest.local';
  process.env.SEED_ADMIN_PASSWORD = 'VerifyPassword123!';

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);

  require('../src/models');
  const { seedPrograms, seedMetrics, seedDimensions, seedAdmin } = require('../src/seeds/seed');
  await seedPrograms();
  await seedMetrics();
  await seedDimensions();
  await seedAdmin();

  const Program = require('../src/models/Program.model');
  const Fact = require('../src/models/Fact.model');
  const ImportBatch = require('../src/models/ImportBatch.model');
  const User = require('../src/models/User.model');
  const facts = require('../src/services/facts.service');
  const importService = require('../src/services/import.service');
  const { loadWorkbook, readNumber } = require('../src/utils/workbook');
  const { dataSummaryBlocks, edtechBlocks } = require('../src/seeds/backfillMappings');

  const user = await User.findOne({ role: 'admin' });
  const workbooks = new Map([
    ['Data Summary Sheet.xlsx', await loadWorkbook('/Users/kod/Desktop/vic/Data Summary Sheet.xlsx')],
    ['EdTech Mondays Analytics 2026.xlsx', await loadWorkbook('/Users/kod/Desktop/vic/EdTech Mondays Analytics 2026.xlsx')],
  ]);

  const blockResults = new Map();

  async function importBlock(block) {
    const worksheet = workbooks.get(block.file).getWorksheet(block.sheet);
    const program = await Program.findOne({ pageKey: block.program });
    const planResult = await importService.plan({
      worksheet, mapping: block.mapping, fileName: block.file, programId: program._id,
    });

    const batch = await ImportBatch.create({
      fileName: block.file, sheetName: block.sheet, program: program._id,
      mapping: block.mapping, importedBy: user._id, status: 'previewed',
    });
    const { created, updated } = await importService.commit({ planResult, batch, user });
    batch.status = 'committed';
    batch.factsCreated = created;
    batch.committedAt = new Date();
    await batch.save();

    blockResults.set(block.name, { planResult, batch, created, updated });
    return planResult;
  }

  // ------------------------------------------------------- Data Summary
  section('Data Summary Sheet — block imports');
  for (const block of dataSummaryBlocks) {
    const plan = await importBlock(block);
    const errors = plan.issues.filter((i) => i.severity === 'error');
    check(`${block.name} (${plan.candidates.length} figures)`,
      errors.length === 0 && plan.candidates.length > 0,
      errors.map((e) => e.message).join('; ') || 'no figures extracted');
  }

  section('Data Summary — reconciliation against the sheets\' own totals');
  const growGender = blockResults.get('Grow — learners by gender').planResult;
  check('Grow gender breakdown reconciles to its stated 793',
    growGender.checks.some((c) => c.expected === 793 && c.status === 'pass'),
    JSON.stringify(growGender.checks));

  const web3 = blockResults.get('Web3 — learners by gender').planResult;
  check('Web3 26 + 12 reconciles to its stated 38',
    web3.checks.some((c) => c.expected === 38 && c.actual === 38 && c.status === 'pass'),
    JSON.stringify(web3.checks));

  const growMothers = blockResults.get('Grow — mothers by hub').planResult;
  check('Grow mothers by hub reconciles to its stated 82',
    growMothers.checks.some((c) => c.expected === 82 && c.actual === 82 && c.status === 'pass'),
    JSON.stringify(growMothers.checks));

  // -------------------------------------------------- derived programme totals
  section('Derived programme figures match the workbook');
  const growTotal = await facts.resolveTotal({
    programId: (await Program.findOne({ pageKey: 'digital-skills-grow' }))._id,
    metricKey: 'learners_total',
  });
  check('Grow total learners = 793', growTotal.total === 793, `got ${growTotal.total}`);

  const growByHub = await facts.aggregate({
    programId: (await Program.findOne({ pageKey: 'digital-skills-grow' }))._id,
    metricKey: 'learners_total', groupBy: ['hub'],
  });
  check('Grow hub breakdown has 3 hubs — no duplicate from spelling drift',
    growByHub.rows.length === 3, `got ${growByHub.rows.length}: ${growByHub.rows.map((r) => r.dimensions.hub).join(', ')}`);
  check('Grow hub figures sum to 793',
    growByHub.rows.reduce((s, r) => s + r.value, 0) === 793);

  const growEmployedByHub = await facts.aggregate({
    programId: (await Program.findOne({ pageKey: 'digital-skills-grow' }))._id,
    metricKey: 'graduates_employed', groupBy: ['hub'],
  });
  check('Grow employed-by-hub resolves all three hub spellings',
    growEmployedByHub.rows.length === 3,
    growEmployedByHub.rows.map((r) => `${r.dimensions.hub}=${r.value}`).join(', '));
  check('Grow employed by hub = 222 + 119 + 64 = 405',
    growEmployedByHub.rows.reduce((s, r) => s + r.value, 0) === 405,
    `got ${growEmployedByHub.rows.reduce((s, r) => s + r.value, 0)}`);

  const scaleId = (await Program.findOne({ pageKey: 'venture-support-mest-scale' }))._id;
  const scaleTotal = await facts.resolveTotal({ programId: scaleId, metricKey: 'enterprises_total' });
  check('MEST Scale enterprises = 112', scaleTotal.total === 112, `got ${scaleTotal.total}`);

  const byStage = await facts.aggregate({ programId: scaleId, metricKey: 'enterprises_total', groupBy: ['enterprise_stage'] });
  check('MEST Scale stage split = 88 + 24 = 112',
    byStage.rows.reduce((s, r) => s + r.value, 0) === 112, JSON.stringify(byStage.rows));

  const byRegion = await facts.aggregate({ programId: scaleId, metricKey: 'enterprises_total', groupBy: ['region'] });
  check('MEST Scale region split covers 4 regions summing to 112',
    byRegion.rows.length === 4 && byRegion.rows.reduce((s, r) => s + r.value, 0) === 112,
    JSON.stringify(byRegion.rows.map((r) => `${r.dimensions.region}=${r.value}`)));

  // ------------------------------------------------------------- EdTech
  section('EdTech Mondays — anchored monthly blocks');
  let withData = 0;
  let anchorFailures = [];
  for (const block of edtechBlocks) {
    const plan = await importBlock(block);
    if (plan.candidates.length > 0) withData += 1;
    if (plan.issues.some((i) => i.message.startsWith('Could not find'))) anchorFailures.push(block.name);
  }

  // All 20 blocks must be *located*; only some carry data, because reporting
  // for June 2026 onward has not happened yet. An anchor that cannot be found
  // is the real failure — it means the sheet was restructured.
  check(`All ${edtechBlocks.length} monthly blocks were located by anchor`,
    anchorFailures.length === 0, anchorFailures.join('; '));
  check(`${withData} blocks carried data (the rest are months not yet reported)`,
    withData >= 7, `got ${withData}`);

  const febBlock = blockResults.get('EdTech Mondays — February 2026 — mest-africa').planResult;
  check('February block found despite sitting in a different column than other months',
    febBlock.candidates.length > 0, 'no figures extracted from February');

  // The independent check: the Consolidated sheet is never imported, so these
  // totals come only from the monthly sheets.
  section('Independent check against the untouched 2026 Consolidated sheet');
  const consolidated = workbooks.get('EdTech Mondays Analytics 2026.xlsx').getWorksheet('2026 Consolidated ');
  const edtechId = (await Program.findOne({ pageKey: 'ecosystem-edtech-mondays' }))._id;

  // Column L is the MEST AFRICA row-total column in the Consolidated sheet.
  const consolidatedMest = {
    posts: readNumber(consolidated.getCell('L6')),
    impressions: readNumber(consolidated.getCell('L7')),
    reach: readNumber(consolidated.getCell('L8')),
    engagement: readNumber(consolidated.getCell('L9')),
    reactions: readNumber(consolidated.getCell('L10')),
    comments: readNumber(consolidated.getCell('L11')),
    shares: readNumber(consolidated.getCell('L12')),
    clicks: readNumber(consolidated.getCell('L13')),
    video_views: readNumber(consolidated.getCell('L14')),
  };

  for (const [metricKey, expected] of Object.entries(consolidatedMest)) {
    const agg = await facts.aggregate({
      programId: edtechId, metricKey, groupBy: ['channel'], year: 2026,
    });
    const mest = agg.rows.find((r) => r.dimensions.channel === 'mest-africa');
    check(`MEST Africa ${metricKey}: monthly sheets sum to the Consolidated total (${expected})`,
      mest?.value === expected, `imported ${mest?.value ?? 'nothing'}`);
  }

  // ------------------------------------------------------ rollback safety
  section('Batches are reversible');
  const target = blockResults.get('Grow — learners by hub');
  const beforeCount = await Fact.countDocuments({ isCurrent: true });
  const { removed, restored } = await importService.rollback({ batch: target.batch, user });
  const afterCount = await Fact.countDocuments({ isCurrent: true });

  check(`Rollback removed the ${removed} facts that batch wrote`, removed === target.created);
  check('Current fact count drops by exactly that many',
    afterCount === beforeCount - removed + restored, `${beforeCount} → ${afterCount}`);

  const hubsAfter = await facts.aggregate({
    programId: (await Program.findOne({ pageKey: 'digital-skills-grow' }))._id,
    metricKey: 'learners_total', groupBy: ['hub'],
  });
  check('Hub breakdown is gone after rollback', hubsAfter.rows.length === 0);

  const growAfter = await facts.resolveTotal({
    programId: (await Program.findOne({ pageKey: 'digital-skills-grow' }))._id,
    metricKey: 'learners_total',
  });
  check('Grow total survives — other batches untouched', growAfter.total === 793, `got ${growAfter.total}`);

  const rolledBack = await ImportBatch.findById(target.batch._id);
  check('Batch is marked rolled_back with a timestamp',
    rolledBack.status === 'rolled_back' && !!rolledBack.rolledBackAt);

  // --------------------------------------------------------- provenance
  section('Provenance');
  const sample = await Fact.findOne({ source: 'import', isCurrent: true });
  check('Imported facts carry a file › sheet › cell reference',
    /.+ › .+ › [A-Z]+\d+$/.test(sample.sourceRef ?? ''), sample?.sourceRef);
  check('Imported facts are linked to their batch', !!sample.batch);

  // ------------------------------------------------- idempotent re-import
  section('Re-importing is safe');
  const reRun = await importBlock(dataSummaryBlocks.find((b) => b.name === 'Grow — learners by gender'));
  check('Re-importing an unchanged block writes nothing',
    reRun.diff.created.length === 0 && reRun.diff.updated.length === 0,
    `created=${reRun.diff.created.length} updated=${reRun.diff.updated.length}`);

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);

  await mongoose.connection.close();
  await mongo.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\x1b[31mVerification crashed:\x1b[0m', err);
  process.exit(1);
});
