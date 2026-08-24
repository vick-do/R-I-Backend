const mongoose = require('mongoose');

const UNITS = ['count', 'currency', 'percent', 'ratio'];
// How a metric collapses when facts are combined across periods.
//   sum    — additive counts (learners, impressions)
//   avg    — averages across periods (engagement rate)
//   latest — point-in-time stocks that must not be added up
const AGGREGATIONS = ['sum', 'avg', 'latest'];

/**
 * The canonical metric catalog. Adding a metric here (via the admin UI or the
 * seed) makes it available for entry, import mapping, and display without any
 * code change — which is what keeps the system operable by non-developers.
 */
const metricSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    unit: { type: String, enum: UNITS, default: 'count' },
    // Which currency a `currency` metric is denominated in. The sheets report in
    // both — UNDP-YAI's revenue in dollars, the EdTech Fellowship's in cedis —
    // and a figure shown under the wrong symbol is simply a wrong figure.
    currency: { type: String, trim: true, uppercase: true, default: 'USD' },
    aggregation: { type: String, enum: AGGREGATIONS, default: 'sum' },
    category: {
      type: String,
      enum: ['people', 'enterprise', 'investment', 'social', 'other'],
      default: 'other',
    },
    // Dimension names this metric may legitimately be broken down by.
    allowedDimensions: { type: [String], default: [] },
    // Whether this metric contributes to the org-wide Overview totals.
    rollsUpToOrgTotal: { type: Boolean, default: false },
    // Ordering on a programme page, lowest first. Controls which figure leads
    // and is charted by default — without it the page falls back to
    // alphabetical, which led EdTech Mondays with "Clicks" instead of
    // "Impressions".
    displayOrder: { type: Number, default: 500 },
    // Position in the Overview's headline row (1-based), or null to omit.
    // The Overview shows a fixed, ordered set of figures the organisation
    // reports on — not simply whichever metrics happen to hold data — so a
    // metric with nothing recorded still appears, marked as not yet recorded.
    headlineOrder: { type: Number, default: null },
    // Overview wording where it differs from the metric's own label, e.g.
    // "Learners trained" is reported as "Total no. of people trained".
    headlineLabel: { type: String, trim: true, default: null },
    // Alternative spellings seen in spreadsheets, used by the importer's
    // auto-suggest, e.g. "Total Impression" / "Impressions" → `impressions`.
    aliases: { type: [String], default: [] },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

metricSchema.statics.UNITS = UNITS;
metricSchema.statics.AGGREGATIONS = AGGREGATIONS;

const Metric = mongoose.model('Metric', metricSchema);
module.exports = Metric;
