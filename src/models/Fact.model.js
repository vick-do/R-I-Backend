const mongoose = require('mongoose');
const { PERIOD_TYPES } = require('../utils/period');

const SOURCES = ['manual', 'import', 'api'];

/**
 * A single impact observation: program × metric × period × dimensions = value.
 *
 * Every sheet in both source workbooks reduces to this shape, which is what
 * lets one model serve every programme without per-programme tables.
 *
 * Two invariants:
 *
 *  1. Facts are append-only. A correction writes a new version and flips the
 *     old row's `isCurrent` to false rather than mutating it, so historical
 *     data is never lost and every number keeps its full revision history.
 *
 *  2. Only leaf facts are stored. Totals stated in a spreadsheet are used to
 *     validate an import (see ImportBatch.checks) but are never persisted as
 *     facts — all totals shown in the dashboard are derived by aggregation.
 */
const factSchema = new mongoose.Schema(
  {
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true, index: true },
    metric: { type: mongoose.Schema.Types.ObjectId, ref: 'Metric', required: true, index: true },

    periodType: { type: String, enum: PERIOD_TYPES, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    periodLabel: { type: String, required: true, trim: true },
    year: { type: Number, default: null, index: true },

    // Canonical slug bag, e.g. { gender: 'female', hub: 'accra' }.
    dimensions: { type: Map, of: String, default: {} },
    // Sorted dimension names. Facts may only be summed within one signature.
    dimensionSignature: { type: [String], default: [] },
    dimensionSignatureKey: { type: String, default: '', index: true },
    // Stable serialisation of the whole bag, used for uniqueness and diffing.
    dimensionKey: { type: String, default: '' },

    value: { type: Number, required: true },

    source: { type: String, enum: SOURCES, required: true },
    // Cell-level provenance, e.g. "EdTech Mondays Analytics 2026.xlsx › April 2026 › K9".
    sourceRef: { type: String, trim: true, default: null },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', default: null, index: true },

    version: { type: Number, default: 1 },
    isCurrent: { type: Boolean, default: true },
    supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'Fact', default: null },

    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

// One current fact per program/metric/period/dimension coordinate. Superseded
// versions are excluded so history can accumulate behind the live value.
factSchema.index(
  { program: 1, metric: 1, periodType: 1, periodStart: 1, dimensionKey: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } }
);

// Primary read path: aggregate one metric across time within one signature.
factSchema.index({ program: 1, metric: 1, dimensionSignatureKey: 1, periodStart: 1, isCurrent: 1 });

factSchema.statics.SOURCES = SOURCES;

const Fact = mongoose.model('Fact', factSchema);
module.exports = Fact;
