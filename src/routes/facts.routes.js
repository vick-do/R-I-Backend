const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, requireEditor } = require('../middleware/authenticate');
const {
  getAggregate,
  getTotal,
  getOrgTotals,
  getSummary,
  getHistory,
  createFact,
  listFacts,
} = require('../controllers/facts.controller');
const {
  aggregateValidation,
  totalValidation,
  historyValidation,
  createFactValidation,
} = require('../validators/facts.validators');

const router = Router();

// Read paths are open to every signed-in role, including viewers.
router.get('/aggregate', authenticate, aggregateValidation, validate, getAggregate);
router.get('/total', authenticate, totalValidation, validate, getTotal);
router.get('/org-totals', authenticate, getOrgTotals);
router.get('/summary', authenticate, getSummary);
router.get('/history', authenticate, historyValidation, validate, getHistory);
router.get('/', authenticate, listFacts);

// Writing data requires editor or admin.
router.post('/', authenticate, requireEditor, createFactValidation, validate, createFact);

module.exports = router;
