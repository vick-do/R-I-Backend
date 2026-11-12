/**
 * Backfills the AI Startup Lab's General and Team satisfaction rows.
 *
 *   node scripts/backfill-ai-lab-satisfaction.js [--dry-run]
 *
 * A stopgap, and deliberately a small one. `connect-ai-startup.js` already maps
 * both rows and is the path that should own them, but it reads through the
 * service account, and these figures were wanted before those credentials were
 * in place. So the twelve numbers are carried here instead, read from the sheet
 * at the coordinates the connector will read them from.
 *
 * They are the sheet's own values, not rounded copies: rows 6 and 10 hold plain
 * four-decimal fractions, so the connector will later compute the same figures
 * at the same coordinates and report them unchanged rather than writing a
 * second version of each.
 *
 * Delete this script once the connector has run.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const Program = require('../src/models/Program.model');
const Metric = require('../src/models/Metric.model');
const User = require('../src/models/User.model');
const ImportBatch = require('../src/models/ImportBatch.model');
const imports = require('../src/services/import.service');
const { buildPeriod } = require('../src/utils/period');

const PROGRAM = 'ai-startup-lab';
const TAB = 'AI Startup 2026';
const YEAR = 2026;
const dryRun = process.argv.includes('--dry-run');

// January is column D, so month n sits at column D + n. July onward is blank on
// both rows because the cohort is still running, and a blank month is absent
// rather than zero.
const COLUMNS = ['D', 'E', 'F', 'G', 'H', 'I'];

/** The two single-row series, each as the sheet states it. */
const SERIES = [
  {
    metric: 'satisfaction_general',
    row: 6,
    fractions: [0.8929, 0.8928, 0.8572, 0.88, 0.92, 0.7407],
  },
  {
    metric: 'satisfaction_team',
    row: 10,
    fractions: [0.6786, 0.6897, 0.6429, 0.9615, 1.0, 0.7778],
  },
];

(async () => {
  await mongoose.connect(env.MONGODB_URI);

  const program = await Program.findOne({ pageKey: PROGRAM });
  if (!program) throw new Error(`Programme "${PROGRAM}" not found. Run \`npm run seed\` first.`);

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (!admin) throw new Error('No admin user to attribute the import to.');

  const candidates = [];
  for (const { metric: key, row, fractions } of SERIES) {
    const metric = await Metric.findOne({ key });
    if (!metric) throw new Error(`Metric "${key}" not found. Run \`npm run seed\` first.`);

    fractions.forEach((fraction, index) => {
      candidates.push({
        programId: program._id,
        metric,
        period: buildPeriod({ periodType: 'month', year: YEAR, month: index + 1 }),
        dimensions: {},
        // Stored as percent, the same scaling `percentScale: 'fraction'` applies.
        value: fraction * 100,
        sourceRef: `${TAB} › ${COLUMNS[index]}${row}`,
      });
    });
  }

  console.log(`\n${TAB} → ${program.name}`);
  for (const c of candidates) {
    console.log(`  ${c.metric.key.padEnd(22)} ${c.period.periodLabel.padEnd(16)} ${c.value.toFixed(2)}%  ${c.sourceRef}`);
  }

  if (dryRun) {
    console.log('\nDry run — nothing was written.');
    await mongoose.disconnect();
    return;
  }

  const batch = await ImportBatch.create({
    fileName: `${TAB} (backfill)`,
    sheetName: TAB,
    program: program._id,
    status: 'committed',
    importedBy: admin._id,
    issues: [
      {
        severity: 'info',
        message:
          'Backfilled by scripts/backfill-ai-lab-satisfaction.js, from rows 6 and 10 of the sheet. ' +
          'Superseded once connect-ai-startup.js runs through the service account.',
      },
    ],
    committedAt: new Date(),
  });

  const { created, updated } = await imports.commit({
    planResult: { candidates, checks: [], issues: [] },
    batch,
    user: admin,
  });

  await ImportBatch.updateOne({ _id: batch._id }, { $set: { factsCreated: created, factsSuperseded: updated } });

  console.log(`\n${created} new · ${updated} revised.`);
  console.log(`Reversible: batch ${batch._id}.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
