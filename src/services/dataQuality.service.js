const Fact = require('../models/Fact.model');
const Metric = require('../models/Metric.model');
const Program = require('../models/Program.model');
const ImportBatch = require('../models/ImportBatch.model');
const Dimension = require('../models/Dimension.model');
const { periodFilter } = require('./facts.service');

// A breakdown reaching less than this share of the whole is treated as missing
// rows rather than as a figure that disagrees.
const COVERAGE_THRESHOLD = 0.95;

/**
 * Finds where the recorded data disagrees with itself.
 */

/**
 * Every place one programme's figure for one metric and period differs
 * depending on which breakdown you read.
 *
 * A programme may legitimately record a total AND a breakdown of it — Grow
 * holds both 793 and Accra 402 + Whizzy 236 + Woman's Haven 155, which agree.
 * When they do not agree, that is a fact about the source data, and it is the
 * single most valuable thing this platform can tell the R&I team. Pre-Mest is
 * the live example: 761 stated, 759 by gender, 757 by track.
 *
 * Signatures are compared, never summed together — the same rule that keeps
 * aggregation honest is what makes the disagreement detectable at all.
 */
async function signatureDivergence({ year, tolerance = 0.005 } = {}) {
  const rows = await Fact.aggregate([
    { $match: { isCurrent: true, ...periodFilter({ year }) } },
    {
      $group: {
        _id: {
          program: '$program',
          metric: '$metric',
          periodType: '$periodType',
          periodStart: '$periodStart',
          periodLabel: '$periodLabel',
          signature: '$dimensionSignature',
        },
        total: { $sum: '$value' },
        parts: { $sum: 1 },
      },
    },
  ]);

  const groups = new Map();
  for (const row of rows) {
    const key = [
      String(row._id.program),
      String(row._id.metric),
      row._id.periodType,
      row._id.periodStart?.toISOString() ?? 'null',
    ].join('::');

    if (!groups.has(key)) groups.set(key, { id: row._id, readings: [] });
    groups.get(key).readings.push({
      signature: row._id.signature ?? [],
      total: row.total,
      parts: row.parts,
    });
  }

  const conflicting = [...groups.values()].filter((g) => {
    if (g.readings.length < 2) return false;
    const values = g.readings.map((r) => r.total);
    return Math.max(...values) - Math.min(...values) > tolerance;
  });
  if (conflicting.length === 0) return [];

  const [metrics, programs, dimensions] = await Promise.all([
    Metric.find({ _id: { $in: conflicting.map((g) => g.id.metric) } }).select('key label unit').lean(),
    Program.find({ _id: { $in: conflicting.map((g) => g.id.program) } }).select('pageKey name').lean(),
    Dimension.find().select('name label').lean(),
  ]);

  const metricById = new Map(metrics.map((m) => [String(m._id), m]));
  const programById = new Map(programs.map((p) => [String(p._id), p]));
  const dimensionLabel = new Map(dimensions.map((d) => [d.name, d.label]));

  const describe = (signature) =>
    signature.length === 0
      ? 'Recorded programme total'
      : `Sum of the ${signature.map((s) => (dimensionLabel.get(s) ?? s).toLowerCase()).join(' × ')} breakdown`;

  return conflicting
    .flatMap((group) => {
      const metric = metricById.get(String(group.id.metric));
      const program = programById.get(String(group.id.program));
      const label = (metric?.label ?? 'figure').toLowerCase();
      const name = program?.name ?? 'A programme';

      const readings = [...group.readings].sort((a, b) => b.total - a.total);
      // The recorded total is the yardstick when there is one; otherwise the
      // largest reading stands in for the full population.
      const reference = readings.find((r) => r.signature.length === 0)?.total ?? readings[0].total;

      const shared = {
        programPageKey: program?.pageKey ?? null,
        programName: name,
        metricKey: metric?.key ?? null,
        metricLabel: metric?.label ?? 'Unknown metric',
        unit: metric?.unit ?? 'count',
        period: group.id.periodLabel,
      };

      const toReading = (r) => ({
        basis: describe(r.signature),
        signature: r.signature,
        value: r.total,
        parts: r.parts,
      });

      // A breakdown covering well under the whole is missing rows, not
      // disagreeing about them — MEST Scale's sector split covers 101 of 112
      // enterprises because eleven have no sector recorded. Reporting that as
      // a conflicting figure would bury the ones that genuinely conflict.
      const incomplete = readings.filter(
        (r) => r.signature.length > 0 && reference > 0 && r.total / reference < COVERAGE_THRESHOLD
      );
      const comparable = readings.filter((r) => !incomplete.includes(r));

      const issues = [];

      if (comparable.length > 1) {
        const spread = comparable[0].total - comparable[comparable.length - 1].total;
        if (spread > tolerance) {
          issues.push({
            ...shared,
            kind: 'conflicting_values',
            severity: 'error',
            spread,
            readings: comparable.map(toReading),
            title: `${name}'s ${label} has ${comparable.length} different values`,
          });
        }
      }

      for (const reading of incomplete) {
        issues.push({
          ...shared,
          kind: 'incomplete_breakdown',
          severity: 'warning',
          spread: reference - reading.total,
          readings: [toReading(reading), ...comparable.slice(0, 1).map(toReading)],
          title: `${name}'s ${describe(reading.signature).toLowerCase()} covers ${reading.total} of ${reference}`,
          detail: `${reference - reading.total} of the ${reference} recorded have no ${reading.signature
            .map((s) => (dimensionLabel.get(s) ?? s).toLowerCase())
            .join(' or ')} against them.`,
        });
      }

      return issues;
    })
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.spread - a.spread;
    });
}

