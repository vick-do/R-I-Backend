const mongoose = require('mongoose');
require('../models'); // history() populates ImportBatch, which must be registered
const Fact = require('../models/Fact.model');
const Metric = require('../models/Metric.model');
const Program = require('../models/Program.model');
const { buildDimensionFields, signatureKey, slugifyName } = require('../utils/dimensions');
const { buildPeriod } = require('../utils/period');
const audit = require('./audit.service');

/**
 * Writes a fact append-only.
 *
 * If a current fact already exists at the same coordinate
 * (program × metric × period × dimensions):
 *   • identical value  → no-op, so re-running an import is harmless
 *   • different value  → the existing row is marked superseded and a new
 *                        version is written, preserving the old number
 *
 * Returns { fact, outcome } where outcome is 'created' | 'updated' | 'unchanged'.
 */
async function writeFact({
  program,
  metric,
  period,
  dimensions = {},
  value,
  source = 'manual',
  sourceRef = null,
  batch = null,
  user = null,
  note = null,
  session = null,
}) {
  const dimFields = buildDimensionFields(dimensions);
  const periodFields = period.periodType ? period : buildPeriod(period);

  const coordinate = {
    program: program._id ?? program,
    metric: metric._id ?? metric,
    periodType: periodFields.periodType,
    periodStart: periodFields.periodStart,
    dimensionKey: dimFields.dimensionKey,
    isCurrent: true,
  };

  const existing = await Fact.findOne(coordinate).session(session);

  if (existing && existing.value === Number(value)) {
    return { fact: existing, outcome: 'unchanged' };
  }

  if (existing) {
    existing.isCurrent = false;
    await existing.save({ session });
  }

  const [fact] = await Fact.create(
    [
      {
        program: coordinate.program,
        metric: coordinate.metric,
        periodType: periodFields.periodType,
        periodStart: periodFields.periodStart,
        periodEnd: periodFields.periodEnd,
        periodLabel: periodFields.periodLabel,
        year: periodFields.year ?? null,
        ...dimFields,
        value: Number(value),
        source,
        sourceRef,
        batch,
        version: existing ? existing.version + 1 : 1,
        isCurrent: true,
        supersedes: existing?._id ?? null,
        enteredBy: user?._id ?? user ?? null,
        note,
      },
    ],
    { session }
  );

  return { fact, outcome: existing ? 'updated' : 'created' };
}

/** Writes a fact and records an audit entry. Used by the manual-entry path. */
async function writeFactAudited(params, req) {
  const { fact, outcome } = await writeFact(params);
  if (outcome !== 'unchanged') {
    await audit.record({
      action: outcome === 'created' ? 'fact.create' : 'fact.update',
      entityType: 'Fact',
      entityId: fact._id,
      actor: params.user,
      after: { value: fact.value, periodLabel: fact.periodLabel, dimensionKey: fact.dimensionKey },
      summary: `${outcome === 'created' ? 'Recorded' : 'Revised'} ${fact.periodLabel} → ${fact.value}`,
      req,
    });
  }
  return { fact, outcome };
}

/** Program ids to include when a query rolls a container up over its children. */
async function resolveProgramIds(programId, { includeDescendants = false } = {}) {
  const id = new mongoose.Types.ObjectId(programId);
  if (!includeDescendants) return [id];
  const descendants = await Program.find({ ancestors: id }).select('_id').lean();
  return [id, ...descendants.map((d) => d._id)];
}

function periodFilter({ periodType, year, from, to }) {
  const filter = {};
  if (periodType) filter.periodType = periodType;
  if (year) filter.year = Number(year);
  if (from || to) {
    filter.periodStart = {};
    if (from) filter.periodStart.$gte = new Date(from);
    if (to) filter.periodStart.$lt = new Date(to);
  }
  return filter;
}

function accumulator(aggregation) {
  // 'latest' is resolved after grouping, since it needs the newest period
  // rather than an arithmetic combination.
  return aggregation === 'avg' ? { $avg: '$value' } : { $sum: '$value' };
}

/**
 * Aggregates one metric.
 *
 * `groupBy` pins an exact dimension signature. Only facts broken down by
 * precisely those dimensions are combined — never a mix of totals and
 * breakdowns, which is what would otherwise double-count.
 */
async function aggregate({
  programId,
  metricKey,
  groupBy = [],
  includeDescendants = false,
  periodType,
  year,
  from,
  to,
  splitByPeriod = false,
}) {
  const metric = await Metric.findOne({ key: metricKey });
  if (!metric) {
    throw Object.assign(new Error(`Unknown metric "${metricKey}".`), { status: 404 });
  }

  const programIds = programId ? await resolveProgramIds(programId, { includeDescendants }) : null;

  return aggregateCore({ programIds, metric, groupBy, periodType, year, from, to, splitByPeriod });
}

