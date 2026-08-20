const submissions = require('../services/submissions.service');
const { sendSuccess } = require('../utils/response');

/** GET /api/v1/submissions — the review queue. */
async function list(req, res, next) {
  try {
    const [items, batches, counts] = await Promise.all([
      submissions.list({ status: req.query.status ?? 'pending', user: req.user }),
      submissions.publishesDirectly(req.user) ? submissions.heldBatches() : [],
      submissions.counts(req.user),
    ]);

    sendSuccess(res, 200, {
      data: { submissions: items, heldBatches: batches, counts, canReview: submissions.publishesDirectly(req.user) },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/submissions/:id/approve */
async function approve(req, res, next) {
  try {
    const { submission, outcome } = await submissions.approve(
      { id: req.params.id, user: req.user, note: req.body?.note },
      req
    );
    sendSuccess(res, 200, {
      data: { submission },
      message: outcome === 'unchanged' ? 'That figure was already recorded.' : 'Published.',
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/submissions/:id/return */
async function returnToSubmitter(req, res, next) {
  try {
    const submission = await submissions.returnToSubmitter(
      { id: req.params.id, user: req.user, note: req.body?.note },
      req
    );
    sendSuccess(res, 200, { data: { submission }, message: 'Returned to the submitter.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, approve, returnToSubmitter };
