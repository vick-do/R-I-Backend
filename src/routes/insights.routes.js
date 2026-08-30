const { Router } = require('express');
const { query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuthenticate } = require('../middleware/authenticate');
const { getScorecard, getCompare, getFunnel, getDataQuality, getByYear } = require('../controllers/insights.controller');

const router = Router();

// Derived views of the public figures are public too.
router.get('/scorecard', optionalAuthenticate, query('year').optional().isInt({ min: 2000, max: 2100 }), validate, getScorecard);

router.get(
  '/compare',
  optionalAuthenticate,
  query('metric').notEmpty().withMessage('A metric is required.'),
  query('groupBy').optional().isString(),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  validate,
  getCompare
);

router.get('/funnel', optionalAuthenticate, query('year').optional().isInt({ min: 2000, max: 2100 }), validate, getFunnel);

// Data quality is an internal report on how the figures were assembled — where
// they disagree with each other and what has not reconciled. It stays behind an
// account: the public record is what MEST has done, not its working notes.
router.get('/data-quality', authenticate, query('year').optional().isInt({ min: 2000, max: 2100 }), validate, getDataQuality);

router.get(
  '/by-year',
  optionalAuthenticate,
  query('program').notEmpty(),
  query('metric').notEmpty(),
  validate,
  getByYear
);

module.exports = router;
