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
    isReportable: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

programSchema.index({ parent: 1, order: 1 });

const Program = mongoose.model('Program', programSchema);
module.exports = Program;
