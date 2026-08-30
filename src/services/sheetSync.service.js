const ImportBatch = require('../models/ImportBatch.model');
const SheetSource = require('../models/SheetSource.model');
const Program = require('../models/Program.model');
const sheets = require('./sheets.service');
const { previewSheet } = require('../utils/workbook');
const imports = require('./import.service');
const audit = require('./audit.service');
const { logger } = require('../utils/logger');
const { buildDimensionFields } = require('../utils/dimensions');
const { memo, invalidate: invalidateCache } = require('../utils/memo');

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
 * Plans every block on a tab against one read of the sheet, and merges the
 * results into a single plan.
 *
 * Blocks normally describe disjoint coordinates, so their candidates are read
 * and diffed together and one bad block holds the whole tab rather than half of
 * it landing.
 *
 * A source can instead say its blocks describe one figure between them, by
 * setting `mergeBlocks` to 'mean' or 'sum'. The AI Startup sheet rates each
 * discipline's confidence in six separate places on the page; the figure for
 * that discipline is the average across all six, and without combining them
 * first the same coordinate would be diffed six times over with the last one
 * silently winning.
 */
async function planBlocks({ worksheet, source, fileName }) {
  const blocks =
    source.blocks?.length > 0
      ? source.blocks
      : [{ name: source.tabName, program: source.program, mapping: source.mapping }];

  const candidates = [];
  const issues = [];
  const checks = [];

  // Read once for the whole tab rather than once per block.
  const catalog = await imports.loadCatalog();

  for (const block of blocks) {
    const programId = block.program?._id ?? block.program;
    const result = await imports.extract({ worksheet, mapping: block.mapping, fileName, programId, catalog });

    /**
     * A block that reads nothing has lost the thing it was pointed at.
     *
     * Mappings address the sheet by cell, so a table that moves or is deleted
     * does not fail — it simply yields no rows, the sync reports no changes,
     * and the figures that table used to supply stay on the page for ever with
     * nothing left behind them. UNDP-YAI's innovator count sat there for weeks
     * after the pivot it came from was removed from the sheet.
     *
     * So an empty block is an error, which holds the whole tab for review
     * rather than letting the rest of it commit around the gap.
     */
    if (result.candidates.length === 0) {
      issues.push({
        severity: 'error',
        message: `Block "${block.name ?? source.tabName}" read no figures. The range it points at is empty — the sheet has probably been restructured.`,
      });
    }

    candidates.push(...result.candidates);
    issues.push(...result.issues);

    // Reconciled against its own block, never against the tab. Absa states 190
    // enterprises above its regions and the same 190 above its districts; each
    // total covers one of those breakdowns, and checking either against both
    // added together reports a shortfall of exactly one whole programme.
    checks.push(
      ...imports
        .reconcile(result.candidates, result.statedTotals)
        .map((c) => ({ ...c, label: `${block.name ?? ''} — ${c.label}`.trim() }))
    );
  }

  const combined = source.mergeBlocks ? combineDuplicates(candidates, source.mergeBlocks) : candidates;

  // Diffed once, after any combining: a coordinate several blocks contribute to
  // has to be reduced before it is compared with what is stored.
  const planned = await imports.diffCandidates({ candidates: combined, issues });

  return {
    ...planned,
    checks,
    summary: { ...planned.summary, checksFailed: checks.filter((c) => c.status === 'fail').length, blocks: blocks.length },
  };
}

/**
 * Reduces candidates sharing one coordinate to a single figure.
 *
 * `mean` for a rate, `sum` for a count — the same distinction the per-block
 * `aggregate` option draws, applied across blocks rather than within one.
 */
function combineDuplicates(candidates, how) {
  const merged = new Map();

  for (const candidate of candidates) {
    const key = [
      String(candidate.programId),
      String(candidate.metric._id),
      candidate.period.periodType,
      candidate.period.periodStart?.toISOString() ?? 'null',
      buildDimensionFields(candidate.dimensions).dimensionKey,
    ].join('::');

    const existing = merged.get(key);
    if (existing) {
      existing.value += candidate.value;
      existing.parts += 1;
    } else {
      merged.set(key, { ...candidate, parts: 1 });
    }
  }

  return [...merged.values()].map(({ parts, ...c }) => ({
    ...c,
    value: how === 'mean' ? c.value / parts : c.value,
    sourceRef: parts > 1 ? `${c.sourceRef} (+${parts - 1} more blocks)` : c.sourceRef,
  }));
}

/**
 * Runs one source. Always writes an ImportBatch, whether or not it commits, so
 * a sync that stopped for review is as inspectable as one that went through.
 */
