const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middleware/authenticate');
const { list } = require('../controllers/audit.controller');

const router = Router();

// The log names who changed what, so reading it is an admin capability.
router.get('/', authenticate, requireAdmin, list);

module.exports = router;
