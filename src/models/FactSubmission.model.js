const mongoose = require('mongoose');
const { PERIOD_TYPES } = require('../utils/period');

const STATUSES = ['pending', 'approved', 'returned'];

/**
 * A figure someone proposes, before it becomes a fact.
 *
 * This lives in its own collection rather than as a status on `Fact`, and that
 * is deliberate. `Fact` carries a unique partial index on
 * program × metric × period × dimensionKey where `isCurrent: true` — the thing
 * that structurally prevents one coordinate holding two live values. Putting
 * pending rows in that collection would force the index to be loosened, and
 * loosening it is exactly what protects against double-counting.
 *
 * A submission is a proposal about a coordinate, not a value at it. On approval
 * it runs the ordinary append-only write path, so an approved figure is
 * indistinguishable from a directly recorded one — versioned, attributed, and
 * reversible in the same way.
 */
const factSubmissionSchema = new mongoose.Schema(
  {
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true, index: true },
    metric: { type: mongoose.Schema.Types.ObjectId, ref: 'Metric', required: true, index: true },

    periodType: { type: String, enum: PERIOD_TYPES, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    periodLabel: { type: String, required: true, trim: true },
    year: { type: Number, default: null },

    // Stored exactly as a fact stores them, so the coordinate a submission
    // names is the coordinate the write will land on.
    dimensions: { type: Map, of: String, default: {} },
    dimensionSignature: { type: [String], default: [] },
    dimensionSignatureKey: { type: String, default: '' },
    dimensionKey: { type: String, default: '', index: true },

    value: { type: Number, required: true },
    note: { type: String, trim: true, default: null },

    status: { type: String, enum: STATUSES, default: 'pending', index: true },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    submittedAt: { type: Date, default: Date.now },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, default: null },

    // Set on approval, so a published figure can be traced back to the proposal.
    resultingFact: { type: mongoose.Schema.Types.ObjectId, ref: 'Fact', default: null },
  },
  { timestamps: true }
);

// The queue is read newest-first and filtered by status far more than anything
// else.
factSubmissionSchema.index({ status: 1, submittedAt: -1 });

factSubmissionSchema.statics.STATUSES = STATUSES;

const FactSubmission = mongoose.model('FactSubmission', factSubmissionSchema);
module.exports = FactSubmission;
