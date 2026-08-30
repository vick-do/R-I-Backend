const Program = require('../models/Program.model');
const Metric = require('../models/Metric.model');
const Dimension = require('../models/Dimension.model');

/**
 * The catalog, held in memory for a few seconds at a time.
 *
 * Programmes, metrics and dimensions describe the shape of the data rather than
 * the data itself: they change when somebody edits the catalog, which is rarely,
 * and they are read on the way to answering almost every request. A programme
 * page was spending four of its seven round trips re-fetching them, and the
 * dashboard asks for all three on top of that on every navigation.
 *
 * Against a database on the other side of a network that is most of the page's
 * latency, and it multiplies: three people navigating at once turned seven trips
 * into twenty-one queued behind one connection pool.
 *
 * The entries are lean and treated as read-only. Anything that writes to the
 * catalog goes through `invalidate()`, and the TTL bounds how stale a reader can
 * be even if some path forgets to.
 */
const TTL_MS = 30_000;

const cache = new Map();

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  // Store the promise, not the result: ten requests arriving together should
  // make one query between them rather than ten.
  const pending = load().then(
    (value) => {
      cache.set(key, { value, expires: Date.now() + TTL_MS });
      return value;
    },
    (err) => {
      cache.delete(key);
      throw err;
    }
  );

  cache.set(key, { value: pending, expires: Date.now() + TTL_MS });
  return pending;
}

/** Every programme, including archived ones — callers filter for themselves. */
const programs = () => cached('programs', () => Program.find().sort({ order: 1 }).lean());

const metrics = () => cached('metrics', () => Metric.find({ isArchived: false }).sort({ displayOrder: 1, label: 1 }).lean());

const dimensions = () => cached('dimensions', () => Dimension.find().lean());

/**
 * Drops what has changed. Called by anything that writes to the catalog —
 * seeding, metric edits, and the importer when it discovers a dimension value
 * it has not seen before.
 */
function invalidate(...keys) {
  if (keys.length === 0) cache.clear();
  for (const key of keys) cache.delete(key);
}

module.exports = { programs, metrics, dimensions, invalidate, TTL_MS };
