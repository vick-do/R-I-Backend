const insights = require('../services/insights.service');
const dataQuality = require('../services/dataQuality.service');
const Program = require('../models/Program.model');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');

/** GET /api/v1/insights/scorecard — headline figures with change and a series. */
async function getScorecard(req, res, next) {
  try {
    const result = await insights.scorecard({ year: req.query.year });
    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/insights/compare — one metric ranked across programmes. */
async function getCompare(req, res, next) {
  try {
    const result = await insights.compare({
      metricKey: req.query.metric,
      groupBy: req.query.groupBy || null,
      year: req.query.year,
      from: req.query.from,
      to: req.query.to,
    });
    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/insights/funnel — enrolled → graduated → employed. */
async function getFunnel(req, res, next) {
  try {
    const result = await insights.funnel({
      year: req.query.year,
      from: req.query.from,
      to: req.query.to,
    });
    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/insights/data-quality — where the recorded data disagrees with itself. */
async function getDataQuality(req, res, next) {
  try {
    const result = await dataQuality.report({ year: req.query.year });
    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/insights/by-year — one metric across years, for one programme. */
async function getByYear(req, res, next) {
  try {
    const program = await Program.findOne({ pageKey: req.query.program });
    if (!program) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Program not found.' });
      return;
    }

    const result = await insights.byYear({
      programId: program._id,
      metricKey: req.query.metric,
      includeDescendants: !program.isReportable,
    });
    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getScorecard, getCompare, getFunnel, getDataQuality, getByYear };
