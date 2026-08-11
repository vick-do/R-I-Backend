const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
};

function sendSuccess(res, status, payload) {
  return res.status(status).json({
    success: true,
    data: payload.data ?? {},
    message: payload.message ?? '',
    meta: payload.meta ?? {},
  });
}

function sendError(res, status, payload) {
  return res.status(status).json({
    success: false,
    error: {
      code: payload.code,
      message: payload.message,
      details: payload.details ?? [],
    },
  });
}

module.exports = { ERROR_CODES, sendSuccess, sendError };
