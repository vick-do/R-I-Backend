const mongoose = require('mongoose');

const ACTIONS = [
  'fact.create',
  'fact.update',
  'fact.delete',
  'import.commit',
  'import.rollback',
  'metric.create',
  'metric.update',
  'program.create',
  'program.update',
  'user.create',
  'user.update',
];

/**
 * Immutable record of every mutation, so any figure on the dashboard can be
 * traced to who changed it, when, and what it was before.
 */
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ACTIONS, required: true, index: true },
    entityType: { type: String, required: true, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    summary: { type: String, trim: true, default: null },
    ip: { type: String, trim: true, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.statics.ACTIONS = ACTIONS;

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
module.exports = AuditLog;