/**
 * The aggregation itself, taking an already-resolved metric document and
 * programme id list.
 *
 * Callers that run many aggregations at once (programSummary) resolve those
 * once and reuse them. Going through the public `aggregate` instead would
 * re-query the metric and re-walk the programme tree for every single call —
 * on a roll-up node that turned ~60 aggregations into ~180 round trips.
 */
async function aggregateCore({
  programIds,
  metric,
  groupBy = [],
  periodType,
  year,
  from,
  to,
  splitByPeriod = false,
}) {
  // Normalise the requested names the same way stored facts were normalised,
  // so the signature the query asks for is the signature facts were stored with.
  const normalizedGroupBy = groupBy.map(slugifyName).filter(Boolean);

  const match = {
    isCurrent: true,
    metric: metric._id,
    dimensionSignatureKey: signatureKey(normalizedGroupBy),
    ...periodFilter({ periodType, year, from, to }),
  };

  if (programIds) {
    match.program = { $in: programIds };
  }

  const groupId = {};
  for (const name of [...normalizedGroupBy].sort()) {
    groupId[name] = `$dimensions.${name}`;
  }
  if (splitByPeriod) {
    groupId.periodStart = '$periodStart';
    groupId.periodLabel = '$periodLabel';
  }

  const rows = await Fact.aggregate([
    { $match: match },
    {
      $group: {
        _id: Object.keys(groupId).length ? groupId : null,
        value: accumulator(metric.aggregation),
        factCount: { $sum: 1 },
        latestValue: { $last: '$value' },
        latestPeriod: { $max: '$periodStart' },
      },
    },
    { $sort: { '_id.periodStart': 1, value: -1 } },
  ]);

  return {
    metric: {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      aggregation: metric.aggregation,
    },
    groupBy: [...normalizedGroupBy].sort(),
    rows: rows.map((row) => ({
      dimensions: row._id
        ? Object.fromEntries(Object.entries(row._id).filter(([k]) => !['periodStart', 'periodLabel'].includes(k)))
        : {},
      periodStart: row._id?.periodStart ?? null,
      periodLabel: row._id?.periodLabel ?? null,
      value: metric.aggregation === 'latest' ? row.latestValue : row.value,
      factCount: row.factCount,
    })),
  };
}

/**
 * Best available single number for a metric.
 *
 * Prefers a directly recorded programme total (signature []). When none exists,
 * falls back to summing the finest complete breakdown and reports which basis
 * was used, so the dashboard can show the number's provenance rather than
 * presenting a derived figure as if it had been entered directly.
 */
async function resolveTotal({ programId, metricKey, includeDescendants = false, periodType, year, from, to }) {
  const metric = await Metric.findOne({ key: metricKey });
  if (!metric) {
    throw Object.assign(new Error(`Unknown metric "${metricKey}".`), { status: 404 });
  }
  const programIds = programId ? await resolveProgramIds(programId, { includeDescendants }) : null;

  return resolveTotalCore({ programIds, metric, periodType, year, from, to });
}

/** resolveTotal against an already-resolved metric and programme id list. */
async function resolveTotalCore({ programIds, metric, periodType, year, from, to, signatures }) {
  const direct = await aggregateCore({
    programIds, metric, groupBy: [], periodType, year, from, to,
  });

  if (direct.rows.length > 0) {
    return { ...direct, total: direct.rows[0].value, basis: 'recorded_total' };
  }

  // The caller may already know which signatures exist; only look them up when
  // it does not.
  let available = signatures;
  if (!available) {
    const match = {
      isCurrent: true,
      metric: metric._id,
      ...periodFilter({ periodType, year, from, to }),
    };
    if (programIds) match.program = { $in: programIds };

    const rows = await Fact.aggregate([
      { $match: match },
      { $group: { _id: '$dimensionSignature', count: { $sum: 1 } } },
    ]);
    available = rows.map((r) => r._id);
  }

  if (available.length === 0) {
    return { ...direct, total: null, basis: 'no_data' };
  }

  // Prefer the breakdown with the fewest dimensions — it is the closest thing
  // to a total that the data actually contains.
  const finest = [...available].sort((a, b) => a.length - b.length)[0];

  const derived = await aggregateCore({
    programIds, metric, groupBy: finest, periodType, year, from, to,
  });

  const total = derived.rows.reduce((sum, row) => sum + row.value, 0);

  return {
    ...derived,
    total: metric.aggregation === 'avg' && derived.rows.length ? total / derived.rows.length : total,
    basis: 'derived_from_breakdown',
    derivedFrom: finest,
  };
}

