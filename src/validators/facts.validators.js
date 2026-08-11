const { body, query } = require('express-validator');
const { PERIOD_TYPES } = require('../utils/period');

const aggregateValidation = [
  query('metric').isString().trim().notEmpty().withMessage('A metric key is required.'),
  query('periodType').optional().isIn(PERIOD_TYPES),
  query('year').optional().isInt({ min: 1900, max: 2200 }),
];

const totalValidation = [
  query('metric').isString().trim().notEmpty().withMessage('A metric key is required.'),
  query('periodType').optional().isIn(PERIOD_TYPES),
  query('year').optional().isInt({ min: 1900, max: 2200 }),
];

const historyValidation = [
  query('program').isString().trim().notEmpty().withMessage('A program is required.'),
  query('metric').isString().trim().notEmpty().withMessage('A metric key is required.'),
  query('periodType').optional().isIn(PERIOD_TYPES),
];

const createFactValidation = [
  body('program').isString().trim().notEmpty().withMessage('A program is required.'),
  body('metric').isString().trim().notEmpty().withMessage('A metric key is required.'),
  body('periodType').isIn(PERIOD_TYPES).withMessage(`Period type must be one of: ${PERIOD_TYPES.join(', ')}.`),
  body('year')
    .if(body('periodType').not().equals('all_time'))
    .isInt({ min: 1900, max: 2200 })
    .withMessage('A valid year is required for this period type.'),
  body('month')
    .if(body('periodType').equals('month'))
    .isInt({ min: 1, max: 12 })
    .withMessage('Month must be between 1 and 12.'),
  body('quarter')
    .if(body('periodType').equals('quarter'))
    .isInt({ min: 1, max: 4 })
    .withMessage('Quarter must be between 1 and 4.'),
  body('value').isNumeric().withMessage('Value must be a number.'),
  body('dimensions').optional().isObject().withMessage('Dimensions must be an object.'),
  body('note').optional().isString().trim(),
];

module.exports = { aggregateValidation, totalValidation, historyValidation, createFactValidation };
