const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuthenticate, requireEditor } = require('../middleware/authenticate');
const {
  listPrograms,
  getProgram,
  listMetrics,
  createMetric,
  updateMetric,
  listDimensions,
} = require('../controllers/catalog.controller');
const { createMetricValidation, updateMetricValidation } = require('../validators/catalog.validators');

// The navigation tree and the catalog are what let a figure be labelled, so
// they are as public as the figures are.
const programRouter = Router();
programRouter.get('/', optionalAuthenticate, listPrograms);
programRouter.get('/:pageKey', optionalAuthenticate, getProgram);

const metricRouter = Router();
metricRouter.get('/', optionalAuthenticate, listMetrics);
metricRouter.post('/', authenticate, requireEditor, createMetricValidation, validate, createMetric);
metricRouter.put('/:key', authenticate, requireEditor, updateMetricValidation, validate, updateMetric);

const dimensionRouter = Router();
dimensionRouter.get('/', optionalAuthenticate, listDimensions);

module.exports = { programRouter, metricRouter, dimensionRouter };
