const { body } = require('express-validator');
const User = require('../models/User.model');

const loginValidation = [
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password').isString().notEmpty().withMessage('Password is required.'),
];

const refreshValidation = [
  body('refreshToken').isString().notEmpty().withMessage('A refresh token is required.'),
];

const createUserValidation = [
  body('firstName').isString().trim().notEmpty().withMessage('First name is required.'),
  body('lastName').isString().trim().notEmpty().withMessage('Last name is required.'),
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password')
    .optional()
    .isString()
    .isLength({ min: 10 })
    .withMessage('Password must be at least 10 characters.'),
  body('role').isIn(User.ROLES).withMessage(`Role must be one of: ${User.ROLES.join(', ')}.`),
  body('scopes.programs').optional().isArray(),
  body('scopes.metrics').optional().isArray(),
];

const updateUserValidation = [
  body('firstName').optional().isString().trim().notEmpty(),
  body('lastName').optional().isString().trim().notEmpty(),
  body('role').optional().isIn(User.ROLES).withMessage(`Role must be one of: ${User.ROLES.join(', ')}.`),
  body('isActive').optional().isBoolean(),
  body('password').optional().isString().isLength({ min: 10 })
    .withMessage('Password must be at least 10 characters.'),
  body('scopes.programs').optional().isArray(),
  body('scopes.metrics').optional().isArray(),
];

const acceptInviteValidation = [
  body('password')
    .isString()
    .isLength({ min: 10 })
    .withMessage('Choose a password of at least 10 characters.'),
];

module.exports = {
  loginValidation,
  refreshValidation,
  createUserValidation,
  updateUserValidation,
  acceptInviteValidation,
};
