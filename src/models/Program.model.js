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
    // Which metric keys this programme reports on. Drives the generated entry
    // forms, and what Data Quality expects to find recorded here.
    metricKeys: { type: [String], default: [] },
    /**
     * The figures this page leads with, whatever happens to be recorded.
     *
     * A page normally shows a card for every metric that has a figure under
     * it, which reads well for a programme reporting three or four things and
     * badly either way at the edges: a roll-up covering five programmes shows
     * two dozen cards, and two sibling programmes show different cards from
     * each other depending on what has been filled in so far.
     *
     * Listed here, the page shows exactly these, in catalog order, with an
     * empty card where nothing has been recorded yet. Empty says "not
     * reported", which is a fact about the programme worth showing; a missing
     * card says nothing at all.
     *
     * Kept apart from `metricKeys` on purpose. This is what a reader sees;
     * `metricKeys` is what the programme is expected to report and what it can
     * have typed into it, and Data Quality reads that one.
     */
    headlineMetricKeys: { type: [String], default: [] },
    description: { type: String, trim: true, default: null },
    /**
     * What the navigation calls this page, when that differs from its title.
     *
     * For a page whose full title is too long or too descriptive to sit in the
     * sidebar, this is the shorter name the navigation uses instead. Null means
     * the two are the same, which is the normal case.
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
