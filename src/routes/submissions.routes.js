const { Router } = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, requireEditor, requireApprover } = require('../middleware/authenticate');
const { list, approve, returnToSubmitter } = require('../controllers/submissions.controller');

const router = Router();

// Editors reach the queue to see their own proposals; the service narrows it.
router.get('/', authenticate, requireEditor, list);

router.post('/:id/approve', authenticate, requireApprover, approve);
router.post(
  '/:id/return',
  authenticate,
  requireApprover,
  body('note').notEmpty().withMessage('Say why it is being returned.'),
  validate,
  returnToSubmitter
);

module.exports = router;
