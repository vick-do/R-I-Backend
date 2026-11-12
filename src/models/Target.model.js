const mongoose = require('mongoose');
const { PERIOD_TYPES } = require('../utils/period');

/**
 * What a programme committed to, against what it has done.
 *
 * Deliberately its own collection rather than a flag on `Fact`.
 *
 * A fact is an observation: something happened and was counted. A target is a
 * commitment made before anything happened, and the two are never the same kind
 * of claim even when they share a coordinate. Putting them in one collection
 * would mean every aggregation in the system — the Overview totals, the roll-ups,
 * the funnel, every breakdown — had to remember to exclude targets, and the one
 * that forgot would quietly report a number half of which had not happened yet.
 * One missed filter is a wrong figure on a funder's page.
 *
 * So targets live here, are never aggregated with facts, and are read only by
 * the code that means to compare the two.
 *
 * The actual is not stored. The sheets state one beside each target, but the
 * facts already hold it and a second copy is a second answer: the Fellowship
 * sheet currently states 16,684 learners with disabilities against a target,
 * where its own learner rows say 25,775 — it reads the active-learner row by
 * mistake. Computing the actual from facts keeps one source of truth, and the
 * stated figure is kept beside it as `statedActual` so the disagreement is
 * visible rather than silently resolved.
 */
const targetSchema = new mongoose.Schema(
  {
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true, index: true },
    metric: { type: mongoose.Schema.Types.ObjectId, ref: 'Metric', required: true, index: true },

    periodType: { type: String, enum: PERIOD_TYPES, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    periodLabel: { type: String, required: true, trim: true },
    year: { type: Number, default: null, index: true },

    // The same canonical slug bag a fact carries, so a target for female
    // learners lines up with the fact that counts them.
    dimensions: { type: Map, of: String, default: {} },
    dimensionSignature: { type: [String], default: [] },
    dimensionKey: { type: String, default: '' },

    value: { type: Number, required: true },

    /**
     * What the source stated the actual to be, where it stated one.
     *
     * Never served as the actual — it is kept so an import can be reconciled
     * against the source, and so a disagreement between the two can be shown.
     */
    statedActual: { type: Number, default: null },

    // What the target is called where it was set, when that is not simply the
    // metric's own name: "RDP" for displaced and refugee learners, say.
    label: { type: String, trim: true, default: null },

    sourceRef: { type: String, trim: true, default: null },
    note: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

// One target per programme, metric, period and coordinate.
targetSchema.index(
  { program: 1, metric: 1, periodType: 1, periodStart: 1, dimensionKey: 1 },
  { unique: true }
);

const Target = mongoose.model('Target', targetSchema);
module.exports = Target;
