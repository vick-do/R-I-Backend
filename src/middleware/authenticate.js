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

/**
 * Reads the token when one is sent, and lets the request through when it is not.
 *
 * The impact figures are public: anyone can open the dashboard and read what
 * MEST has done, without an account. The endpoints serving those figures use
 * this rather than `authenticate`, so an anonymous reader is served and a
 * signed-in one is still identified — which is what lets a response carry more
 * for staff than it does for the public, and lets the same page offer editing
 * to whoever is entitled to it.
 *
 * A token that is present but bad is treated as no token rather than as an
 * error: on a public endpoint an expired session should show the reader the
 * data, not an authentication failure they cannot act on.
 */
async function optionalAuthenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    const user = await User.findById(payload.id).select('+passwordChangedAt');
    if (user && user.isActive && !user.isTokenIssuedBeforePasswordChange(payload.iat)) {
      req.user = user;
    }
  } catch {
    // Anonymous, as above.
  }

  next();
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
const requireEditor = requireRole('admin', 'approver', 'editor');
/** Publishing figures and connecting sources. */
const requireApprover = requireRole('admin', 'approver');
/** User management and destructive operations such as batch rollback. */
const requireAdmin = requireRole('admin');

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireEditor,
  requireApprover,
  requireAdmin,
};
