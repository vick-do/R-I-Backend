const SheetSource = require('../models/SheetSource.model');
const Program = require('../models/Program.model');
const sheets = require('../services/sheets.service');
const sync = require('../services/sheetSync.service');
const audit = require('../services/audit.service');
const { env } = require('../config/env');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');

/** GET /api/v1/sheets/status — whether a service account is configured. */
async function getStatus(_req, res) {
  sendSuccess(res, 200, {
    data: {
      configured: sheets.isConfigured(),
      // The address a sheet must be shared with. Safe to show: it is an
      // identifier, not a secret, and nobody can connect a sheet without it.
      serviceAccount: env.GOOGLE_CLIENT_EMAIL,
    },
  });
}

/** GET /api/v1/sheets/inspect?spreadsheetId=… — title and tabs. */
async function inspect(req, res, next) {
  try {
    const { spreadsheetId, tabName } = req.query;
    if (!spreadsheetId) {
      sendError(res, 422, { code: ERROR_CODES.VALIDATION_ERROR, message: 'A spreadsheet ID is required.' });
      return;
    }

    const description = await sheets.describe(spreadsheetId);
    const suggestion = tabName ? await sync.inspectTab({ spreadsheetId, tabName }) : null;

    sendSuccess(res, 200, { data: { ...description, suggestion } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/sheets — every connected tab. */
async function list(_req, res, next) {
  try {
    const sources = await SheetSource.find()
      .sort({ updatedAt: -1 })
      .populate('program', 'pageKey name')
      .populate('lastBatch', 'status factsCreated factsSuperseded committedAt checks')
      .lean();

    sendSuccess(res, 200, { data: { sources, configured: sheets.isConfigured() } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/sheets — connect a tab. */
async function create(req, res, next) {
  try {
    const { spreadsheetId, tabName, program: pageKey, mapping, autoCommit, maxChangePercent } = req.body;

    const program = await Program.findOne({ pageKey });
    if (!program) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Unknown programme "${pageKey}".` });
      return;
    }
    if (!program.isReportable) {
      sendError(res, 422, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `"${program.name}" is a grouping, not a reportable programme.`,
      });
      return;
    }

    const description = await sheets.describe(spreadsheetId);
    if (!description.tabs.some((t) => t.name === tabName)) {
      sendError(res, 404, {
        code: ERROR_CODES.NOT_FOUND,
        message: `"${tabName}" is not a tab in that spreadsheet. Found: ${description.tabs.map((t) => t.name).join(', ')}.`,
      });
      return;
    }

    // Re-connecting the same tab updates it, rather than creating a second
    // source that would import the same rows twice.
    const source = await SheetSource.findOneAndUpdate(
      { spreadsheetId, tabName },
      {
        spreadsheetId,
        tabName,
        spreadsheetTitle: description.title,
        program: program._id,
        mapping: mapping ?? {},
        ...(autoCommit === undefined ? {} : { autoCommit }),
        ...(maxChangePercent === undefined ? {} : { maxChangePercent }),
        createdBy: req.user._id,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await audit.record({
      action: 'program.update',
      entityType: 'SheetSource',
      entityId: source._id,
      actor: req.user,
      after: { spreadsheetId, tabName, program: program.pageKey },
      summary: `Connected ${description.title} › ${tabName} to ${program.name}`,
      req,
    });

    sendSuccess(res, 201, { data: { source }, message: `Connected "${tabName}" to ${program.name}.` });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/v1/sheets/:id — change sync settings. */
async function update(req, res, next) {
  try {
    const allowed = ['isEnabled', 'autoCommit', 'maxChangePercent', 'mapping'];
    const patch = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowed.includes(key))
    );

    const source = await SheetSource.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!source) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Sheet source not found.' });
      return;
    }

    sendSuccess(res, 200, { data: { source } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/sheets/:id — disconnect. Facts already written are kept. */
async function remove(req, res, next) {
  try {
    const source = await SheetSource.findByIdAndDelete(req.params.id);
    if (!source) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Sheet source not found.' });
      return;
    }

    sendSuccess(res, 200, {
      data: {},
      message: 'Disconnected. Figures already imported are kept — roll back the batch to remove them.',
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/sheets/dry-run — what a mapping would write, writing nothing. */
async function dryRun(req, res, next) {
  try {
    const { spreadsheetId, tabName, program: pageKey, mapping } = req.body;

    const program = await Program.findOne({ pageKey });
    if (!program) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: `Unknown programme "${pageKey}".` });
      return;
    }

    const result = await sync.dryRun({ spreadsheetId, tabName, programId: program._id, mapping: mapping ?? {} });
    sendSuccess(res, 200, { data: result });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/sheets/:id/sync — pull now. */
async function syncOne(req, res, next) {
  try {
    const result = await sync.syncSource(req.params.id, {
      user: req.user,
      // Committing a batch the reconciliation held back is an admin decision.
      force: req.body?.acknowledgeMismatch === true && req.user.role === 'admin',
    });

    const message =
      result.status === 'synced'
        ? result.source.lastMessage
        : result.status === 'needs_review'
          ? 'Held for review — the sheet did not reconcile cleanly.'
          : result.message;

    sendSuccess(res, 200, { data: result, message });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/sheets/sync — pull every enabled tab. */
async function syncEverything(req, res, next) {
  try {
    const results = await sync.syncAll({ user: req.user });
    sendSuccess(res, 200, {
      data: { results },
      message: `${results.filter((r) => r.status === 'synced').length} of ${results.length} sources synced.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStatus, inspect, list, create, update, remove, dryRun, syncOne, syncEverything };
