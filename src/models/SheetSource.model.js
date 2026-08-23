const mongoose = require('mongoose');

const STATUSES = ['never_run', 'synced', 'needs_review', 'failed'];

/**
 * A connected Google Sheet tab: which spreadsheet, which tab, which programme
 * it reports on, and the mapping used to read it.
 *
 * The sheet is the source of intake; the facts it produces remain the record.
 * Each sync runs the same plan → reconcile → commit pipeline an uploaded
 * workbook does, and writes an ImportBatch, so a synced figure is as traceable
 * and as reversible as an imported one.
 */
const sheetSourceSchema = new mongoose.Schema(
  {
    spreadsheetId: { type: String, required: true, trim: true },
    spreadsheetTitle: { type: String, trim: true, default: '' },
    // Not trimmed: a tab name can legitimately carry a trailing space, and
    // "MEST Scale & Express " in this very spreadsheet does. Trimming it makes
    // the range unresolvable.
    tabName: { type: String, required: true },

    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true, index: true },
    mappingTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'MappingTemplate', default: null },
    // Frozen copy of the mapping, so a sync stays explainable after the
    // template it came from is edited.
    mapping: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * One tab often stacks several unrelated tables — Grow holds a hub
     * breakdown, a gender split, mothers, and employment in one sheet. Each is
     * its own block with its own mapping and its own programme, and a sync runs
     * all of them into a single reversible batch.
     *
     * Empty means the tab is one table, described by `mapping` and `program`
     * above.
     */
    blocks: {
      type: [
        {
          _id: false,
          name: { type: String, trim: true },
          program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
          mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
        },
      ],
      default: [],
    },

    isEnabled: { type: Boolean, default: true },

    /**
     * A clean sync commits itself. "Clean" means every reconciliation check
     * passed and no existing figure moved by more than `maxChangePercent`.
     * Anything else stops at a previewed batch for a person to approve —
     * which is the behaviour the source data demands, given Pre-Mest's learner
     * count appears with four different values.
     */
    autoCommit: { type: Boolean, default: true },
    maxChangePercent: { type: Number, default: 10 },

    lastSyncedAt: { type: Date, default: null },
    lastStatus: { type: String, enum: STATUSES, default: 'never_run' },
    lastMessage: { type: String, trim: true, default: '' },
    lastBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One connection per tab; re-connecting the same tab updates it rather than
// creating a second source that would import the same rows twice.
sheetSourceSchema.index({ spreadsheetId: 1, tabName: 1 }, { unique: true });

sheetSourceSchema.statics.STATUSES = STATUSES;

const SheetSource = mongoose.model('SheetSource', sheetSourceSchema);
module.exports = SheetSource;
