const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/authenticate');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  login,
  refresh,
  logout,
  me,
  listUsers,
  createUser,
  updateUser,
} = require('../controllers/auth.controller');
const {
  loginValidation,
  refreshValidation,
  createUserValidation,
  updateUserValidation,
} = require('../validators/auth.validators');

const router = Router();

router.post('/login', authLimiter, loginValidation, validate, login);
router.post('/refresh', authLimiter, refreshValidation, validate, refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

router.get('/users', authenticate, requireAdmin, listUsers);
router.post('/users', authenticate, requireAdmin, createUserValidation, validate, createUser);
router.put('/users/:id', authenticate, requireAdmin, updateUserValidation, validate, updateUser);

module.exports = router;
