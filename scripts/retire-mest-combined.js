/**
 * Retires the combined "MEST Scale & Express " summary.
 *
 *   node scripts/retire-mest-combined.js [--dry-run]
 *
 * That tab stated 112 enterprises but broke down only the 88 Express rows, so
 * every breakdown on the page fell short of its own headline. The two partner
 * rosters replace it with one row per enterprise per programme.
 *
 * The five batches it was imported in are rolled back rather than deleted, so
 * the facts leave the record the same way they entered it and the batch history
 * still shows what happened.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const Fact = require('../src/models/Fact.model');
const Program = require('../src/models/Program.model');
const SheetSource = require('../src/models/SheetSource.model');
const ImportBatch = require('../src/models/ImportBatch.model');
const User = require('../src/models/User.model');
const imports = require('../src/services/import.service');

const TAB = 'MEST Scale & Express ';
const dryRun = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  const program = await Program.findOne({ pageKey: 'venture-support-mest-scale' });

  const facts = await Fact.find({ program: program._id, isCurrent: true, source: 'import' }).lean();
  const batchIds = [...new Set(facts.filter((f) => String(f.sourceRef ?? '').includes(TAB)).map((f) => String(f.batch)))];

  console.log(`${facts.length} current facts on ${program.name}, from ${batchIds.length} batches of the combined tab.`);

  for (const id of batchIds) {
    const batch = await ImportBatch.findById(id);
    if (!batch || batch.status === 'rolled_back') continue;
    if (dryRun) {
      const n = await Fact.countDocuments({ batch: batch._id });
      console.log(`  would roll back ${id} — ${n} facts`);
      continue;
    }
    const { removed, restored } = await imports.rollback({ batch, user: admin });
    console.log(`  rolled back ${id} — ${removed} removed, ${restored} restored`);
  }

  const source = await SheetSource.findOne({ tabName: TAB });
  if (source) {
    if (dryRun) console.log(`  would disconnect the sheet source for "${TAB}"`);
    else {
      await SheetSource.deleteOne({ _id: source._id });
      console.log(`  disconnected "${TAB}"`);
    }
  }

  const left = await Fact.countDocuments({ program: program._id, isCurrent: true });
  console.log(`\n${left} facts remain on ${program.name}.`);
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
