const ImportBatch = require('../models/ImportBatch.model');
const SheetSource = require('../models/SheetSource.model');
const Program = require('../models/Program.model');
const sheets = require('./sheets.service');
const { previewSheet } = require('../utils/workbook');
const imports = require('./import.service');
const audit = require('./audit.service');
const { logger } = require('../utils/logger');

/**
 * Pulls a connected sheet and turns it into facts through the same pipeline an
 * uploaded workbook uses.
 */

/**
 * Decides whether a planned sync is safe to commit without a person looking at
 * it.
 *
 * A sync is clean when the sheet reconciles against its own stated totals, the
 * reader found no errors, no coordinate is claimed twice, and no existing
 * figure moves by more than the source's threshold. Anything else waits: the
 * moment a number jumps unexpectedly is exactly the moment somebody should see
 * it before it reaches a funder-facing page.
 */
function assess(planResult, source) {
  const reasons = [];

  const failed = planResult.checks.filter((c) => c.status === 'fail');
  for (const check of failed) {
    reasons.push(`${check.label}: sheet states ${check.expected}, rows sum to ${check.actual}`);
  }

  const errors = planResult.issues.filter((i) => i.severity === 'error');
  for (const issue of errors) reasons.push(issue.message);

  for (const conflict of planResult.diff.conflicts) reasons.push(conflict.message);

  const limit = source.maxChangePercent ?? 10;
  for (const row of planResult.diff.updated) {
    const previous = row.previousValue;
    if (previous === 0 || previous === null || previous === undefined) continue;
    const movement = Math.abs((row.value - previous) / previous) * 100;
    if (movement > limit) {
      reasons.push(
        `${row.metricLabel} (${row.period}) moves ${previous} → ${row.value}, ${movement.toFixed(1)}% — above the ${limit}% threshold`
      );
    }
  }

  return { clean: reasons.length === 0, reasons };
}

/**
 * Runs one source. Always writes an ImportBatch, whether or not it commits, so
 * a sync that stopped for review is as inspectable as one that went through.
 */
async function syncSource(sourceId, { user = null, force = false } = {}) {
  const source = await SheetSource.findById(sourceId).populate('program', 'pageKey name');
  if (!source) throw Object.assign(new Error('Sheet source not found.'), { status: 404 });

  const fileName = `${source.spreadsheetTitle || 'Google Sheet'} (live)`;

  let planResult;
  try {
    const worksheet = await sheets.loadWorksheet({
      spreadsheetId: source.spreadsheetId,
      tabName: source.tabName,
    });
    planResult = await imports.plan({
      worksheet,
      mapping: source.mapping,
      fileName,
      programId: source.program._id,
    });
  } catch (err) {
    source.lastSyncedAt = new Date();
    source.lastStatus = 'failed';
    source.lastMessage = err.message;
    await source.save();
    logger.error('Sheet sync failed', { source: String(source._id), error: err.message });
    return { status: 'failed', message: err.message, source };
  }

  const verdict = assess(planResult, source);
  const shouldCommit = force || (source.autoCommit && verdict.clean);

  const batch = await ImportBatch.create({
    fileName,
    sheetName: source.tabName,
    program: source.program._id,
    mappingTemplate: source.mappingTemplate,
    mapping: source.mapping,
    status: 'previewed',
    checks: planResult.checks,
    issues: planResult.issues,
    rowsSkipped: planResult.issues.filter((i) => i.severity === 'warning').length,
    importedBy: user?._id ?? source.createdBy,
  });

  if (!shouldCommit) {
    source.lastSyncedAt = new Date();
    source.lastStatus = 'needs_review';
    source.lastMessage = verdict.reasons[0] ?? 'Held for review.';
    source.lastBatch = batch._id;
    await source.save();

    return {
      status: 'needs_review',
      reasons: verdict.reasons,
      summary: planResult.summary,
      batch,
      source,
    };
  }

  const { created, updated } = await imports.commit({ planResult, batch, user });

  batch.status = 'committed';
  batch.committedAt = new Date();
  batch.factsCreated = created;
  batch.factsSuperseded = updated;
  await batch.save();

  source.lastSyncedAt = new Date();
  source.lastStatus = 'synced';
  source.lastMessage =
    created + updated === 0 ? 'Already up to date.' : `${created} new, ${updated} revised.`;
  source.lastBatch = batch._id;
  await source.save();

  await audit.record({
    action: 'import.commit',
    entityType: 'SheetSource',
    entityId: source._id,
    actor: user,
    after: { created, updated, tab: source.tabName },
    summary: `Synced ${source.spreadsheetTitle || 'sheet'} › ${source.tabName}: ${created} new, ${updated} revised`,
  });

  return { status: 'synced', summary: planResult.summary, created, updated, batch, source };
}

/** Every enabled source, for the scheduled run. */
async function syncAll({ user = null } = {}) {
  if (!sheets.isConfigured()) {
    logger.warn('Sheet sync skipped — Google credentials are not configured');
    return [];
  }

  const sources = await SheetSource.find({ isEnabled: true }).select('_id');
  const results = [];

  for (const { _id } of sources) {
    try {
      results.push(await syncSource(_id, { user }));
    } catch (err) {
      logger.error('Sheet sync threw', { source: String(_id), error: err.message });
      results.push({ status: 'failed', message: err.message });
    }
  }

  logger.info('Sheet sync run complete', {
    total: results.length,
    synced: results.filter((r) => r.status === 'synced').length,
    needsReview: results.filter((r) => r.status === 'needs_review').length,
    failed: results.filter((r) => r.status === 'failed').length,
  });

  return results;
}

/**
 * Suggests a mapping for a tab and returns a grid of what the reader sees, so
 * connecting a sheet is neither a blank form nor an act of faith.
 */
async function inspectTab({ spreadsheetId, tabName }) {
  const worksheet = await sheets.loadWorksheet({ spreadsheetId, tabName });
  const suggestion = await imports.suggestMapping({ worksheet, fileName: tabName });
  return {
    suggestion,
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    preview: previewSheet(worksheet, { maxRows: 14, maxCols: 10 }),
  };
}

/**
 * Runs the mapping against the live sheet and reports what it would write,
 * without writing anything. This is what stands between a mistyped mapping and
 * a programme's figures.
 */
async function dryRun({ spreadsheetId, tabName, programId, mapping }) {
  const worksheet = await sheets.loadWorksheet({ spreadsheetId, tabName });
  const planResult = await imports.plan({ worksheet, mapping, fileName: `${tabName} (live)`, programId });
  const verdict = assess(planResult, { maxChangePercent: 10 });

  return {
    summary: planResult.summary,
    checks: planResult.checks,
    issues: planResult.issues,
    wouldAutoCommit: verdict.clean,
    heldBecause: verdict.reasons,
    sample: planResult.candidates.slice(0, 12).map((c) => ({
      metric: c.metric.label,
      period: c.period.periodLabel,
      dimensions: c.dimensions,
      value: c.value,
      sourceRef: c.sourceRef,
    })),
  };
}

module.exports = { assess, syncSource, syncAll, inspectTab, dryRun };
