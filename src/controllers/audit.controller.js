const AuditLog = require('../models/AuditLog.model');
const { sendSuccess } = require('../utils/response');

/**
 * GET /api/v1/audit — every mutation, newest first.
 *
 * The log has been written since the system was built; this is the first thing
 * that reads it back.
 */
async function list(req, res, next) {
  try {
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.actor) filter.actor = req.query.actor;

    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    const [entries, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('actor', 'firstName lastName email role')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    sendSuccess(res, 200, {
      data: { entries, actions: AuditLog.ACTIONS },
      meta: { count: entries.length, total, limit },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
