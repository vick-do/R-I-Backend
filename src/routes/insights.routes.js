const { Router } = require('express');
const { query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { getScorecard, getCompare, getFunnel, getDataQuality } = require('../controllers/insights.controller');

const router = Router();

// Derived views are read-only, so every signed-in role may reach them.
router.get('/scorecard', authenticate, query('year').optional().isInt({ min: 2000, max: 2100 }), validate, getScorecard);

router.get(
  '/compare',
  authenticate,
  query('metric').notEmpty().withMessage('A metric is required.'),
  query('groupBy').optional().isString(),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  validate,
  getCompare
);

router.get('/funnel', authenticate, query('year').optional().isInt({ min: 2000, max: 2100 }), validate, getFunnel);

router.get('/data-quality', authenticate, query('year').optional().isInt({ min: 2000, max: 2100 }), validate, getDataQuality);

module.exports = router;