/**
 * The Overview's headline figures.
 *
 * Each programme contributes exactly one number per metric: its recorded total
 * when it has one, otherwise the sum of its finest breakdown. Taking one figure
 * per programme is what makes the roll-up safe — signatures are resolved within
 * a programme and never mixed across one.
 *
 * This is why Web3 counts. It records only a gender split (26 + 12) with no
 * standalone total; the previous implementation matched on signature `[]` only
 * and silently dropped those 38 learners from the organisation figure.
 *
 * Metrics with `headlineOrder` are returned in that order and are always
 * present, even with no data — "not yet measured" and "zero" are different
 * statements and the Overview must not conflate them.
 */
async function orgTotals({ year, from, to, headlineOnly = true } = {}) {
  const metricFilter = { isArchived: false };
  if (headlineOnly) metricFilter.headlineOrder = { $ne: null };
  else metricFilter.rollsUpToOrgTotal = true;

  const metrics = await Metric.find(metricFilter).sort({ headlineOrder: 1, category: 1, key: 1 });
  if (metrics.length === 0) return [];

  const programs = await Program.find({ isReportable: true, isArchived: false }).select('_id name').lean();
  const programIds = programs.map((p) => p._id);

  // One pass over every headline metric across every reportable programme.
  const rows = await Fact.aggregate([
    {
      $match: {
        isCurrent: true,
        metric: { $in: metrics.map((m) => m._id) },
        program: { $in: programIds },
        ...periodFilter({ year, from, to }),
      },
    },
    {
      $group: {
        _id: { metric: '$metric', program: '$program', signature: '$dimensionSignature' },
        sum: { $sum: '$value' },
        avg: { $avg: '$value' },
      },
    },
  ]);

  return metrics.map((metric) => {
    const forMetric = rows.filter((r) => String(r._id.metric) === String(metric._id));

    // Bucket by programme, then choose one figure per programme.
    const byProgram = new Map();
    for (const row of forMetric) {
      const key = String(row._id.program);
      if (!byProgram.has(key)) byProgram.set(key, []);
      byProgram.get(key).push(row);
    }

    const contributions = [];
    let anyDerived = false;

    for (const buckets of byProgram.values()) {
      const recorded = buckets.find((b) => (b._id.signature ?? []).length === 0);
      if (recorded) {
        contributions.push(metric.aggregation === 'avg' ? recorded.avg : recorded.sum);
        continue;
      }
      // No recorded total: sum the breakdown with the fewest dimensions.
      const finestLength = Math.min(...buckets.map((b) => (b._id.signature ?? []).length));
      const finest = buckets.filter((b) => (b._id.signature ?? []).length === finestLength);
      const values = finest.map((b) => (metric.aggregation === 'avg' ? b.avg : b.sum));
      const combined = values.reduce((sum, v) => sum + v, 0);
      contributions.push(metric.aggregation === 'avg' ? combined / values.length : combined);
      anyDerived = true;
    }

    const value = contributions.length
      ? metric.aggregation === 'avg'
        ? contributions.reduce((s, v) => s + v, 0) / contributions.length
        : contributions.reduce((s, v) => s + v, 0)
      : null;

    return {
      key: metric.key,
      label: metric.headlineLabel ?? metric.label,
      metricLabel: metric.label,
      description: metric.description ?? null,
      unit: metric.unit,
      value,
      programCount: contributions.length,
      basis: value === null ? 'no_data' : anyDerived ? 'partly_derived' : 'recorded_total',
    };
  });
}

/**
 * Everything a programme page needs, in one request: each metric that has data,
 * its headline figure, every breakdown actually recorded for it, and a monthly
 * trend where monthly facts exist.
 *
 * Built from the signatures present in the data rather than from the metric's
 * allowed list, so a page only ever renders breakdowns that exist.
 */
