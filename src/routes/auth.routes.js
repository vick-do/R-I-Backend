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
  resendInvite,
  revokeUser,
  deleteUser,
  getInvite,
  acceptInvite,
} = require('../controllers/auth.controller');
const {
  loginValidation,
  refreshValidation,
  createUserValidation,
  updateUserValidation,
  acceptInviteValidation,
} = require('../validators/auth.validators');

const router = Router();

router.post('/login', authLimiter, loginValidation, validate, login);
router.post('/refresh', authLimiter, refreshValidation, validate, refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

// Accepting an invitation happens before the user has an account to sign in
// with, so these two are public — and rate limited like the login they replace.
router.get('/invite/:token', authLimiter, getInvite);
router.post('/invite/:token', authLimiter, acceptInviteValidation, validate, acceptInvite);

router.get('/users', authenticate, requireAdmin, listUsers);
router.post('/users', authenticate, requireAdmin, createUserValidation, validate, createUser);
router.put('/users/:id', authenticate, requireAdmin, updateUserValidation, validate, updateUser);
router.post('/users/:id/invite', authenticate, requireAdmin, resendInvite);
router.post('/users/:id/revoke', authenticate, requireAdmin, revokeUser);
router.delete('/users/:id', authenticate, requireAdmin, deleteUser);

module.exports = router;
