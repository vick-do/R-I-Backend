/**
 * Clears every EdTech Mondays figure recorded before the consolidated report.
 *
 *   node scripts/retire-edtech-history.js [--dry-run]
 *
 * Two earlier sources fed this programme: a partial 2026 series backfilled from
 * a separate analytics workbook, and the 2023 season sheet that used to occupy
 * the EdTech Mondays tab. Both are superseded by the tab's own consolidated
 * report, which states plainly that it pulls from the monthly sheets and which
 * reconciles against its own year-end summary to the figure.
 *
 * The figures are removed rather than superseded. A new version would say the
 * number changed; it did not — those readings came from somewhere the programme
 * no longer reports from. The import batches are marked rolled back so the
 * history still shows they happened.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const Fact = require('../src/models/Fact.model');
const Program = require('../src/models/Program.model');
const ImportBatch = require('../src/models/ImportBatch.model');
const AuditLog = require('../src/models/AuditLog.model');
const User = require('../src/models/User.model');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  const program = await Program.findOne({ pageKey: 'ecosystem-edtech-mondays' });
  if (!program) throw new Error('EdTech Mondays not found.');

  const facts = await Fact.find({ program: program._id }).lean();
  const byYear = new Map();
  for (const f of facts) {
    const key = `${f.year ?? 'no year'}${f.isCurrent ? '' : ' (superseded)'}`;
    byYear.set(key, (byYear.get(key) ?? 0) + 1);
  }

  console.log(`\n${facts.length} figures recorded against ${program.name}:`);
  for (const [key, n] of [...byYear].sort()) console.log(`  ${String(n).padStart(5)}  ${key}`);

  const batchIds = [...new Set(facts.map((f) => String(f.batch)).filter((b) => b !== 'null'))];
  console.log(`\nfrom ${batchIds.length} import batches`);

  if (dryRun) {
    console.log('\nDry run — nothing was removed.');
    await mongoose.disconnect();
    return;
  }

  const ids = facts.map((f) => f._id);
  const removed = await Fact.deleteMany({ _id: { $in: ids } });
  const audits = await AuditLog.deleteMany({ entityType: 'Fact', entityId: { $in: ids } });
  const batches = await ImportBatch.updateMany(
    { _id: { $in: batchIds }, status: { $ne: 'rolled_back' } },
    { $set: { status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: admin?._id ?? null } }
  );

  console.log(`\nremoved ${removed.deletedCount} figures and ${audits.deletedCount} audit entries`);
  console.log(`marked ${batches.modifiedCount} batches rolled back`);
  console.log(`${await Fact.countDocuments({ program: program._id })} figures remain.`);
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
