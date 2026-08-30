const mongoose = require('mongoose');

/**
 * A programme or programme grouping. Mirrors the dashboard navigation tree, so
 * `pageKey` matches the keys already used in the frontend's navItems.ts.
 *
 * Container nodes (MEST X, Digital Skills, Venture Support) have
 * `isReportable: false` — they hold no facts of their own and instead roll up
 * their descendants.
 */
const programSchema = new mongoose.Schema(
  {
    pageKey: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', default: null, index: true },
    // Denormalised ancestor chain so a rollup is one query instead of a recursive walk.
    ancestors: { type: [mongoose.Schema.Types.ObjectId], ref: 'Program', default: [] },
    depth: { type: Number, default: 0 },
    order: { type: Number, default: 0 },

    category: {
      type: String,
      enum: ['digital_skills', 'venture_support', 'ecosystem', 'portfolio', 'lab', 'container'],
      default: 'container',
    },
    // Which metric keys this programme reports on. Drives the generated entry forms.
    metricKeys: { type: [String], default: [] },
    description: { type: String, trim: true, default: null },
    /**
     * What the navigation calls this page, when that differs from its title.
     *
     * The Absa page is titled "Females supported by MEST" — what the programme
     * reports — while the sidebar keeps calling it by the partnership everyone
     * knows it by. Null means the two are the same, which is the normal case.
     */
    navLabel: { type: String, trim: true, default: null },

    isReportable: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
    // Whether a person may type figures into this programme by hand.
    //
    // False where the connected sheet is the only place a figure should come
    // from — a hand-typed count beside a roster the importer recounts nightly
    // would be overwritten on the next sync, or worse, sit beside it as a
    // second answer to the same question.
    allowsManualEntry: { type: Boolean, default: true },
  },
  { timestamps: true }
);

programSchema.index({ parent: 1, order: 1 });

const Program = mongoose.model('Program', programSchema);
module.exports = Program;
