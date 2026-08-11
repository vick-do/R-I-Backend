const { validationResult } = require('express-validator');
const { sendError, ERROR_CODES } = require('../utils/response');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, 422, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Validation failed.',
      details: errors.array().map((e) => ({ field: e.type === 'field' ? e.path : e.type, message: e.msg })),
    });
    return;
  }
  next();
}

module.exports = { validate };
