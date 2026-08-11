const rateLimit = require('express-rate-limit');
const { sendError, ERROR_CODES } = require('../utils/response');

function limitHandler(_req, res) {
  sendError(res, 429, {
    code: ERROR_CODES.RATE_LIMITED,
    message: 'Too many requests. Please try again shortly.',
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
});

module.exports = { authLimiter, apiLimiter };
