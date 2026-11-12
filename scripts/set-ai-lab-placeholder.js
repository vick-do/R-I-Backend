/**
 * Writes the AI Startup Lab's placeholder headcount.
 *
 *   node scripts/set-ai-lab-placeholder.js [value]
 *
 * The lab's sheet states satisfaction and skill confidence but no roster, so
 * there is nothing to import a headcount from. This writes one by hand against
 * `people_trained` so the page can show the card while the real figure is being
 * confirmed.
 *
 * Two things keep an invented number from being mistaken for a measured one:
 * `people_trained` does not roll up to the organisation's headline count of
 * people trained, and every fact this writes carries a note saying what it is.
 * Search the audit log or `db.facts.find({ note: /Placeholder/ })` to find it.
 *
 * Replace it by connecting the roster and pointing the page at `learners_total`,
 * then delete this script.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const Program = require('../src/models/Program.model');
const Metric = require('../src/models/Metric.model');
const facts = require('../src/services/facts.service');
const { buildPeriod } = require('../src/utils/period');

const PROGRAM = 'ai-startup-lab';
const METRIC = 'people_trained';
const YEAR = 2026;
const DEFAULT_VALUE = 1000;

const NOTE =
  'Placeholder, not a measured figure. The AI Startup Lab sheet states no roster; ' +
  'replace this with the real headcount once one is connected.';

(async () => {
  const value = Number(process.argv[2] ?? DEFAULT_VALUE);
  if (!Number.isFinite(value)) throw new Error(`"${process.argv[2]}" is not a number.`);

  await mongoose.connect(env.MONGODB_URI);

  const [program, metric] = await Promise.all([
    Program.findOne({ pageKey: PROGRAM }),
    Metric.findOne({ key: METRIC }),
  ]);
  if (!program) throw new Error(`Programme "${PROGRAM}" not found. Run \`npm run seed\` first.`);
  if (!metric) throw new Error(`Metric "${METRIC}" not found. Run \`npm run seed\` first.`);

  const { outcome } = await facts.writeFact({
    program,
    metric,
    period: buildPeriod({ periodType: 'year', year: YEAR }),
    value,
    source: 'manual',
    note: NOTE,
  });

  console.log(`${metric.label}: ${value} for ${YEAR} on ${program.name} — ${outcome}.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
