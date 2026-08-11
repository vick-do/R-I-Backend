const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ImportBatch = require('../models/ImportBatch.model');
const MappingTemplate = require('../models/MappingTemplate.model');
const Program = require('../models/Program.model');
const importService = require('../services/import.service');
const audit = require('../services/audit.service');
const { loadWorkbook, loadWorkbookFromBuffer, previewSheet } = require('../utils/workbook');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

async function loadBatchWorkbook(batch) {
  return loadWorkbook(batch.storagePath);
}

async function findBatchOr404(res, id) {
  const batch = await ImportBatch.findById(id);
  if (!batch) {
    sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Import not found.' });
    return null;
  }
  return batch;
}

/**
 * POST /api/v1/imports — upload a workbook.
 *
 * Stores the file, opens a draft batch, and returns the sheet list with a
 * suggested mapping for each, so the operator starts from a proposal rather
 * than a blank mapping form.
 */
async function upload(req, res, next) {
  try {
    if (!req.file) {
      sendError(res, 422, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Attach a .xlsx file to import.' });
      return;
    }

    let workbook;
    try {
      workbook = await loadWorkbookFromBuffer(req.file.buffer);
    } catch {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'That file could not be read as an Excel workbook. Save it as .xlsx and try again.',
      });
      return;
    }

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const storagePath = path.join(UPLOAD_DIR, `${fileHash.slice(0, 16)}.xlsx`);
    await fs.writeFile(storagePath, req.file.buffer);

    const batch = await ImportBatch.create({
      fileName: req.file.originalname,
      fileHash,
      storagePath,
      importedBy: req.user._id,
      status: 'draft',
    });

    const sheets = [];
    for (const worksheet of workbook.worksheets) {
      sheets.push({
        name: worksheet.name,
        rowCount: worksheet.rowCount,
        columnCount: worksheet.columnCount,
        suggestion: await importService.suggestMapping({ worksheet, fileName: req.file.originalname }),
      });
    }

    // A previously committed batch of the same bytes usually means someone is
    // about to import the same file twice.
    const priorCommit = await ImportBatch.findOne({
      fileHash,
      status: 'committed',
      _id: { $ne: batch._id },
    }).sort({ committedAt: -1 });

    sendSuccess(res, 201, {
      data: {
        batchId: batch.id,
        fileName: batch.fileName,
        sheets,
        previouslyImported: priorCommit
          ? { batchId: priorCommit.id, sheetName: priorCommit.sheetName, committedAt: priorCommit.committedAt }
          : null,
      },
      message: 'Workbook uploaded. Choose a sheet and confirm the mapping.',
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/imports/:id/preview?sheet=… — the grid shown in the mapping UI. */
async function preview(req, res, next) {
  try {
    const batch = await findBatchOr404(res, req.params.id);
    if (!batch) return;

    const workbook = await loadBatchWorkbook(batch);
    const worksheet = req.query.sheet ? workbook.getWorksheet(req.query.sheet) : workbook.worksheets[0];
    if (!worksheet) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Sheet "${req.query.sheet}" not found.` });
      return;
    }

    sendSuccess(res, 200, {
      data: {
        preview: previewSheet(worksheet, {
          maxRows: Math.min(Number(req.query.rows ?? 60), 200),
          maxCols: Math.min(Number(req.query.cols ?? 30), 60),
        }),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/imports/:id/plan — the dry run.
 *
 * Returns what would change and how the sheet's own totals reconcile, without
 * writing a single fact.
 */
async function plan(req, res, next) {
  try {
    const batch = await findBatchOr404(res, req.params.id);
    if (!batch) return;

    if (batch.status === 'committed') {
      sendError(res, 409, {
        code: ERROR_CODES.DUPLICATE_ENTRY,
        message: 'This import has already been committed. Start a new one, or roll this one back first.',
      });
      return;
    }

    const { sheet, program: pageKey, mappingTemplate, mapping: inlineMapping } = req.body;

    const program = await Program.findOne({ pageKey });
    if (!program) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Program "${pageKey}" not found.` });
      return;
    }
    if (!program.isReportable) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `"${program.name}" is a grouping, not a reportable programme. Choose one of its programmes.`,
      });
      return;
    }

    let mapping = inlineMapping;
    if (mappingTemplate) {
      const template = await MappingTemplate.findById(mappingTemplate);
      if (!template) {
        sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Mapping template not found.' });
        return;
      }
      mapping = template.toObject();
    }
    if (!mapping) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Provide either a mapping or a mappingTemplate id.',
      });
      return;
    }

    const workbook = await loadBatchWorkbook(batch);
    const worksheet = workbook.getWorksheet(sheet);
    if (!worksheet) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Sheet "${sheet}" not found.` });
      return;
    }

    const result = await importService.plan({
      worksheet,
      mapping,
      fileName: batch.fileName,
      programId: program._id,
    });

    batch.sheetName = sheet;
    batch.program = program._id;
    batch.mapping = mapping;
    batch.mappingTemplate = mappingTemplate ?? null;
    batch.checks = result.checks;
    batch.issues = result.issues;
    batch.status = 'previewed';
    await batch.save();

    sendSuccess(res, 200, {
      data: {
        batchId: batch.id,
        summary: result.summary,
        diff: result.diff,
        checks: result.checks,
        issues: result.issues,
      },
      message: describePlan(result.summary),
    });
  } catch (err) {
    next(err);
  }
}

function describePlan(summary) {
  if (summary.errors > 0) return 'This mapping has errors that must be resolved before importing.';
  if (summary.checksFailed > 0) {
    return `The sheet's own totals do not match the rows being imported (${summary.checksFailed} mismatch(es)). Review before committing.`;
  }
  const parts = [];
  if (summary.created) parts.push(`${summary.created} new`);
  if (summary.updated) parts.push(`${summary.updated} changed`);
  if (summary.unchanged) parts.push(`${summary.unchanged} already correct`);
  return parts.length ? `Ready to import: ${parts.join(', ')}.` : 'Nothing to import from this sheet.';
}

