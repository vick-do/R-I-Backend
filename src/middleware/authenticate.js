const { verifyAccessToken } = require('../utils/tokenUtils');
const { sendError, ERROR_CODES } = require('../utils/response');
const User = require('../models/User.model');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.id).select('+passwordChangedAt');
    if (!user || !user.isActive) {
      sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' });
      return;
    }

    if (user.isTokenIssuedBeforePasswordChange(payload.iat)) {
      sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' });
      return;
    }

    req.user = user;
    next();
  } catch {
    sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      sendError(res, 403, { code: ERROR_CODES.FORBIDDEN, message: 'Insufficient permissions.' });
      return;
    }
    next();
  };
}

/** Data entry, imports, and catalog edits. Viewers are read-only. */
const requireEditor = requireRole('admin', 'editor');
/** User management and destructive operations such as batch rollback. */
const requireAdmin = requireRole('admin');

module.exports = { authenticate, requireRole, requireEditor, requireAdmin };