async function syncSource(sourceId, { user = null, force = false } = {}) {
  const source = await SheetSource.findById(sourceId)
    .populate('program', 'pageKey name')
    .populate('blocks.program', 'pageKey name');
  if (!source) throw Object.assign(new Error('Sheet source not found.'), { status: 404 });

  const fileName = `${source.spreadsheetTitle || 'Google Sheet'} (live)`;

  let planResult;
  try {
    const worksheet = await sheets.loadWorksheet({
      spreadsheetId: source.spreadsheetId,
      tabName: source.tabName,
    });
    planResult = await planBlocks({ worksheet, source, fileName });
  } catch (err) {
    source.lastSyncedAt = new Date();
    source.lastStatus = 'failed';
    source.lastMessage = err.message;
    await source.save();
    invalidateCache('live-sources::');
    logger.error('Sheet sync failed', { source: String(source._id), error: err.message });
    return { status: 'failed', message: err.message, source };
  }

  const verdict = assess(planResult, source);
  const shouldCommit = force || (source.autoCommit && verdict.clean);

  /**
   * Nothing to write.
   *
   * A sheet that has not been edited plans the same figures it planned last
   * time, and the diff says so. Committing that walks every candidate and asks
   * the database about each one, which on a 370-figure sheet is hundreds of
   * round trips to write nothing — and since a page opening can now trigger a
   * refresh, it was doing that while somebody waited. An unchanged sheet is
   * also not worth an import batch: the record would say a sync happened and
   * changed nothing, once every five minutes, forever.
   */
  const noChanges = planResult.diff.created.length === 0 && planResult.diff.updated.length === 0;

  if (shouldCommit && noChanges) {
    source.lastSyncedAt = new Date();
    source.lastStatus = 'synced';
    source.lastMessage = 'Already up to date.';
    await source.save();
    invalidateCache('live-sources::');

    return { status: 'synced', summary: planResult.summary, source };
  }

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
    invalidateCache('live-sources::');

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
  invalidateCache('live-sources::');

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

/**
 * Pulls any source behind its own freshness window before a page is read.
 *
 * A source with no `refreshIntervalMinutes` is left alone: the nightly job is
 * the right cadence for a workbook that only changes when someone edits it.
 * A source that has one — EdTech Mondays, whose season is still running — is
 * re-read when the stored figures are older than that window, so the page shows
 * what the sheet says now rather than what it said last night.
 *
 * Three things keep this from becoming a liability on a page load:
 *
 *   · it never blocks. The request is answered from the figures already stored
 *     and the sheet is read behind it, so a slow sheet cannot make a slow
 *     dashboard. An earlier version waited up to two and a half seconds for the
 *     read to finish, which put that delay on every page touching a live source
 *     for as long as the read took;
 *   · one refresh at a time per source, so ten people opening the page at once
 *     make one call to Google rather than ten;
 *   · failure is swallowed and recorded on the source, never raised. A page
 *     that cannot reach Google still has last night's numbers, and showing
 *     those beats showing an error — and an unhandled rejection here would take
 *     the whole server down.
 *
 * The page learns the new figures on its next poll, which is what `pending`
 * in the response is for.
 */
const inFlight = new Map();

/**
 * The sources feeding this page, if any refresh on view.
 *
 * Looked up twice per request — once to decide whether to read the sheet again
 * and once to tell the reader how fresh the figures are — and the answer is
 * almost always "none". Held briefly so those two lookups cost one query
 * between them, and none at all for the pages that have no live source.
 *
 * The window is far shorter than any refresh interval, so a staleness decision
 * is never more than a few seconds behind.
 */
const SOURCES_TTL_MS = 5_000;

function liveSources(programIds) {
  return memo(
    `live-sources::${programIds.map(String).sort().join(',')}`,
    SOURCES_TTL_MS,
    () =>
      SheetSource.find({
        program: { $in: programIds },
        isEnabled: true,
        refreshIntervalMinutes: { $gt: 0 },
      })
        .select('_id tabName lastSyncedAt lastStatus refreshIntervalMinutes')
        .lean()
  );
}

async function refreshIfStale({ programIds }) {
  const now = Date.now();
  const sources = await liveSources(programIds);

  if (sources.length === 0) return { stale: false, checkedAt: null };

  const due = sources.filter((s) => {
    const age = s.lastSyncedAt ? now - s.lastSyncedAt.getTime() : Infinity;
    return age >= s.refreshIntervalMinutes * 60_000;
  });

  for (const source of due) {
    const key = String(source._id);
    if (inFlight.has(key)) continue;

    inFlight.set(
      key,
      syncSource(source._id)
        .catch((err) => {
          logger.warn('Live refresh failed', { source: key, error: err.message });
        })
        .finally(() => inFlight.delete(key))
    );
  }

  // Only this page's own sources count. A read running for one programme is no
  // reason to tell every other page that its figures are about to change.
  const running = sources.some((s) => inFlight.has(String(s._id)));
  return { stale: running, checkedAt: new Date() };
}

module.exports = { assess, planBlocks, syncSource, syncAll, inspectTab, dryRun, refreshIfStale, liveSources };
