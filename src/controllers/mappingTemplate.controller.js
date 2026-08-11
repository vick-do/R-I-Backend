const MappingTemplate = require('../models/MappingTemplate.model');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');

/**
 * Saved column mappings. A recurring report — next month's EdTech Mondays
 * sheet — is imported by picking the template rather than re-mapping by hand.
 */
async function list(req, res, next) {
  try {
    const filter = {};
    if (req.query.program) filter.program = req.query.program;

    const templates = await MappingTemplate.find(filter)
      .sort({ name: 1 })
      .populate('program', 'pageKey name');

    // When a filename/sheet is supplied, rank templates that match its shape
    // first so the UI can preselect the obvious one.
    if (req.query.fileName || req.query.sheetName) {
      const scored = templates.map((t) => ({
        template: t,
        matches:
          (t.matchFileNamePattern && safeMatch(t.matchFileNamePattern, req.query.fileName)) ||
          (t.matchSheetNamePattern && safeMatch(t.matchSheetNamePattern, req.query.sheetName)),
      }));
      scored.sort((a, b) => Number(b.matches) - Number(a.matches));
      sendSuccess(res, 200, {
        data: { templates: scored.map((s) => ({ ...s.template.toObject(), suggested: s.matches })) },
      });
      return;
    }

    sendSuccess(res, 200, { data: { templates } });
  } catch (err) {
    next(err);
  }
}

/** Patterns are operator-supplied, so a malformed one must not crash the list. */
function safeMatch(pattern, value) {
  if (!value) return false;
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

async function create(req, res, next) {
  try {
    const template = await MappingTemplate.create({ ...req.body, createdBy: req.user._id });
    sendSuccess(res, 201, { data: { template }, message: 'Mapping template saved.' });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const template = await MappingTemplate.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!template) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Mapping template not found.' });
      return;
    }
    sendSuccess(res, 200, { data: { template }, message: 'Mapping template updated.' });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const template = await MappingTemplate.findByIdAndDelete(req.params.id);
    if (!template) {
      sendError(res, 404, { code: ERROR_CODES.NOT_FOUND, message: 'Mapping template not found.' });
      return;
    }
    // Committed batches keep their own frozen copy of the mapping, so deleting
    // a template never makes past imports unexplainable.
    sendSuccess(res, 200, { data: {}, message: 'Mapping template deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
