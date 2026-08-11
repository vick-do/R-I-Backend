const { body } = require('express-validator');
const Metric = require('../models/Metric.model');

const createMetricValidation = [
  body('key')
    .isString()
    .trim()
    .matches(/^[a-z][a-z0-9_]*$/)
    .withMessage('Key must be lowercase letters, numbers, and underscores.'),
  body('label').isString().trim().notEmpty().withMessage('A label is required.'),
  body('unit').optional().isIn(Metric.UNITS).withMessage(`Unit must be one of: ${Metric.UNITS.join(', ')}.`),
  body('aggregation')
    .optional()
    .isIn(Metric.AGGREGATIONS)
    .withMessage(`Aggregation must be one of: ${Metric.AGGREGATIONS.join(', ')}.`),
  body('allowedDimensions').optional().isArray(),
  body('aliases').optional().isArray(),
  body('rollsUpToOrgTotal').optional().isBoolean(),
];

const updateMetricValidation = [
  body('label').optional().isString().trim().notEmpty(),
  body('unit').optional().isIn(Metric.UNITS),
  body('aggregation').optional().isIn(Metric.AGGREGATIONS),
  body('allowedDimensions').optional().isArray(),
  body('aliases').optional().isArray(),
  body('rollsUpToOrgTotal').optional().isBoolean(),
  body('isArchived').optional().isBoolean(),
];

module.exports = { createMetricValidation, updateMetricValidation };
