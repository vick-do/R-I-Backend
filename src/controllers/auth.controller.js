const User = require('../models/User.model');
const Fact = require('../models/Fact.model');
const AuditLog = require('../models/AuditLog.model');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateRawToken,
  sha256,
} = require('../utils/tokenUtils');
const { env } = require('../config/env');
const audit = require('../services/audit.service');

function formatUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin ?? null,
    status: user.status,
    invitedAt: user.invite?.invitedAt ?? null,
    scopes: {
      programs: (user.scopes?.programs ?? []).map(String),
      metrics: user.scopes?.metrics ?? [],
    },
  };
}

/**
 * Mints a single-use invitation and returns the link to hand over.
 *
 * Only the hash is persisted, so the raw token exists for exactly as long as
 * this response — it cannot be recovered from the database later, and a
 * mislaid link is re-issued rather than looked up.
 */
async function issueInvite(user, actor) {
  const raw = generateRawToken();

  user.invite = {
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + env.INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: actor?._id ?? null,
    invitedAt: new Date(),
    acceptedAt: null,
  };
  await user.save();

  return {
    url: `${env.APP_URL}/invite/${raw}`,
    expiresAt: user.invite.expiresAt,
  };
}

function issueTokens(user) {
  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const refreshToken = signRefreshToken({ id: user.id });
  return { accessToken, refreshToken };
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await User.findByEmail(email);
    // Same response for unknown email and wrong password, so the endpoint
    // cannot be used to enumerate accounts.
    if (!user || !user.password || !(await user.comparePassword(password))) {
      sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid email or password.' });
      return;
    }

    if (!user.isActive) {
      sendError(res, 403, { code: ERROR_CODES.FORBIDDEN, message: 'This account is disabled.' });
      return;
    }

    const { accessToken, refreshToken } = issueTokens(user);

    user.lastLogin = new Date();
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLogin: user.lastLogin }, $push: { refreshTokens: sha256(refreshToken) } }
    );

    sendSuccess(res, 200, {
      data: { user: formatUser(user), accessToken, refreshToken },
      message: 'Signed in.',
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Session expired. Please sign in again.' });
      return;
    }

    const user = await User.findById(payload.id).select('+refreshTokens');
    const hash = sha256(refreshToken);

    if (!user || !user.isActive || !user.refreshTokens.includes(hash)) {
      sendError(res, 401, { code: ERROR_CODES.UNAUTHORIZED, message: 'Session expired. Please sign in again.' });
      return;
    }

    // Rotate: the presented token is retired as the new pair is issued.
    const next_ = issueTokens(user);
    await User.updateOne(
      { _id: user._id },
      { $pull: { refreshTokens: hash } }
    );
    await User.updateOne(
      { _id: user._id },
      { $push: { refreshTokens: sha256(next_.refreshToken) } }
    );

    sendSuccess(res, 200, {
      data: { accessToken: next_.accessToken, refreshToken: next_.refreshToken },
      message: 'Session refreshed.',
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await User.updateOne({ _id: req.user._id }, { $pull: { refreshTokens: sha256(refreshToken) } });
    }
    sendSuccess(res, 200, { data: {}, message: 'Signed out.' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  sendSuccess(res, 200, { data: { user: formatUser(req.user) } });
}

/** How much of the record a user is attached to. */
async function footprints(userIds) {
  const [facts, entries] = await Promise.all([
    Fact.aggregate([
      { $match: { enteredBy: { $in: userIds } } },
      { $group: { _id: '$enteredBy', count: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: { actor: { $in: userIds } } },
      { $group: { _id: '$actor', count: { $sum: 1 } } },
    ]),
  ]);

  const byId = new Map(userIds.map((id) => [String(id), { facts: 0, auditEntries: 0 }]));
  for (const row of facts) byId.get(String(row._id)).facts = row.count;
  for (const row of entries) byId.get(String(row._id)).auditEntries = row.count;
  return byId;
}

async function listUsers(_req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: 1 });
    const footprint = await footprints(users.map((u) => u._id));

    sendSuccess(res, 200, {
      data: {
        users: users.map((u) => ({ ...formatUser(u), footprint: footprint.get(String(u._id)) })),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** The admins who could still let someone back in. */
async function otherActiveAdmins(excludeId) {
  return User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: excludeId } });
}

/**
 * POST /api/v1/auth/users/:id/revoke — shut off access without losing the person.
 *
 * Disables the account, ends every live session, and cancels any invitation
 * that has not been accepted. Reversible: re-enabling restores them, though
 * they will need a fresh invite if they never set a password.
 */
async function revokeUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'User not found.' });
      return;
    }
    if (String(user._id) === String(req.user._id)) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'You cannot revoke your own access. Ask another admin to do it.',
      });
      return;
    }
    if (user.role === 'admin' && (await otherActiveAdmins(user._id)) === 0) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'This is the only active admin. Promote someone else first.',
      });
      return;
    }

    const before = formatUser(user);

    user.isActive = false;
    user.invite.tokenHash = null;
    await user.save();
    // Dropping the refresh tokens ends every signed-in session; the access
    // token they hold expires within fifteen minutes.
    await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });

    await audit.record({
      action: 'user.update',
      entityType: 'User',
      entityId: user._id,
      actor: req.user,
      before,
      after: formatUser(user),
      summary: `Revoked access for ${user.email}`,
      req,
    });

    sendSuccess(res, 200, {
      data: { user: formatUser(user) },
      message: 'Access revoked. Their sessions are ended and any pending invitation no longer works.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/auth/users/:id — remove the account for good.
 *
 * The facts they recorded are never touched: they are append-only and belong to
 * the programme, not to the person. What is lost is the link back to them, so
 * the audit entry keeps their name and email — after this, that record is the
 * only place they exist.
 */
async function deleteUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'User not found.' });
      return;
    }
    if (String(user._id) === String(req.user._id)) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'You cannot delete your own account. Ask another admin to do it.',
      });
      return;
    }
    if (user.role === 'admin' && (await otherActiveAdmins(user._id)) === 0) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'This is the only active admin. Promote someone else first.',
      });
      return;
    }

    const before = formatUser(user);
    const footprint = (await footprints([user._id])).get(String(user._id));

    await User.deleteOne({ _id: user._id });

    await audit.record({
      action: 'user.update',
      entityType: 'User',
      entityId: user._id,
      actor: req.user,
      before,
      after: null,
      summary:
        `Deleted ${before.role} account ${before.email} (${before.fullName})` +
        (footprint.facts ? ` — ${footprint.facts} recorded figures keep their values but lose their author` : ''),
      req,
    });

    sendSuccess(res, 200, {
      data: { footprint },
      message: `${before.fullName} deleted. Their figures remain; the audit log keeps their name.`,
    });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { firstName, lastName, email, password, role, scopes } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      sendError(res, 409, { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'A user with that email already exists.' });
      return;
    }

    const user = await User.create({
      firstName,
      lastName,
      email,
      // Without a password the account cannot be signed into at all — login
      // refuses an account that has none — so the invite is the only way in.
      ...(password ? { password } : {}),
      role,
      ...(scopes ? { scopes } : {}),
    });

    const invite = password ? null : await issueInvite(user, req.user);

    await audit.record({
      action: 'user.create',
      entityType: 'User',
      entityId: user._id,
      actor: req.user,
      after: formatUser(user),
      summary: `${invite ? 'Invited' : 'Created'} ${role} account for ${email}`,
      req,
    });

    sendSuccess(res, 201, {
      data: { user: formatUser(user), invite },
      message: invite ? 'Invitation created. Send them the link.' : 'User created.',
    });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'User not found.' });
      return;
    }

    const before = formatUser(user);
    const { firstName, lastName, role, isActive, password, scopes } = req.body;

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (password) user.password = password;
    if (scopes) {
      user.scopes = {
        programs: scopes.programs ?? user.scopes?.programs ?? [],
        metrics: scopes.metrics ?? user.scopes?.metrics ?? [],
      };
    }

    // An admin removing their own last route back in is a mistake worth
    // blocking rather than an instruction worth following.
    if (String(user._id) === String(req.user._id) && (role === 'viewer' || isActive === false)) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'You cannot remove your own admin access. Ask another admin to do it.',
      });
      return;
    }

    await user.save();

    await audit.record({
      action: 'user.update',
      entityType: 'User',
      entityId: user._id,
      actor: req.user,
      before,
      after: formatUser(user),
      summary: `Updated account ${user.email}`,
      req,
    });

    sendSuccess(res, 200, { data: { user: formatUser(user) }, message: 'User updated.' });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/users/:id/invite — re-issue a link. */
