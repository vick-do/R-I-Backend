/**
 * Backfills both existing workbooks.
 *
 * Each block is imported as its own reversible ImportBatch, so a single bad
 * mapping can be rolled back without disturbing the rest.
 *
 *   node src/seeds/backfill.js [--dry-run] [--dir /path/to/workbooks]
 *
 * Idempotent: re-running writes nothing when the data already matches.
 */
require('../config/env');
const path = require('path');
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { logger } = require('../utils/logger');
require('../models');
const Program = require('../models/Program.model');
const User = require('../models/User.model');
const ImportBatch = require('../models/ImportBatch.model');
const importService = require('../services/import.service');
const { loadWorkbook } = require('../utils/workbook');
const { dataSummaryBlocks, edtechBlocks } = require('./backfillMappings');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dirFlag = args.indexOf('--dir');
const WORKBOOK_DIR = dirFlag !== -1 ? args[dirFlag + 1] : '/Users/kod/Desktop/vic';

async function runBlock({ block, workbooks, user, results }) {
  const workbook = workbooks.get(block.file);
  if (!workbook) {
    results.push({ name: block.name, status: 'skipped', reason: `Workbook "${block.file}" not found.` });
    return;
  }

  const worksheet = workbook.getWorksheet(block.sheet);
  if (!worksheet) {
    results.push({ name: block.name, status: 'skipped', reason: `Sheet "${block.sheet}" not found.` });
    return;
  }

  const program = await Program.findOne({ pageKey: block.program });
  if (!program) {
    results.push({ name: block.name, status: 'skipped', reason: `Program "${block.program}" not seeded.` });
    return;
  }

  const planResult = await importService.plan({
    worksheet,
    mapping: block.mapping,
    fileName: block.file,
    programId: program._id,
  });

  const errors = planResult.issues.filter((i) => i.severity === 'error');
  const failedChecks = planResult.checks.filter((c) => c.status === 'fail');

  if (DRY_RUN) {
    results.push({
      name: block.name,
      status: errors.length ? 'errors' : 'planned',
      ...planResult.summary,
      checks: planResult.checks,
      issues: planResult.issues,
    });
    return;
  }

  if (errors.length > 0) {
    results.push({ name: block.name, status: 'errors', issues: planResult.issues, ...planResult.summary });
    return;
  }

  if (planResult.candidates.length === 0) {
    results.push({ name: block.name, status: 'empty', ...planResult.summary });
    return;
  }

  const batch = await ImportBatch.create({
    fileName: block.file,
    sheetName: block.sheet,
    program: program._id,
    mapping: block.mapping,
    checks: planResult.checks,
    issues: planResult.issues,
    importedBy: user._id,
    status: 'previewed',
  });

  const { created, updated } = await importService.commit({ planResult, batch, user });

  batch.status = 'committed';
  batch.factsCreated = created;
  batch.factsSuperseded = updated;
  batch.rowsSkipped = planResult.diff.unchanged.length;
  batch.committedAt = new Date();
  await batch.save();

  results.push({
    name: block.name,
    status: failedChecks.length ? 'committed_with_mismatch' : 'committed',
    created,
    updated,
    unchanged: planResult.diff.unchanged.length,
    checks: planResult.checks,
  });
}

async function run() {
  await connectDB();

  const user = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (!user) {
    throw new Error('No admin user exists. Run `npm run seed` first.');
  }

  const blocks = [...dataSummaryBlocks, ...edtechBlocks];
  const fileNames = [...new Set(blocks.map((b) => b.file))];

  const workbooks = new Map();
  for (const fileName of fileNames) {
    try {
      workbooks.set(fileName, await loadWorkbook(path.join(WORKBOOK_DIR, fileName)));
      logger.info(`Loaded ${fileName}`);
    } catch (err) {
      logger.warn(`Could not load ${fileName}: ${err.message}`);
    }
  }

  const results = [];
  for (const block of blocks) {
    await runBlock({ block, workbooks, user, results });
  }

  report(results);
  await mongoose.connection.close();
}

function report(results) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing written' : 'Backfill complete'}\n`);
  console.log(pad('BLOCK', 52), pad('STATUS', 24), 'FACTS');
  console.log('-'.repeat(100));

  for (const r of results) {
    const facts = r.created !== undefined
      ? `${r.created} new, ${r.updated} revised, ${r.unchanged} unchanged`
      : r.reason ?? '';
    console.log(pad(r.name.slice(0, 51), 52), pad(r.status, 24), facts);
  }

  const mismatches = results.flatMap((r) => (r.checks ?? []).filter((c) => c.status === 'fail').map((c) => ({ block: r.name, ...c })));
  if (mismatches.length) {
    console.log(`\n\x1b[33mReconciliation mismatches (${mismatches.length}) — the sheet's own totals disagree with its rows:\x1b[0m`);
    for (const m of mismatches) {
      console.log(`  • ${m.block}`);
      console.log(`    ${m.label}: sheet says ${m.expected}, rows sum to ${m.actual} (off by ${m.difference})`);
      console.log(`    ${m.sourceRef}`);
    }
  }

  const problems = results.filter((r) => r.status === 'errors' || r.status === 'skipped');
  if (problems.length) {
    console.log(`\n\x1b[31mBlocks needing attention (${problems.length}):\x1b[0m`);
    for (const p of problems) {
      console.log(`  • ${p.name}: ${p.reason ?? ''}`);
      for (const issue of (p.issues ?? []).filter((i) => i.severity === 'error')) {
        console.log(`    - ${issue.message}${issue.sourceRef ? ` (${issue.sourceRef})` : ''}`);
      }
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      created: acc.created + (r.created ?? 0),
      updated: acc.updated + (r.updated ?? 0),
    }),
    { created: 0, updated: 0 }
  );
  console.log(`\n${totals.created} facts created, ${totals.updated} revised across ${results.length} blocks.\n`);
}

if (require.main === module) {
  run().catch(async (err) => {
    logger.error('Backfill failed', { error: err.message, stack: err.stack });
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run };