/**
 * Reconciliation checks that failed on a committed batch — a total the sheet
 * states that its own rows do not add up to.
 */
async function failedReconciliations() {
  const batches = await ImportBatch.find({ status: 'committed', 'checks.status': 'fail' })
    .sort({ committedAt: -1 })
    .limit(50)
    .populate('program', 'pageKey name')
    .lean();

  return batches.flatMap((batch) =>
    (batch.checks ?? [])
      .filter((check) => check.status === 'fail')
      .map((check) => ({
        kind: 'reconciliation_failed',
        severity: 'warning',
        programPageKey: batch.program?.pageKey ?? null,
        programName: batch.program?.name ?? '',
        title: batch.program?.name
          ? `${batch.program.name}: ${check.label} does not reconcile`
          : `${check.label} does not reconcile`,
        detail: `The source states ${check.expected}, its rows sum to ${check.actual} — a difference of ${check.difference}.`,
        sourceRef: check.sourceRef ?? batch.fileName,
        committedAt: batch.committedAt,
      }))
  );
}

/** Which programme × metric pairs hold data, for a coverage grid. */
async function coverage() {
  const [programs, metrics, rows] = await Promise.all([
    Program.find({ isReportable: true, isArchived: false }).select('pageKey name metricKeys').lean(),
    Metric.find({ isArchived: false }).sort({ displayOrder: 1 }).select('key label category').lean(),
    Fact.aggregate([
      { $match: { isCurrent: true } },
      { $group: { _id: { program: '$program', metric: '$metric' }, count: { $sum: 1 } } },
    ]),
  ]);

  const recorded = new Set(rows.map((r) => `${r._id.program}::${r._id.metric}`));
  const metricById = new Map(metrics.map((m) => [String(m._id), m]));
  const byProgram = new Map();

  for (const row of rows) {
    const key = String(row._id.program);
    if (!byProgram.has(key)) byProgram.set(key, new Set());
    const metric = metricById.get(String(row._id.metric));
    if (metric) byProgram.get(key).add(metric.key);
  }

  return {
    metrics: metrics.map((m) => ({ key: m.key, label: m.label, category: m.category })),
    programs: programs.map((p) => ({
      pageKey: p.pageKey,
      name: p.name,
      // Metrics the programme is expected to report, per the catalog.
      expected: p.metricKeys ?? [],
      recorded: [...(byProgram.get(String(p._id)) ?? [])],
    })),
    recordedPairs: recorded.size,
  };
}

/** Everything the data-quality console shows, in one call. */
async function report({ year } = {}) {
  const [divergence, reconciliations, cover] = await Promise.all([
    signatureDivergence({ year }),
    failedReconciliations(),
    coverage(),
  ]);

  const issues = [...divergence, ...reconciliations];

  return {
    issues,
    counts: {
      total: issues.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    },
    coverage: cover,
  };
}

module.exports = { signatureDivergence, failedReconciliations, coverage, report };