async function resendInvite(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('+password');
    if (!user) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'User not found.' });
      return;
    }
    if (user.password) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'That account is already set up. Reset their password instead.',
      });
      return;
    }

    const invite = await issueInvite(user, req.user);

    await audit.record({
      action: 'user.update',
      entityType: 'User',
      entityId: user._id,
      actor: req.user,
      summary: `Re-issued invitation for ${user.email}`,
      req,
    });

    sendSuccess(res, 200, { data: { invite }, message: 'New link created. The previous one no longer works.' });
  } catch (err) {
    next(err);
  }
}

/** Finds a live invitation by its raw token, or null. */
async function findInvite(raw) {
  if (!raw) return null;
  const user = await User.findOne({ 'invite.tokenHash': sha256(raw) }).select('+invite.tokenHash');
  if (!user) return null;
  if (user.invite?.acceptedAt) return null;
  if (user.invite?.expiresAt && user.invite.expiresAt < new Date()) return null;
  return user;
}

/** GET /api/v1/auth/invite/:token — who the invitation is for. Public. */
async function getInvite(req, res, next) {
  try {
    const user = await findInvite(req.params.token);
    if (!user) {
      sendError(res, 404, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'This invitation has expired or has already been used. Ask an administrator for a new one.',
      });
      return;
    }

    sendSuccess(res, 200, {
      data: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        expiresAt: user.invite.expiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/invite/:token — set a password and sign in. Public.
 *
 * The invitation is spent on success, so a link that reaches the wrong inbox
 * later is inert.
 */
async function acceptInvite(req, res, next) {
  try {
    const user = await findInvite(req.params.token);
    if (!user) {
      sendError(res, 404, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'This invitation has expired or has already been used. Ask an administrator for a new one.',
      });
      return;
    }

    user.password = req.body.password;
    user.invite.tokenHash = null;
    user.invite.acceptedAt = new Date();
    user.lastLogin = new Date();
    await user.save();

    const { accessToken, refreshToken } = issueTokens(user);
    await User.updateOne({ _id: user._id }, { $push: { refreshTokens: sha256(refreshToken) } });

    await audit.record({
      action: 'user.update',
      entityType: 'User',
      entityId: user._id,
      actor: user,
      summary: `${user.email} accepted their invitation`,
      req,
    });

    sendSuccess(res, 200, {
      data: { user: formatUser(user), accessToken, refreshToken },
      message: `Welcome, ${user.firstName}.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
  formatUser,
};
