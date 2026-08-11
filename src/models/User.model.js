const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { env } = require('../config/env');

const ROLES = ['admin', 'editor', 'viewer'];

/**
 * admin  — everything, including user management and batch rollback
 * editor — enter data, run imports, manage the metric catalog
 * viewer — read dashboards and exports only
 */
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'viewer' },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    // Hashes of live refresh tokens, so sessions can be revoked on logout.
    refreshTokens: { type: [String], default: [], select: false },
    passwordChangedAt: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
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

userSchema.statics.ROLES = ROLES;

const User = mongoose.model('User', userSchema);
module.exports = User;
