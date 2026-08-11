const mongoose = require('mongoose');
const { slugify } = require('../utils/dimensions');

const dimensionValueSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * A breakdown axis (gender, hub, sector, platform, …) and its permitted values.
 *
 * Facts store slugs; this catalog holds the display labels and the aliases the
 * importer uses to resolve spreadsheet spellings ("Womans Haven Africa",
 * "Woman's Haven") onto one canonical value.
 */
const dimensionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    values: { type: [dimensionValueSchema], default: [] },
    // When false, previously unseen values may be added automatically — by the
    // importer and by manual entry alike. Cohorts, hubs, regions and sectors
    // grow over time and must not need a developer to extend them.
    isClosed: { type: Boolean, default: false },
    // How to label a value created on the fly, e.g. "Cohort {value}" turns a
    // typed "7" into "Cohort 7" so it matches the seeded entries.
    labelTemplate: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

/**
 * Comparison form for matching spreadsheet labels.
 *
 * Apostrophes and spacing vary between sheets — the Grow sheet writes the same
 * hub as "Womans Haven Africa" in one block and "Women's Haven Africa
 * (Digital Marketing)" in another. Without normalising, the second spelling
 * would be added as a separate hub and split that hub's figures in two.
 */
function comparable(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ');
}

/** Resolves a raw spreadsheet label onto a canonical value, or null. */
dimensionSchema.methods.resolve = function (raw) {
  const needle = comparable(raw);
  if (!needle) return null;
  return (
    this.values.find(
      (v) =>
        comparable(v.value) === needle ||
        comparable(v.label) === needle ||
        v.aliases.some((a) => comparable(a) === needle)
    ) ?? null
  );
};

/**
 * Recovers the `{value}` part of a templated label: with template
 * "Cohort {value}", both "Cohort 8" and "8" yield "8".
 */
function stripTemplate(labelTemplate, raw) {
  const text = String(raw ?? '').trim();
  if (!labelTemplate || !labelTemplate.includes('{value}')) return text;

  const [before, after] = labelTemplate.split('{value}');
  const escape = (s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escape(before)}\\s*(.+?)\\s*${escape(after)}$`, 'i');

  const matched = text.match(pattern);
  return matched ? matched[1] : text;
}

dimensionSchema.statics.comparable = comparable;
dimensionSchema.statics.stripTemplate = stripTemplate;

/**
 * Resolves a raw label to a canonical value, adding it to the catalog when the
 * dimension is open and the value is new.
 *
 * Shared by the importer and by manual entry so both extend the catalog the
 * same way — a cohort typed into the entry form and a cohort read out of a
 * spreadsheet must end up as the same value, not two near-duplicates.
 *
 * Returns { value, created } on success, or { value: null, closed: true } when
 * the dimension is closed and the label is unrecognised.
 */
dimensionSchema.methods.resolveOrCreate = async function (raw) {
  const match = this.resolve(raw);
  if (match) return { value: match.value, created: false };

  if (this.isClosed) return { value: null, created: false, closed: true };

  // Strip the label template before slugifying, so "Cohort 8" and "8" produce
  // the same value. Without this they became two catalog entries — `cohort-8`
  // labelled "Cohort Cohort 8", and `8` labelled "Cohort 8" — splitting one
  // cohort's figures across two breakdowns.
  const text = stripTemplate(this.labelTemplate, raw);
  const value = slugify(text);
  if (!value) return { value: null, created: false, closed: false };

  // Re-check against the slug itself: "Cohort 7" and "cohort-7" are one value.
  const existing = this.values.find((v) => v.value === value);
  if (existing) return { value: existing.value, created: false };

  const label = this.labelTemplate ? this.labelTemplate.replace('{value}', text) : text;
  this.values.push({
    value,
    label,
    aliases: [],
    order: Math.max(0, ...this.values.map((v) => v.order ?? 0)) + 1,
  });
  await this.save();

  return { value, created: true, label };
};

const Dimension = mongoose.model('Dimension', dimensionSchema);
module.exports = Dimension;