async function programSummary({ programId, includeDescendants = false, year }) {
  const programIds = await resolveProgramIds(programId, { includeDescendants });
  const baseMatch = { isCurrent: true, program: { $in: programIds }, ...periodFilter({ year }) };

  // Two pipelines compute the whole page.
  //
  // Grouping by metric AND dimensionSignatureKey in a single pass keeps every
  // signature in its own bucket — the anti-double-count invariant holds exactly
  // as it does in `aggregateCore` — while collapsing what was ~60 sequential
  // round trips (one per metric per breakdown) into two. On a hosted database
  // that is the difference between a 4-second page and a fast one.
  const [combined, monthly] = await Promise.all([
    Fact.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { metric: '$metric', signature: '$dimensionSignature', dimensions: '$dimensions' },
          sum: { $sum: '$value' },
          avg: { $avg: '$value' },
          count: { $sum: 1 },
        },
      },
    ]),
    Fact.aggregate([
      { $match: { ...baseMatch, periodType: 'month' } },
      {
        $group: {
          _id: {
            metric: '$metric',
            signature: '$dimensionSignature',
            dimensions: '$dimensions',
            periodStart: '$periodStart',
            periodLabel: '$periodLabel',
          },
          sum: { $sum: '$value' },
          avg: { $avg: '$value' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.periodStart': 1 } },
    ]),
  ]);

  if (combined.length === 0) return { metrics: [] };

  const metricIds = [...new Set(combined.map((row) => String(row._id.metric)))];
  // displayOrder decides which figure leads the page and is charted by default.
  const metrics = await Metric.find({ _id: { $in: metricIds } }).sort({ displayOrder: 1, label: 1 });

  /** Rows for one metric, bucketed by signature key. */
  const bucket = (rows, metricId) => {
    const out = new Map();
    for (const row of rows) {
      if (String(row._id.metric) !== String(metricId)) continue;
      const key = signatureKey(row._id.signature ?? []);
      if (!out.has(key)) out.set(key, { signature: row._id.signature ?? [], rows: [] });
      out.get(key).rows.push(row);
    }
    return out;
  };

  const readValue = (row, metric) => (metric.aggregation === 'avg' ? row.avg : row.sum);

  const toRow = (row, metric) => ({
    dimensions: row._id.dimensions ?? {},
    periodStart: row._id.periodStart ?? null,
    periodLabel: row._id.periodLabel ?? null,
    value: readValue(row, metric),
    factCount: row.count,
  });

  return {
    metrics: metrics.map((metric) => {
      const buckets = bucket(combined, metric._id);
      const monthlyBuckets = bucket(monthly, metric._id);

      const totalBucket = buckets.get('');
      const singleDimension = [...buckets.values()]
        .filter((b) => b.signature.length === 1)
        .sort((a, b) => a.signature[0].localeCompare(b.signature[0]));

      // Same precedence as resolveTotal: a recorded total wins; otherwise sum
      // the finest breakdown and say so.
      let total = null;
      let basis = 'no_data';
      let derivedFrom = null;

      if (totalBucket) {
        total = readValue(totalBucket.rows[0], metric);
        basis = 'recorded_total';
      } else {
        const finest = [...buckets.values()].sort((a, b) => a.signature.length - b.signature.length)[0];
        if (finest) {
          const values = finest.rows.map((r) => readValue(r, metric));
          const summed = values.reduce((sum, v) => sum + v, 0);
          total = metric.aggregation === 'avg' ? summed / values.length : summed;
          basis = 'derived_from_breakdown';
          derivedFrom = finest.signature;
        }
      }

      const trendBucket =
        monthlyBuckets.get(signatureKey(singleDimension[0]?.signature ?? [])) ?? monthlyBuckets.get('');

      return {
        key: metric.key,
        label: metric.label,
        unit: metric.unit,
        aggregation: metric.aggregation,
        category: metric.category,
        total,
        basis,
        derivedFrom,
        breakdowns: singleDimension.map((b) => ({
          dimension: b.signature[0],
          rows: b.rows.map((r) => toRow(r, metric)).sort((a, x) => x.value - a.value),
        })),
        trend: trendBucket
          ? {
              groupBy: trendBucket.signature[0] ?? null,
              rows: trendBucket.rows.map((r) => toRow(r, metric)),
            }
          : null,
      };
    }),
  };
}

/** Years that have data, for the period selector. */
async function availableYears({ programId, includeDescendants = false } = {}) {
  const match = { isCurrent: true, year: { $ne: null } };
  if (programId) match.program = { $in: await resolveProgramIds(programId, { includeDescendants }) };

  const rows = await Fact.aggregate([
    { $match: match },
    { $group: { _id: '$year' } },
    { $sort: { _id: -1 } },
  ]);
  return rows.map((r) => r._id);
}

/** Full revision history for one coordinate, newest first — drill-to-source. */
async function history({ programId, metricKey, periodType, periodStart, dimensionKey = '' }) {
  const metric = await Metric.findOne({ key: metricKey });
  if (!metric) {
    throw Object.assign(new Error(`Unknown metric "${metricKey}".`), { status: 404 });
  }

  return Fact.find({
    program: programId,
    metric: metric._id,
    periodType,
    periodStart: periodStart ? new Date(periodStart) : null,
    dimensionKey,
  })
    .sort({ version: -1 })
    .populate('enteredBy', 'firstName lastName email')
    .populate('batch', 'fileName sheetName committedAt')
    .lean();
}

module.exports = {
  writeFact,
  writeFactAudited,
  aggregate,
  resolveTotal,
  orgTotals,
  programSummary,
  availableYears,
  history,
  resolveProgramIds,
  periodFilter,
};