/** POST /api/v1/imports/:id/commit — writes the planned facts as one batch. */
async function commit(req, res, next) {
  try {
    const batch = await findBatchOr404(res, req.params.id);
    if (!batch) return;

    if (batch.status === 'committed') {
      sendError(res, 409, { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'This import has already been committed.' });
      return;
    }
    if (batch.status !== 'previewed') {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Preview this import before committing it.',
      });
      return;
    }

    const workbook = await loadBatchWorkbook(batch);
    const worksheet = workbook.getWorksheet(batch.sheetName);

    // Re-plan against current data so the commit reflects the database as it
    // is now, not as it was when the preview was generated.
    const result = await importService.plan({
      worksheet,
      mapping: batch.mapping,
      fileName: batch.fileName,
      programId: batch.program,
    });

    const blocking = result.issues.filter((i) => i.severity === 'error');
    if (blocking.length > 0 && req.body.force !== true) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'This import still has errors. Fix the mapping, or re-send with force to import the valid rows only.',
        details: blocking,
      });
      return;
    }

    const failedChecks = result.checks.filter((c) => c.status === 'fail');
    if (failedChecks.length > 0 && req.body.acknowledgeMismatch !== true) {
      sendError(res, 422, {
        code: ERROR_CODES.RECONCILIATION_FAILED,
        message: "The sheet's stated totals do not match the rows being imported. Re-send with acknowledgeMismatch to proceed anyway.",
        details: failedChecks.map((c) => ({
          field: c.label,
          message: `Sheet says ${c.expected}, rows sum to ${c.actual} (off by ${c.difference}).`,
        })),
      });
      return;
    }

    const { created, updated } = await importService.commit({
      planResult: result,
      batch,
      user: req.user,
    });

    batch.status = 'committed';
    batch.factsCreated = created;
    batch.factsSuperseded = updated;
    batch.rowsSkipped = result.diff.unchanged.length;
    batch.checks = result.checks;
    batch.issues = result.issues;
    batch.committedAt = new Date();
    await batch.save();

    await audit.record({
      action: 'import.commit',
      entityType: 'ImportBatch',
      entityId: batch._id,
      actor: req.user,
      after: { fileName: batch.fileName, sheetName: batch.sheetName, created, updated },
      summary: `Imported ${created + updated} figures from ${batch.fileName} › ${batch.sheetName}`,
      req,
    });

    sendSuccess(res, 200, {
      data: { batchId: batch.id, created, updated, unchanged: result.diff.unchanged.length, checks: result.checks },
      message: `Imported ${created} new and ${updated} revised figures.`,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/imports/:id/rollback — restores the pre-import state. */
async function rollback(req, res, next) {
  try {
    const batch = await findBatchOr404(res, req.params.id);
    if (!batch) return;

    if (batch.status !== 'committed') {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Only a committed import can be rolled back.',
      });
      return;
    }

    const { removed, restored } = await importService.rollback({ batch, user: req.user });

    await audit.record({
      action: 'import.rollback',
      entityType: 'ImportBatch',
      entityId: batch._id,
      actor: req.user,
      before: { factsCreated: batch.factsCreated, factsSuperseded: batch.factsSuperseded },
      after: { removed, restored },
      summary: `Rolled back ${batch.fileName} › ${batch.sheetName} (${removed} removed, ${restored} restored)`,
      req,
    });

    sendSuccess(res, 200, {
      data: { batchId: batch.id, removed, restored },
      message: `Rolled back. ${removed} figures removed, ${restored} previous values restored.`,
    });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const batches = await ImportBatch.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit ?? 50), 200))
      .populate('importedBy', 'firstName lastName email')
      .populate('program', 'pageKey name')
      .lean();

    sendSuccess(res, 200, { data: { batches } });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const batch = await ImportBatch.findById(req.params.id)
      .populate('importedBy', 'firstName lastName email')
      .populate('program', 'pageKey name');
    if (!batch) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Import not found.' });
      return;
    }
    sendSuccess(res, 200, { data: { batch } });
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, preview, plan, commit, rollback, list, getById };
