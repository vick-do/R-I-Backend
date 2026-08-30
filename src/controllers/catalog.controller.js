const Program = require('../models/Program.model');
const Metric = require('../models/Metric.model');
const Dimension = require('../models/Dimension.model');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');
const audit = require('../services/audit.service');
const catalog = require('../services/catalog.cache');

function formatProgram(program) {
  return {
    id: program.id ?? String(program._id),
    pageKey: program.pageKey,
    name: program.name,
    parent: program.parent ? String(program.parent) : null,
    depth: program.depth,
    order: program.order,
    category: program.category,
    metricKeys: program.metricKeys,
    description: program.description,
    navLabel: program.navLabel ?? null,
    isReportable: program.isReportable,
    allowsManualEntry: program.allowsManualEntry !== false,
  };
}

/** Returns the programme tree, nested to mirror the dashboard navigation. */
async function listPrograms(req, res, next) {
  try {
    const flat = (await catalog.programs()).filter((p) => !p.isArchived);

    if (req.query.flat === 'true') {
      sendSuccess(res, 200, { data: { programs: flat.map(formatProgram) } });
      return;
    }

    const byId = new Map();
    for (const p of flat) byId.set(String(p._id), { ...formatProgram(p), children: [] });

    const roots = [];
    for (const p of flat) {
      const node = byId.get(String(p._id));
      const parent = p.parent ? byId.get(String(p.parent)) : null;
      parent ? parent.children.push(node) : roots.push(node);
    }

    sendSuccess(res, 200, { data: { programs: roots } });
  } catch (err) {
    next(err);
  }
}

async function getProgram(req, res, next) {
  try {
    const program = await Program.findOne({ pageKey: req.params.pageKey, isArchived: false });
    if (!program) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Program not found.' });
      return;
    }

    // The metrics this programme reports on, resolved for form generation.
    const metrics = await Metric.find({ key: { $in: program.metricKeys }, isArchived: false });

    sendSuccess(res, 200, {
      data: { program: formatProgram(program), metrics },
    });
  } catch (err) {
    next(err);
  }
}

async function listMetrics(req, res, next) {
  try {
    const all = await catalog.metrics();
    const metrics = req.query.category ? all.filter((m) => m.category === req.query.category) : all;
    sendSuccess(res, 200, { data: { metrics } });
  } catch (err) {
    next(err);
  }
}

async function createMetric(req, res, next) {
  try {
    const existing = await Metric.findOne({ key: req.body.key.toLowerCase() });
    if (existing) {
      sendError(res, 409, { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'A metric with that key already exists.' });
      return;
    }

    const metric = await Metric.create(req.body);
    catalog.invalidate('metrics');

    await audit.record({
      action: 'metric.create',
      entityType: 'Metric',
      entityId: metric._id,
      actor: req.user,
      after: metric.toObject(),
      summary: `Added metric "${metric.label}"`,
      req,
    });

    sendSuccess(res, 201, { data: { metric }, message: 'Metric created.' });
  } catch (err) {
    next(err);
  }
}

async function updateMetric(req, res, next) {
  try {
    const metric = await Metric.findOne({ key: req.params.key });
    if (!metric) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Metric not found.' });
      return;
    }

    const before = metric.toObject();
    // `key` is the stable identifier facts are written against, so it is not editable.
    const { key: _ignored, ...updates } = req.body;
    Object.assign(metric, updates);
    await metric.save();
    catalog.invalidate('metrics');

    await audit.record({
      action: 'metric.update',
      entityType: 'Metric',
      entityId: metric._id,
      actor: req.user,
      before,
      after: metric.toObject(),
      summary: `Updated metric "${metric.label}"`,
      req,
    });

    sendSuccess(res, 200, { data: { metric }, message: 'Metric updated.' });
  } catch (err) {
    next(err);
  }
}

async function listDimensions(_req, res, next) {
  try {
    const dimensions = [...(await catalog.dimensions())].sort((a, b) => a.name.localeCompare(b.name));
    sendSuccess(res, 200, { data: { dimensions } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPrograms,
  getProgram,
  listMetrics,
  createMetric,
  updateMetric,
  listDimensions,
  formatProgram,
};
