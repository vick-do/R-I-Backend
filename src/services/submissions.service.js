const FactSubmission = require('../models/FactSubmission.model');
const ImportBatch = require('../models/ImportBatch.model');
const Fact = require('../models/Fact.model');
const facts = require('./facts.service');
const audit = require('./audit.service');
const { buildDimensionFields } = require('../utils/dimensions');

/**
 * Proposals waiting on a reviewer.
 */

/** Whether a user publishes directly or proposes for review. */
function publishesDirectly(user) {
  return user?.role === 'admin' || user?.role === 'approver';
}

/** Records a proposal at a fully-resolved coordinate. */
async function submit({ program, metric, period, dimensions = {}, value, note = null, user }, req) {
  const dimFields = buildDimensionFields(dimensions);

  const submission = await FactSubmission.create({
    program: program._id,
    metric: metric._id,
    periodType: period.periodType,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodLabel: period.periodLabel,
    year: period.year ?? null,
    ...dimFields,
    value: Number(value),
    note,
    submittedBy: user._id,
  });

  await audit.record({
    action: 'fact.create',
    entityType: 'FactSubmission',
    entityId: submission._id,
    actor: user,
    after: { value: submission.value, metric: metric.label, program: program.name },
    summary: `Proposed ${metric.label} for ${program.name} (${submission.periodLabel}) → ${submission.value}`,
    req,
  });

  return submission;
}

/** The live figure at a submission's coordinate, or null. */
async function currentValueFor(submission) {
  const fact = await Fact.findOne({
    program: submission.program?._id ?? submission.program,
    metric: submission.metric?._id ?? submission.metric,
    periodType: submission.periodType,
    periodStart: submission.periodStart,
    dimensionKey: submission.dimensionKey,
    isCurrent: true,
  }).select('value');

  return fact?.value ?? null;
}

/**
 * The review queue.
 *
 * An editor sees only what they proposed; a reviewer sees everything. Each item
 * carries the figure it would replace, because "248" means nothing without the
 * 236 it is changing.
 */
async function list({ status = 'pending', user }) {
  const filter = { status };
  if (!publishesDirectly(user)) filter.submittedBy = user._id;

  const submissions = await FactSubmission.find(filter)
    .sort({ submittedAt: -1 })
    .limit(200)
    .populate('program', 'pageKey name')
    .populate('metric', 'key label unit')
    .populate('submittedBy', 'firstName lastName email')
    .populate('reviewedBy', 'firstName lastName email');

  const items = await Promise.all(
    submissions.map(async (s) => {
      const currentValue = await currentValueFor(s);
      const change = currentValue === null ? null : s.value - currentValue;

      return {
        id: s.id,
        program: s.program,
        metric: s.metric,
        periodLabel: s.periodLabel,
        dimensions: Object.fromEntries(s.dimensions ?? []),
        value: s.value,
        currentValue,
        change,
        percent: currentValue ? (change / Math.abs(currentValue)) * 100 : null,
        isFirstValue: currentValue === null,
        note: s.note,
        status: s.status,
        submittedBy: s.submittedBy,
        submittedAt: s.submittedAt,
        reviewedBy: s.reviewedBy,
        reviewedAt: s.reviewedAt,
        reviewNote: s.reviewNote,
      };
    })
  );

  return items;
}

/**
 * Import batches a sync held back, alongside the manual proposals.
 *
 * They are a different shape but the same question — something is waiting on a
 * person — so the queue shows both rather than hiding one behind another page.
 */
async function heldBatches() {
  const batches = await ImportBatch.find({ status: 'previewed' })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('program', 'pageKey name')
    .lean();

  return batches.map((batch) => ({
    id: String(batch._id),
    fileName: batch.fileName,
    sheetName: batch.sheetName,
    program: batch.program,
    createdAt: batch.createdAt,
    failedChecks: (batch.checks ?? []).filter((c) => c.status === 'fail'),
    issues: (batch.issues ?? []).filter((i) => i.severity === 'error'),
  }));
}

async function counts(user) {
  const filter = { status: 'pending' };
  if (!publishesDirectly(user)) filter.submittedBy = user._id;

  const [pending, returned, batches] = await Promise.all([
    FactSubmission.countDocuments(filter),
    FactSubmission.countDocuments({ ...filter, status: 'returned' }),
    publishesDirectly(user) ? ImportBatch.countDocuments({ status: 'previewed' }) : 0,
  ]);

  return { pending, returned, heldBatches: batches, total: pending + batches };
}

function notPending(submission) {
  return Object.assign(
    new Error(`This submission has already been ${submission.status}.`),
    { status: 422 }
  );
}

/**
 * Publishes a proposal through the ordinary write path.
 *
 * `enteredBy` stays the person who produced the figure — they are its author,
 * and the approver is recorded separately. Losing that distinction would make
 * the history read as though reviewers entered everything.
 */
async function approve({ id, user, note = null }, req) {
  const submission = await FactSubmission.findById(id)
    .populate('program')
    .populate('metric')
    .populate('submittedBy');

  if (!submission) throw Object.assign(new Error('Submission not found.'), { status: 404 });
  if (submission.status !== 'pending') throw notPending(submission);

  const { fact, outcome } = await facts.writeFact({
    program: submission.program,
    metric: submission.metric,
    period: {
      periodType: submission.periodType,
      periodStart: submission.periodStart,
      periodEnd: submission.periodEnd,
      periodLabel: submission.periodLabel,
      year: submission.year,
    },
    dimensions: Object.fromEntries(submission.dimensions ?? []),
    value: submission.value,
    source: 'manual',
    user: submission.submittedBy,
    note: submission.note,
  });

  submission.status = 'approved';
  submission.reviewedBy = user._id;
  submission.reviewedAt = new Date();
  submission.reviewNote = note;
  submission.resultingFact = fact._id;
  await submission.save();

  await audit.record({
    action: outcome === 'created' ? 'fact.create' : 'fact.update',
    entityType: 'Fact',
    entityId: fact._id,
    actor: user,
    after: { value: fact.value, metric: submission.metric.label, program: submission.program.name },
    summary:
      `Approved ${submission.submittedBy.firstName} ${submission.submittedBy.lastName}'s ` +
      `${submission.metric.label} for ${submission.program.name} (${submission.periodLabel}) → ${fact.value}`,
    req,
  });

  return { submission, fact, outcome };
}

/** Sends a proposal back unpublished, with a reason. */
async function returnToSubmitter({ id, user, note }, req) {
  const submission = await FactSubmission.findById(id)
    .populate('program')
    .populate('metric')
    .populate('submittedBy');

  if (!submission) throw Object.assign(new Error('Submission not found.'), { status: 404 });
  if (submission.status !== 'pending') throw notPending(submission);

  submission.status = 'returned';
  submission.reviewedBy = user._id;
  submission.reviewedAt = new Date();
  submission.reviewNote = note ?? null;
  await submission.save();

  await audit.record({
    action: 'fact.update',
    entityType: 'FactSubmission',
    entityId: submission._id,
    actor: user,
    after: { status: 'returned', reviewNote: note ?? null },
    summary:
      `Returned ${submission.submittedBy.firstName} ${submission.submittedBy.lastName}'s ` +
      `${submission.metric.label} for ${submission.program.name}${note ? ` — ${note}` : ''}`,
    req,
  });

  return submission;
}

module.exports = {
  publishesDirectly,
  submit,
  list,
  heldBatches,
  counts,
  approve,
  returnToSubmitter,
  currentValueFor,
};
