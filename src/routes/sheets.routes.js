const { Router } = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/authenticate');
const {
  getStatus,
  inspect,
  list,
  create,
  update,
  remove,
  dryRun,
  syncOne,
  syncEverything,
} = require('../controllers/sheets.controller');

const router = Router();

router.get('/status', authenticate, getStatus);
router.get('/inspect', authenticate, requireEditor, inspect);
router.get('/', authenticate, list);

router.post(
  '/',
  authenticate,
  requireEditor,
  body('spreadsheetId').notEmpty().withMessage('A spreadsheet ID is required.'),
  body('tabName').notEmpty().withMessage('A tab name is required.'),
  body('program').notEmpty().withMessage('A programme is required.'),
  body('maxChangePercent').optional().isFloat({ min: 0, max: 1000 }),
  validate,
  create
);

router.post(
  '/dry-run',
  authenticate,
  requireEditor,
  body('spreadsheetId').notEmpty(),
  body('tabName').notEmpty(),
  body('program').notEmpty(),
  validate,
  dryRun
);

router.put('/:id', authenticate, requireEditor, update);
router.post('/:id/sync', authenticate, requireEditor, syncOne);
router.post('/sync', authenticate, requireEditor, syncEverything);

// Disconnecting is destructive to the sync arrangement, so it is admin-only.
router.delete('/:id', authenticate, requireAdmin, remove);

module.exports = router;
