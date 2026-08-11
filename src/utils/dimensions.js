/**
 * Dimension canonicalisation.
 *
 * A fact's *signature* is the sorted list of dimension names it is broken down
 * by. This is the single most important invariant in the system: facts may only
 * be summed together when their signatures match exactly.
 *
 * The Grow programme, for example, stores both:
 *   signature []        → { } = 793 learners            (programme total)
 *   signature ["hub"]   → { hub: accra } = 402, etc.    (hub breakdown)
 *
 * Summing across those two signatures would double-count to 1,586. Every
 * aggregation in facts.service.js therefore pins an exact signature, which is
 * what structurally prevents the inflated totals the old dashboard displayed.
 */

/** Lowercase, trimmed, hyphenated slug used as the stored dimension value. */
function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug for a dimension *name*.
 *
 * Names keep underscores (`enterprise_stage`, `post_type`) because they are
 * identifiers shared with `Metric.allowedDimensions` and with `groupBy` query
 * parameters. Running them through `slugify` would rewrite them to
 * `enterprise-stage`, so a fact's stored signature would no longer match the
 * signature a query asks for and the breakdown would silently return nothing.
 */
function slugifyName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Human-readable label kept alongside the slug in the Dimension catalog. */
function titleize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Normalises a raw `{ name: value }` bag into canonical slug form, dropping
 * empty entries and sorting keys so serialisation is stable.
 */
function normalizeDimensions(raw = {}) {
  const out = {};
  for (const key of Object.keys(raw).sort()) {
    const name = slugifyName(key);
    const value = slugify(raw[key]);
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

/** Sorted dimension names — the fact's signature. */
function dimensionSignature(dimensions = {}) {
  return Object.keys(dimensions).sort();
}

/**
 * Stable string form of the whole bag, used for the uniqueness index and for
 * the importer's new-vs-changed diff. The empty bag yields "" (programme total).
 */
function dimensionKey(dimensions = {}) {
  return Object.keys(dimensions)
    .sort()
    .map((name) => `${name}=${dimensions[name]}`)
    .join('|');
}

/**
 * Stable string form of a signature, e.g. ["gender","hub"] → "gender+hub".
 * Names are normalised here too so a query written as "Enterprise Stage"
 * matches facts stored under `enterprise_stage`.
 */
function signatureKey(signature = []) {
  return [...signature].map(slugifyName).filter(Boolean).sort().join('+');
}

/** Everything a Fact needs to store for a given dimension bag. */
function buildDimensionFields(raw = {}) {
  const dimensions = normalizeDimensions(raw);
  const signature = dimensionSignature(dimensions);
  return {
    dimensions,
    dimensionSignature: signature,
    dimensionSignatureKey: signatureKey(signature),
    dimensionKey: dimensionKey(dimensions),
  };
}

module.exports = {
  slugify,
  slugifyName,
  titleize,
  normalizeDimensions,
  dimensionSignature,
  dimensionKey,
  signatureKey,
  buildDimensionFields,
};
