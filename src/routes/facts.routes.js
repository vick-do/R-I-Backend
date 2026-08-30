const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuthenticate, requireEditor } = require('../middleware/authenticate');
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

// The figures themselves are public — anyone can read what MEST has done,
// with or without an account.
router.get('/aggregate', optionalAuthenticate, aggregateValidation, validate, getAggregate);
router.get('/total', optionalAuthenticate, totalValidation, validate, getTotal);
router.get('/org-totals', optionalAuthenticate, getOrgTotals);
router.get('/summary', optionalAuthenticate, getSummary);
// The raw list is public too, but it names whoever recorded each figure, so
// that part of it is withheld from anonymous callers — see `listFacts`.
router.get('/', optionalAuthenticate, listFacts);

// Provenance names staff and is not part of the public record.
router.get('/history', authenticate, historyValidation, validate, getHistory);

// Writing data requires editor or admin.
router.post('/', authenticate, requireEditor, createFactValidation, validate, createFact);

module.exports = router;
