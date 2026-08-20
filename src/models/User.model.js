const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { env } = require('../config/env');

const ROLES = ['admin', 'approver', 'editor', 'viewer'];

/**
 * admin    — everything, including user management and batch rollback
 * approver — publishes figures, connects sheets, sets sync thresholds
 * editor   — records figures, within their scope
 * viewer   — reads dashboards and exports only
 */
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'viewer' },

    /**
     * What an editor may write to. An empty list means "everything", so an
     * existing account keeps working exactly as it did before scopes existed.
     * Admins and approvers ignore scopes entirely.
     */
    scopes: {
      programs: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Program' }], default: [] },
      metrics: { type: [String], default: [] },
    },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    // Hashes of live refresh tokens, so sessions can be revoked on logout.
    refreshTokens: { type: [String], default: [], select: false },
    passwordChangedAt: { type: Date, select: false },

    /**
     * An outstanding invitation. Only the hash is stored, so a leaked database
     * row cannot be used to claim an account — the same treatment refresh
     * tokens get. An invited user has no password, and login already refuses
     * an account without one, so the invite is the only way in.
     */
    invite: {
      tokenHash: { type: String, default: null, select: false },
      expiresAt: { type: Date, default: null },
      invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      invitedAt: { type: Date, default: null },
      acceptedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

/**
 * Derived from the invite rather than from the password, because password is
 * `select: false` and is usually absent from a loaded document.
 */
userSchema.virtual('status').get(function () {
  if (this.isActive === false) return 'disabled';
  if (this.invite?.invitedAt && !this.invite?.acceptedAt) return 'invited';
  return 'active';
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, env.BCRYPT_SALT_ROUNDS);
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
  }
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isTokenIssuedBeforePasswordChange = function (jwtIat) {
  if (!this.passwordChangedAt) return false;
  const changedAt = Math.floor(this.passwordChangedAt.getTime() / 1000);
  return jwtIat < changedAt;
};

userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase() }).select('+password');
};

/**
 * Whether this user may write the given programme × metric.
 *
 * Scope is a filter on editors only: the roles above them are trusted with
 * everything, and an editor with no scopes set is unrestricted — so turning
 * scopes on for one person never silently locks out everyone else.
 */
userSchema.methods.canWrite = function ({ programId, metricKey }) {
  if (this.role === 'admin' || this.role === 'approver') return true;
  if (this.role !== 'editor') return false;

  const { programs = [], metrics = [] } = this.scopes ?? {};

  if (programs.length > 0 && !programs.some((id) => String(id) === String(programId))) return false;
  if (metrics.length > 0 && metricKey && !metrics.includes(metricKey)) return false;

  return true;
};

userSchema.statics.ROLES = ROLES;

const User = mongoose.model('User', userSchema);
module.exports = User;
