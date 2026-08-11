const AuditLog = require('../models/AuditLog.model');
const { logger } = require('../utils/logger');

/**
 * Writes an audit entry. Deliberately never throws: an audit failure must not
 * roll back the operation it is describing, but it must be visible in the logs.
 */
async function record({ action, entityType, entityId, actor, before, after, summary, req }) {
  try {
    await AuditLog.create({
      action,
      entityType,
      entityId: entityId ?? null,
      actor: actor?._id ?? actor ?? null,
      before: before ?? null,
      after: after ?? null,
      summary: summary ?? null,
      ip: req?.ip ?? null,
    });
  } catch (err) {
    logger.error('Audit write failed', { action, entityType, entityId, error: err.message });
  }
}

module.exports = { record };
