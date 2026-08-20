const Metric = require('../models/Metric.model');
const Program = require('../models/Program.model');
const Fact = require('../models/Fact.model');
const { orgFigures, periodFilter } = require('./facts.service');
const { signatureKey, slugifyName } = require('../utils/dimensions');

/**
 * Derived views over the recorded facts: comparisons across programmes,
 * period-over-period change, and conversion between metrics.
 *
 * Everything here goes through `orgFigures`, which resolves one figure per
 * programme within a single dimension signature. Nothing in this file sums
 * across signatures, so a comparison can never report a number the programme
 * pages disagree with.
 */

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

/** Years that hold facts anywhere, newest first. */
async function yearsWithData() {
  const rows = await Fact.aggregate([
    { $match: { isCurrent: true, year: { $ne: null } } },
    { $group: { _id: '$year' } },
    { $sort: { _id: -1 } },
  ]);
  return rows.map((r) => r._id);
}

/**
 * Headline figures plus the change behind them.
 *
 * A delta is only reported when the same metric has a figure in two comparable
 * years. Facts recorded as all-time carry no year and are deliberately left out
 * of the series: comparing an all-time total against one year's figure would
 * manufacture growth that nobody recorded. A metric with one year of data gets
 * `delta: null` and an empty series, and the UI shows no badge rather than a
 * flattering one.
 */
async function scorecard({ year } = {}) {
  const metrics = await Metric.find({ isArchived: false, headlineOrder: { $ne: null } }).sort({
    headlineOrder: 1,
    category: 1,
    key: 1,
  });
  if (metrics.length === 0) return { totals: [], years: [] };

  const years = await yearsWithData();
  const current = await orgFigures({ metrics, year });

  // One reduction per year. The year list is short (the workbooks cover a
  // handful), and reusing the same primitive is what keeps a sparkline point
  // and the headline figure computed the same way.
  const byYear = new Map();
  for (const y of [...years].sort((a, b) => a - b)) {
    byYear.set(y, await orgFigures({ metrics, year: y }));
  }

  const totals = metrics.map((metric) => {
    const id = String(metric._id);
    const figure = current.get(id);

    const series = [];
    for (const [y, figures] of byYear) {
      const point = figures.get(id);
      if (point && point.total !== null) series.push({ year: y, value: point.total });
    }

    // With a year selected, compare like for like against the year before it.
    // Without one, compare the two most recent years that hold data.
    let delta = null;
    if (series.length >= 2) {
      const to = year ? series.find((p) => p.year === Number(year)) : series[series.length - 1];
      const from = to ? series.filter((p) => p.year < to.year).pop() : null;

      if (to && from && from.value !== 0) {
        delta = {
          from: from.value,
          to: to.value,
          fromYear: from.year,
          toYear: to.year,
          change: to.value - from.value,
          percent: ((to.value - from.value) / Math.abs(from.value)) * 100,
        };
      }
    }

    return {
      key: metric.key,
      label: metric.headlineLabel ?? metric.label,
      metricLabel: metric.label,
      description: metric.description ?? null,
      unit: metric.unit,
      value: figure.total,
      programCount: figure.contributions.length,
      basis: figure.total === null ? 'no_data' : figure.anyDerived ? 'partly_derived' : 'recorded_total',
      delta,
      series,
    };
  });

  return { totals, years };
}

/**
 * One metric ranked across every reportable programme.
 *
 * Without `groupBy` this reads the per-programme contributions straight off the
 * same reduction the organisation total uses, so the parts always add up to the
 * headline figure shown above them.
 *
 * With `groupBy` the query pins the signature to exactly that one dimension —
 * a programme that never recorded that breakdown is absent rather than being
 * represented by an unrelated total.
 */
