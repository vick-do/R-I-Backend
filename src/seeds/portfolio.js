/**
 * Where the investment portfolio sits in the consolidated workbook, and how to
 * read it.
 *
 * The tab is a report rather than a table. Everything sits in columns D to F,
 * and it says three kinds of thing:
 *
 *   · a funding table on rows 9-12, with a row per measure and a column per
 *     population — the full portfolio since inception, and the active companies
 *     within it;
 *   · a snapshot on row 15, three cells each holding a caption and its figure
 *     on two lines of one cell, which is why they are read by hand below rather
 *     than mapped;
 *   · three rosters of company names, three names to a row: the female-led
 *     businesses, the active businesses, and the full portfolio.
 *
 * The active population is a subset of the full one, never a second half of it.
 * They are stored on the `venture_status` axis so that a page can show one
 * inside the other, and are never added together.
 *
 * The rosters are read as one enterprise each, on the `company` axis. That is
 * what makes them reconcile: the ninety-eight names add to the ninety-eight the
 * snapshot states, and the twenty-nine active names to its twenty-nine. They
 * are a roster to list, not an axis to chart.
 */

const SPREADSHEET_ID = '1g_XYCeCXCM5z6O7DELzZ4bQi-SX-JNpPGh1CnoIC0VE';
// The trailing space is the tab's real name.
const TAB = 'Portfolio ';
const PROGRAM = 'portfolio';
const ALL_TIME = { periodType: 'all_time' };

const val = (column, metric) => ({ column, matchBy: 'letter', role: 'metric', target: metric });

/** One figure, at one cell, on one row. */
const cell = (name, row, column, metric, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: row, lastDataRow: row,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions,
    columns: [val(column, metric)],
  },
});

/**
 * The funding table: column E is the whole portfolio, column F the active part
 * of it.
 */
const BLOCKS = [
  cell('Investment promised — since inception', 10, 'E', 'investment_promised'),
  cell('Investment promised — active companies', 10, 'F', 'investment_promised', { venture_status: 'active' }),

  cell('Funding disbursed — since inception', 11, 'E', 'amount_invested'),
  cell('Funding disbursed — active companies', 11, 'F', 'amount_invested', { venture_status: 'active' }),

  cell('Portfolio companies — since inception', 12, 'E', 'enterprises_total'),
  cell('Portfolio companies — active', 12, 'F', 'enterprises_total', { venture_status: 'active' }),
];

/**
 * The three rosters, as blocks of cells three columns wide.
 *
 * Every name is one enterprise. `dimensions` is what each name is counted as
 * besides its own: the female-led list is a gender split of the portfolio, the
 * active list a status split, and the full list the portfolio itself.
 */
const ROSTERS = [
  { name: 'Female-led businesses', first: 19, last: 20, dimensions: { gender: 'female' }, expected: 5 },
  { name: 'Active businesses', first: 24, last: 33, dimensions: { venture_status: 'active' }, expected: 29 },
  { name: 'Full portfolio', first: 37, last: 69, dimensions: {}, expected: 98 },
];

/** The columns a roster's names run across. */
const ROSTER_COLUMNS = ['D', 'E', 'F'];

/**
 * The snapshot on row 15, where each cell holds its own caption.
 *
 * "Total Portfolio Companies\n98" is one cell, so there is no column to map a
 * value from. The figure is taken from the text, and checked against the
 * caption so a reordered snapshot is caught rather than silently read as the
 * wrong measure.
 */
const SNAPSHOT = [
  { cell: 'D15', caption: 'Total Portfolio Companies', expected: 98 },
  { cell: 'E15', caption: 'Active Companies', expected: 29 },
  { cell: 'F15', caption: 'Female-Led Businesses', expected: 5 },
];

/** What the tab should still say, so a restructured sheet is caught. */
const ANCHORS = [
  ['D6', 'Portfolio Report'], ['D7', 'Funding Overview'],
  ['D9', 'Metric'], ['E9', 'Since Inception (Full Portfolio)'], ['F9', 'Active Companies'],
  ['D10', 'Investment Promised'], ['D11', 'Funding Disbursed'], ['D12', 'Portfolio Companies'],
  ['D14', 'Portfolio Snapshot'], ['D17', 'Female-Led Businesses'],
  ['D22', 'Active Businesses (29)'],
];

module.exports = {
  SPREADSHEET_ID, TAB, PROGRAM, BLOCKS, ROSTERS, ROSTER_COLUMNS, SNAPSHOT, ANCHORS,
};
