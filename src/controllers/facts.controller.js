const Program = require('../models/Program.model');
const Metric = require('../models/Metric.model');
const Dimension = require('../models/Dimension.model');
const Fact = require('../models/Fact.model');
const facts = require('../services/facts.service');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');
const { buildPeriod } = require('../utils/period');
const { dimensionKey, normalizeDimensions, slugifyName } = require('../utils/dimensions');

async function findProgramOr404(res, pageKeyOrId) {
  const program = await Program.findOne({
    $or: [{ pageKey: pageKeyOrId }, ...(pageKeyOrId.match(/^[a-f\d]{24}$/i) ? [{ _id: pageKeyOrId }] : [])],
  });
  if (!program) {
    sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Program not found.' });
    return null;
  }
  return program;
}

function parseGroupBy(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** GET /api/v1/facts/aggregate — grouped values for one metric. */
async function getAggregate(req, res, next) {
  try {
    const { program: pageKey, metric, groupBy, includeDescendants, periodType, year, from, to, splitByPeriod } = req.query;

    let programId = null;
    if (pageKey) {
      const program = await findProgramOr404(res, pageKey);
      if (!program) return;
      programId = program._id;
    }

    const result = await facts.aggregate({
      programId,
      metricKey: metric,
      groupBy: parseGroupBy(groupBy),
      includeDescendants: includeDescendants === 'true',
      periodType,
      year,
      from,
      to,
      splitByPeriod: splitByPeriod === 'true',
    });

    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/facts/total — single headline number plus how it was derived. */
async function getTotal(req, res, next) {
  try {
    const { program: pageKey, metric, includeDescendants, periodType, year, from, to } = req.query;

    let programId = null;
    if (pageKey) {
      const program = await findProgramOr404(res, pageKey);
      if (!program) return;
      programId = program._id;
    }

    const result = await facts.resolveTotal({
      programId,
      metricKey: metric,
      includeDescendants: includeDescendants === 'true',
      periodType,
      year,
      from,
      to,
    });

    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/facts/org-totals — the Overview figures, all derived. */
async function getOrgTotals(req, res, next) {
  try {
    const totals = await facts.orgTotals({
      year: req.query.year,
      from: req.query.from,
      to: req.query.to,
    });
    sendSuccess(res, 200, { data: { totals } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/facts/summary — everything one programme page needs, in one call. */
async function getSummary(req, res, next) {
  try {
    const program = await findProgramOr404(res, req.query.program);
    if (!program) return;

    // Container nodes hold no facts of their own, so they roll up their children.
    const includeDescendants = req.query.includeDescendants === 'true' || !program.isReportable;

    const [summary, years] = await Promise.all([
      facts.programSummary({ programId: program._id, includeDescendants, year: req.query.year }),
      facts.availableYears({ programId: program._id, includeDescendants }),
    ]);

    sendSuccess(res, 200, {
      data: {
        program: {
          id: program.id,
          pageKey: program.pageKey,
          name: program.name,
          description: program.description,
          isReportable: program.isReportable,
        },
        rolledUp: includeDescendants,
        availableYears: years,
        metrics: summary.metrics,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/facts/history — every version behind one number. */
async function getHistory(req, res, next) {
  try {
    const { program: pageKey, metric, periodType, periodStart, dimensions } = req.query;

    const program = await findProgramOr404(res, pageKey);
    if (!program) return;

    const versions = await facts.history({
      programId: program._id,
      metricKey: metric,
      periodType: periodType ?? 'all_time',
      periodStart: periodStart ?? null,
      dimensionKey: dimensions ? dimensionKey(normalizeDimensions(JSON.parse(dimensions))) : '',
    });

    sendSuccess(res, 200, { data: { versions } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/facts — manual entry. Append-only; never overwrites in place. */
async function createFact(req, res, next) {
  try {
    const { program: pageKey, metric: metricKey, periodType, year, month, quarter, dimensions, value, note } = req.body;

    const program = await findProgramOr404(res, pageKey);
    if (!program) return;

    if (!program.isReportable) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `"${program.name}" is a grouping, not a reportable programme. Record this against one of its programmes instead.`,
      });
      return;
    }

    const metric = await Metric.findOne({ key: metricKey, isArchived: false });
    if (!metric) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Unknown metric "${metricKey}".` });
      return;
    }

    // Resolve each breakdown against the catalog. Open dimensions (cohort, hub,
    // region, sector) accept new values and grow; closed ones reject unknowns
    // with the list of what is valid.
    const requested = Object.entries(dimensions ?? {}).filter(([, v]) => v !== '' && v != null);

    const disallowed = requested
      .map(([name]) => slugifyName(name))
      .filter((name) => !metric.allowedDimensions.includes(name));
    if (disallowed.length > 0) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `"${metric.label}" cannot be broken down by: ${disallowed.join(', ')}.`,
      });
      return;
    }

    const normalized = {};
    const addedValues = [];

    for (const [rawName, rawValue] of requested) {
      const name = slugifyName(rawName);
      const dimension = await Dimension.findOne({ name });

      if (!dimension) {
        sendError(res, 404, {
          code: ERROR_CODES.NOT_FOUND,
          message: `Unknown breakdown "${rawName}".`,
        });
        return;
      }

      const resolved = await dimension.resolveOrCreate(rawValue);

      if (!resolved.value) {
        sendError(res, 422, {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: resolved.closed
            ? `"${rawValue}" is not a valid ${dimension.label}. Choose one of: ${dimension.values.map((v) => v.label).join(', ')}.`
            : `"${rawValue}" is not a usable ${dimension.label}.`,
        });
        return;
      }

      normalized[name] = resolved.value;
      if (resolved.created) addedValues.push(`${resolved.label} (${dimension.label})`);
    }

    const { fact, outcome } = await facts.writeFactAudited(
      {
        program,
        metric,
        period: buildPeriod({ periodType, year, month, quarter }),
        dimensions: normalized,
        value,
        source: 'manual',
        user: req.user,
        note,
      },
      req
    );

    const base =
      outcome === 'unchanged'
        ? 'That value was already recorded — nothing changed.'
        : outcome === 'updated'
          ? 'Value revised. The previous version is kept in history.'
          : 'Value recorded.';

    sendSuccess(res, outcome === 'created' ? 201 : 200, {
      data: { fact, outcome, addedValues },
      // Adding a catalog value is a side effect worth stating, so a typo does
      // not quietly become a permanent new cohort or hub.
      message: addedValues.length ? `${base} Added ${addedValues.join(', ')} to the catalog.` : base,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/facts — raw fact rows, for inspection and export. */
async function listFacts(req, res, next) {
  try {
    const filter = { isCurrent: req.query.includeSuperseded === 'true' ? { $in: [true, false] } : true };

    if (req.query.program) {
      const program = await findProgramOr404(res, req.query.program);
      if (!program) return;
      filter.program = program._id;
    }
    if (req.query.metric) {
      const metric = await Metric.findOne({ key: req.query.metric });
      if (!metric) {
        sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Unknown metric "${req.query.metric}".` });
        return;
      }
      filter.metric = metric._id;
    }
    if (req.query.year) filter.year = Number(req.query.year);
    if (req.query.batch) filter.batch = req.query.batch;

    const limit = Math.min(Number(req.query.limit ?? 200), 1000);

    const rows = await Fact.find(filter)
      .sort({ periodStart: 1, dimensionKey: 1 })
      .limit(limit)
      .populate('program', 'pageKey name')
      .populate('metric', 'key label unit')
      .populate('enteredBy', 'firstName lastName')
      .lean();

    sendSuccess(res, 200, { data: { facts: rows }, meta: { count: rows.length, limit } });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAggregate, getTotal, getOrgTotals, getSummary, getHistory, createFact, listFacts };
