const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, requireEditor } = require('../middleware/authenticate');
const {
  listPrograms,
  getProgram,
  listMetrics,
  createMetric,
  updateMetric,
  listDimensions,
} = require('../controllers/catalog.controller');
const { createMetricValidation, updateMetricValidation } = require('../validators/catalog.validators');

const programRouter = Router();
programRouter.get('/', authenticate, listPrograms);
programRouter.get('/:pageKey', authenticate, getProgram);

const metricRouter = Router();
metricRouter.get('/', authenticate, listMetrics);
metricRouter.post('/', authenticate, requireEditor, createMetricValidation, validate, createMetric);
metricRouter.put('/:key', authenticate, requireEditor, updateMetricValidation, validate, updateMetric);

const dimensionRouter = Router();
dimensionRouter.get('/', authenticate, listDimensions);

module.exports = { programRouter, metricRouter, dimensionRouter };
