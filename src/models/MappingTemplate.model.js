const mongoose = require('mongoose');

const LAYOUTS = ['long', 'crosstab'];

/**
 * A saved column mapping, so a recurring report (next month's EdTech Mondays
 * sheet) imports in one click instead of being re-mapped by hand.
 *
 * Two layouts are supported because the source workbooks use both:
 *
 *  long     — one observation per row; each column is a metric, a dimension,
 *             or the period.
 *  crosstab — metrics run down a label column and periods (or dimension
 *             values) run across a header row. The importer melts the block
 *             into facts. This is the shape of the 2026 Consolidated sheet,
 *             the Grow cohort tables, and the Facebook/LinkedIn annual series.
 */
const columnRuleSchema = new mongoose.Schema(
  {
    // Column letter ("C") or header text, depending on `matchBy`.
    column: { type: String, required: true, trim: true },
    matchBy: { type: String, enum: ['letter', 'header'], default: 'letter' },
    role: { type: String, enum: ['metric', 'dimension', 'period', 'ignore'], required: true },
    // role=metric → metric key; role=dimension → dimension name.
    target: { type: String, trim: true, default: null },
    // role=dimension with a fixed value applied to every row in the column.
    fixedValue: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const mappingTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    layout: { type: String, enum: LAYOUTS, required: true },

    // Matching hints used to auto-suggest this template for a new upload.
    matchFileNamePattern: { type: String, trim: true, default: null },
    matchSheetNamePattern: { type: String, trim: true, default: null },

    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', default: null },
    // Dimensions applied to every fact produced, e.g. { channel: 'mest-africa' }.
    fixedDimensions: { type: Map, of: String, default: {} },
    defaultPeriod: {
      periodType: { type: String, default: 'all_time' },
      year: { type: Number, default: null },
      month: { type: Number, default: null },
    },

    // layout=long
    headerRow: { type: Number, default: 1 },
    firstDataRow: { type: Number, default: 2 },
    // Bounds the block. Required whenever a sheet stacks several unrelated
    // tables in one column, which both source workbooks do heavily.
    lastDataRow: { type: Number, default: null },
    columns: { type: [columnRuleSchema], default: [] },

    // layout=crosstab
    crosstab: {
      // Row whose cells name the periods (or dimension values) across the top.
      headerRow: { type: Number, default: null },
      // Column whose cells name the metric on each row.
      labelColumn: { type: String, default: null },
      firstDataRow: { type: Number, default: null },
      lastDataRow: { type: Number, default: null },
      firstDataColumn: { type: String, default: null },
      lastDataColumn: { type: String, default: null },
      // What the header row means:
      //   period    — each column is a period (the 2026 Consolidated shape)
      //   dimension — each column is a value of `headerDimension`
      //   none      — a single value column belonging to `defaultPeriod`.
      //               This is the vertical "metric name / value" block that
      //               appears throughout both workbooks.
      headerRole: { type: String, enum: ['period', 'dimension', 'none'], default: 'period' },
      headerDimension: { type: String, default: null },
      // Year for bare month headers like "FEB".
      defaultYear: { type: Number, default: null },

      // Locates the block by finding a label instead of hard-coding cells.
      //
      // The EdTech monthly sheets move their blocks between months — February
      // puts "MEST TOTAL" at W6, March through November at V6, and the Citi FM
      // block drifts between rows 20 and 22. A fixed mapping would quietly
      // import the wrong cells each month; anchoring follows the drift.
      //
      // Offsets are relative to the anchor cell and describe the block's shape,
      // which stays constant even as its position moves.
      anchor: {
        text: { type: String, default: null },
        headerRowOffset: { type: Number, default: 1 },
        firstDataRowOffset: { type: Number, default: 2 },
        lastDataRowOffset: { type: Number, default: 12 },
        labelColumnOffset: { type: Number, default: 0 },
        dataColumnOffset: { type: Number, default: 1 },
      },
    },

    // Row labels that state a total rather than a leaf value. These are not
    // imported as facts; they become reconciliation checks on the batch.
    totalRowLabels: { type: [String], default: ['total', 'totals', 'grand total', 'sum'] },
    // Interprets percent columns stored as 0.4135 vs 41.35. Explicit rather
    // than guessed, because guessing silently corrupts rates.
    percentScale: { type: String, enum: ['fraction', 'percent'], default: 'fraction' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

mappingTemplateSchema.statics.LAYOUTS = LAYOUTS;

const MappingTemplate = mongoose.model('MappingTemplate', mappingTemplateSchema);
module.exports = MappingTemplate;