async function compare({ metricKey, year, from, to, groupBy = null }) {
  const metric = await Metric.findOne({ key: metricKey, isArchived: false });
  if (!metric) throw notFound(`Unknown metric "${metricKey}".`);

  const meta = { key: metric.key, label: metric.label, unit: metric.unit, aggregation: metric.aggregation };

  if (!groupBy) {
    const figures = await orgFigures({ metrics: [metric], year, from, to });
    const figure = figures.get(String(metric._id));
    const total = figure.total;

    const rows = [...figure.contributions]
      .sort((a, b) => b.value - a.value)
      .map((c) => ({
        pageKey: c.pageKey,
        name: c.name,
        value: c.value,
        basis: c.basis,
        derivedFrom: c.derivedFrom,
        share: total ? c.value / total : null,
      }));

    return { metric: meta, groupBy: null, total, rows };
  }

  const dimension = slugifyName(groupBy);
  if (!metric.allowedDimensions.includes(dimension)) {
    throw Object.assign(new Error(`"${metric.label}" cannot be broken down by ${groupBy}.`), { status: 422 });
  }

  const programs = await Program.find({ isReportable: true, isArchived: false })
    .select('_id name pageKey')
    .lean();
  const programById = new Map(programs.map((p) => [String(p._id), p]));

  const rows = await Fact.aggregate([
    {
      $match: {
        isCurrent: true,
        metric: metric._id,
        program: { $in: programs.map((p) => p._id) },
        dimensionSignatureKey: signatureKey([dimension]),
        ...periodFilter({ year, from, to }),
      },
    },
    {
      $group: {
        _id: { program: '$program', value: `$dimensions.${dimension}` },
        sum: { $sum: '$value' },
        avg: { $avg: '$value' },
      },
    },
  ]);

  const byProgram = new Map();
  for (const row of rows) {
    const key = String(row._id.program);
    if (!byProgram.has(key)) byProgram.set(key, []);
    byProgram.get(key).push({
      value: row._id.value ?? 'unspecified',
      amount: metric.aggregation === 'avg' ? row.avg : row.sum,
    });
  }

  const grouped = [...byProgram.entries()]
    .map(([programId, segments]) => {
      const program = programById.get(programId);
      const subtotal = segments.reduce((sum, s) => sum + s.amount, 0);
      return {
        pageKey: program?.pageKey ?? null,
        name: program?.name ?? '',
        total: subtotal,
        segments: segments
          .sort((a, b) => b.amount - a.amount)
          .map((s) => ({ ...s, share: subtotal ? s.amount / subtotal : null })),
      };
    })
    .sort((a, b) => b.total - a.total);

  return { metric: meta, groupBy: dimension, total: null, rows: grouped };
}

/**
 * The training conversion: enrolled → graduated → employed.
 *
 * Each stage's conversion is measured against the stage immediately before it.
 * When a stage has nothing recorded, the stages after it report `conversion:
 * null` rather than silently measuring against an earlier stage — a 24%
 * employment rate computed off enrolment instead of graduation is a different
 * claim, and not one the data supports.
 */
const FUNNEL_STAGES = ['learners_total', 'graduates', 'graduates_employed'];

async function funnel({ year, from, to } = {}) {
  const found = await Metric.find({ key: { $in: FUNNEL_STAGES }, isArchived: false });
  const ordered = FUNNEL_STAGES.map((key) => found.find((m) => m.key === key)).filter(Boolean);
  if (ordered.length === 0) return { stages: [] };

  const figures = await orgFigures({ metrics: ordered, year, from, to });

  let previous = null;
  const stages = ordered.map((metric) => {
    const figure = figures.get(String(metric._id));
    const value = figure.total;

    const conversion = previous !== null && previous > 0 && value !== null ? value / previous : null;
    previous = value;

    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      value,
      programCount: figure.contributions.length,
      basis: value === null ? 'no_data' : figure.anyDerived ? 'partly_derived' : 'recorded_total',
      conversion,
    };
  });

  return { stages };
}

module.exports = { scorecard, compare, funnel, yearsWithData };
