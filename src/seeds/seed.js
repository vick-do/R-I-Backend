/**
 * Idempotent seed: upserts the programme tree, metric catalog, and dimension
 * catalog, and creates the first admin account if none exists.
 *
 * Safe to re-run — it never deletes facts.
 *
 *   npm run seed
 */
require('../config/env');
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');
const Program = require('../models/Program.model');
const Metric = require('../models/Metric.model');
const Dimension = require('../models/Dimension.model');
const User = require('../models/User.model');
const { programs, metrics, dimensions } = require('./catalog');

async function seedPrograms() {
  const byKey = new Map();
  let created = 0;
  let updated = 0;

  // Parents are seeded before children because `ancestors` is denormalised
  // from the parent's own chain.
  for (const [index, spec] of programs.entries()) {
    const parent = spec.parent ? byKey.get(spec.parent) : null;
    if (spec.parent && !parent) {
      throw new Error(`Program "${spec.pageKey}" references unknown parent "${spec.parent}".`);
    }

    const doc = {
      name: spec.name,
      parent: parent?._id ?? null,
      ancestors: parent ? [...parent.ancestors, parent._id] : [],
      depth: parent ? parent.depth + 1 : 0,
      order: index,
      category: spec.category ?? 'container',
      metricKeys: spec.metricKeys ?? [],
      description: spec.description ?? null,
      isReportable: spec.isReportable ?? true,
      // Carried through so a programme retired in the catalog stays retired,
      // rather than reappearing on the next seed.
      isArchived: spec.isArchived ?? false,
    };

    const existing = await Program.findOne({ pageKey: spec.pageKey });
    const program = existing
      ? await Program.findOneAndUpdate({ pageKey: spec.pageKey }, { $set: doc }, { new: true })
      : await Program.create({ pageKey: spec.pageKey, ...doc });

    existing ? (updated += 1) : (created += 1);
    byKey.set(spec.pageKey, program);
  }

  return { created, updated };
}

async function seedMetrics() {
  let created = 0;
  let updated = 0;

  for (const spec of metrics) {
    const existing = await Metric.findOne({ key: spec.key });
    if (existing) {
      // Preserve any aliases operators added through the UI.
      const mergedAliases = [...new Set([...existing.aliases, ...(spec.aliases ?? [])])];
      await Metric.updateOne({ key: spec.key }, { $set: { ...spec, aliases: mergedAliases } });
      updated += 1;
    } else {
      await Metric.create(spec);
      created += 1;
    }
  }

  return { created, updated };
}

async function seedDimensions() {
  let created = 0;
  let updated = 0;

  for (const spec of dimensions) {
    const existing = await Dimension.findOne({ name: spec.name });
    if (existing) {
      // Union the seed values with anything the importer has since discovered.
      const seen = new Set(spec.values.map((v) => v.value));
      const extra = existing.values.filter((v) => !seen.has(v.value));
      await Dimension.updateOne(
        { name: spec.name },
        { $set: { ...spec, values: [...spec.values, ...extra] } }
      );
      updated += 1;
    } else {
      await Dimension.create(spec);
      created += 1;
    }
  }

  return { created, updated };
}

async function seedAdmin() {
  const count = await User.countDocuments();
  if (count > 0) return { created: 0 };

  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    logger.warn('No users exist and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are unset — skipping admin creation.');
    return { created: 0 };
  }

  await User.create({
    firstName: 'R&I',
    lastName: 'Admin',
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
    role: 'admin',
    isActive: true,
  });

  logger.warn(`Created initial admin ${env.SEED_ADMIN_EMAIL} — change this password immediately.`);
  return { created: 1 };
}

async function run() {
  await connectDB();

  const programResult = await seedPrograms();
  const metricResult = await seedMetrics();
  const dimensionResult = await seedDimensions();
  const adminResult = await seedAdmin();

  logger.info('Seed complete', {
    programs: programResult,
    metrics: metricResult,
    dimensions: dimensionResult,
    admin: adminResult,
  });

  await mongoose.connection.close();
}

if (require.main === module) {
  run().catch(async (err) => {
    logger.error('Seed failed', { error: err.message, stack: err.stack });
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run, seedPrograms, seedMetrics, seedDimensions, seedAdmin };
