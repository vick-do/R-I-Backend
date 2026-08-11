const User = require('../models/User.model');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  sha256,
} = require('../utils/tokenUtils');
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

async function listUsers(_req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: 1 });
    sendSuccess(res, 200, { data: { users: users.map(formatUser) } });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      sendError(res, 409, { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'A user with that email already exists.' });
      return;
    }

    const user = await User.create({ firstName, lastName, email, password, role });

    await audit.record({
      action: 'user.create',
      entityType: 'User',
      entityId: user._id,
      actor: req.user,
      after: formatUser(user),
      summary: `Created ${role} account for ${email}`,
      req,
    });

    sendSuccess(res, 201, { data: { user: formatUser(user) }, message: 'User created.' });
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
    const { firstName, lastName, role, isActive, password } = req.body;

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (password) user.password = password;

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

module.exports = { login, refresh, logout, me, listUsers, createUser, updateUser, formatUser };
