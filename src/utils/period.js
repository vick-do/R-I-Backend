const PERIOD_TYPES = ['all_time', 'year', 'quarter', 'month'];

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 1-indexed month number for a name/abbreviation, or null. */
function monthFromName(token) {
  const t = String(token ?? '').trim().toLowerCase().replace(/\./g, '');
  if (!t) return null;
  const idx = MONTHS.findIndex((names) => names.includes(t));
  return idx === -1 ? null : idx + 1;
}

/**
 * Builds the canonical period fields stored on every Fact.
 *
 * Periods are stored as a half-open range [periodStart, periodEnd) in UTC so
 * that range queries are simple and month/year boundaries never overlap.
 * `all_time` facts carry null bounds and are excluded from time-series queries.
 */
function buildPeriod({ periodType, year, month, quarter }) {
  if (!PERIOD_TYPES.includes(periodType)) {
    throw Object.assign(new Error(`Unknown periodType "${periodType}".`), { status: 422 });
  }

  if (periodType === 'all_time') {
    return { periodType, periodStart: null, periodEnd: null, periodLabel: 'All time', year: null };
  }

  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) {
    throw Object.assign(new Error(`Period requires a valid year, got "${year}".`), { status: 422 });
  }

  if (periodType === 'year') {
    return {
      periodType,
      periodStart: new Date(Date.UTC(y, 0, 1)),
      periodEnd: new Date(Date.UTC(y + 1, 0, 1)),
      periodLabel: String(y),
      year: y,
    };
  }

  if (periodType === 'quarter') {
    const q = Number(quarter);
    if (![1, 2, 3, 4].includes(q)) {
      throw Object.assign(new Error(`Quarter must be 1-4, got "${quarter}".`), { status: 422 });
    }
    const startMonth = (q - 1) * 3;
    return {
      periodType,
      periodStart: new Date(Date.UTC(y, startMonth, 1)),
      periodEnd: new Date(Date.UTC(y, startMonth + 3, 1)),
      periodLabel: `Q${q} ${y}`,
      year: y,
    };
  }

  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw Object.assign(new Error(`Month must be 1-12, got "${month}".`), { status: 422 });
  }
  return {
    periodType,
    periodStart: new Date(Date.UTC(y, m - 1, 1)),
    periodEnd: new Date(Date.UTC(y, m, 1)),
    periodLabel: `${MONTH_LABELS[m - 1]} ${y}`,
    year: y,
  };
}

/**
 * Interprets a free-text period label from a spreadsheet sheet name or column
 * header: "April 2026", "FEB", "2026", "Q3 2025", "2026-04".
 *
 * `defaultYear` supplies the year for bare month names (cross-tab column
 * headers are usually just "FEB", "MAR", ... with the year in the file name).
 * Returns null when the label carries no period meaning, so callers can treat
 * that column as a dimension instead.
 */
function parsePeriodLabel(label, { defaultYear = null } = {}) {
  const raw = String(label ?? '').trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');

  if (/^(all[\s-]?time|total|overall|cumulative)$/.test(normalized)) {
    return buildPeriod({ periodType: 'all_time' });
  }

  // 2026-04 / 2026/4
  const isoish = normalized.match(/^(\d{4})[-/](\d{1,2})$/);
  if (isoish) {
    return buildPeriod({ periodType: 'month', year: Number(isoish[1]), month: Number(isoish[2]) });
  }

  // Q3 2025 / 2025 Q3
  const quarter = normalized.match(/^q([1-4])\s*(\d{4})$/) || normalized.match(/^(\d{4})\s*q([1-4])$/);
  if (quarter) {
    const [a, b] = [quarter[1], quarter[2]];
    const q = a.length === 4 ? Number(b) : Number(a);
    const y = a.length === 4 ? Number(a) : Number(b);
    return buildPeriod({ periodType: 'quarter', year: y, quarter: q });
  }

  // "April 2026" / "Apr 2026" / "2026 April"
  const withYear = normalized.match(/^([a-z]+)\.?\s+(\d{4})$/) || normalized.match(/^(\d{4})\s+([a-z]+)\.?$/);
  if (withYear) {
    const [a, b] = [withYear[1], withYear[2]];
    const name = /^\d{4}$/.test(a) ? b : a;
    const y = /^\d{4}$/.test(a) ? Number(a) : Number(b);
    const m = monthFromName(name);
    if (m) return buildPeriod({ periodType: 'month', year: y, month: m });
  }

  // Bare year
  if (/^\d{4}$/.test(normalized)) {
    return buildPeriod({ periodType: 'year', year: Number(normalized) });
  }

  // Bare month name — needs a year from context
  const bareMonth = monthFromName(normalized);
  if (bareMonth) {
    if (!defaultYear) return null;
    return buildPeriod({ periodType: 'month', year: Number(defaultYear), month: bareMonth });
  }

  return null;
}

/** Extracts a 4-digit year from a filename or sheet title, e.g. "…2026.xlsx". */
function yearFromText(text) {
  const match = String(text ?? '').match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

/** Mongo filter for facts falling inside a period, for time-series queries. */
function periodRangeFilter({ from, to, periodType }) {
  const filter = {};
  if (periodType) filter.periodType = periodType;
  if (from) filter.periodStart = { ...(filter.periodStart ?? {}), $gte: new Date(from) };
  if (to) filter.periodEnd = { ...(filter.periodEnd ?? {}), $lte: new Date(to) };
  return filter;
}

module.exports = {
  PERIOD_TYPES,
  MONTH_LABELS,
  monthFromName,
  buildPeriod,
  parsePeriodLabel,
  yearFromText,
  periodRangeFilter,
};
