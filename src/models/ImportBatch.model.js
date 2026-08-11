const mongoose = require('mongoose');

const STATUSES = ['draft', 'previewed', 'committed', 'rolled_back', 'failed'];

/**
 * A reconciliation check comparing a total stated in the spreadsheet against
 * the sum of the leaf facts imported from it. Stated totals are deliberately
 * not stored as facts, so this is where they earn their keep: they become the
 * evidence that the import is arithmetically faithful to the source.
 */
const checkSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    expected: { type: Number, required: true },
    actual: { type: Number, required: true },
    difference: { type: Number, required: true },
    status: { type: String, enum: ['pass', 'warn', 'fail'], required: true },
    sourceRef: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const issueSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ['info', 'warning', 'error'], required: true },
    // Plain-language text shown directly to non-technical users.
    message: { type: String, required: true, trim: true },
    sourceRef: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const importBatchSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileHash: { type: String, trim: true, default: null, index: true },
    // Where the uploaded workbook is retained so preview → plan → commit can
    // span several requests, and so a committed batch stays auditable against
    // its original file. Swap for an S3 key when deploying.
    storagePath: { type: String, trim: true, default: null },
    sheetName: { type: String, trim: true, default: '' },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', default: null },
    mappingTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'MappingTemplate', default: null },
    // Frozen copy of the mapping actually applied, so a batch stays explainable
    // even after the template it came from is edited.
    mapping: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: { type: String, enum: STATUSES, default: 'draft', index: true },
    factsCreated: { type: Number, default: 0 },
    factsSuperseded: { type: Number, default: 0 },
    rowsSkipped: { type: Number, default: 0 },

    checks: { type: [checkSchema], default: [] },
    issues: { type: [issueSchema], default: [] },

    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    committedAt: { type: Date, default: null },
    rolledBackAt: { type: Date, default: null },
    rolledBackBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

importBatchSchema.statics.STATUSES = STATUSES;

const ImportBatch = mongoose.model('ImportBatch', importBatchSchema);
module.exports = ImportBatch;
