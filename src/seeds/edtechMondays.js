/**
 * Where EdTech Mondays sits in the consolidated workbook, and how to read it.
 *
 * The tab is the season's own consolidated report — "All data is automatically
 * pulled from monthly sheets", as row 2 puts it — so it is the one place the
 * figures should come from.
 *
 * It reports the same season twice over, which is the whole point of it:
 *
 *   · down the left, by CHANNEL — MEST Africa, Citi FM, Channel One TV,
 *     Panelists — with the months running across;
 *   · down the right, by PLATFORM — YouTube, Facebook, Twitter, LinkedIn,
 *     Instagram — the same months again.
 *
 * They are two views of one season, not two seasons, so they land on separate
 * dimension signatures and are never added to each other.
 *
 * Beneath the platforms sits press coverage, whose rows are news sites rather
 * than measures. That is `article_reach`, kept apart from social reach because
 * the sheet's own summary keeps them apart, and adding them would count one
 * audience under two headings.
 *
 * Extracted from `scripts/connect-edtech-mondays.js` so the connector and
 * `scripts/backfill-edtech-mondays.js` read the sheet through one description
 * of it rather than two that can drift apart.
 */

const SPREADSHEET_ID = '1g_XYCeCXCM5z6O7DELzZ4bQi-SX-JNpPGh1CnoIC0VE';
// The trailing space is the tab's real name; it is not a typo here.
const TAB = 'EdTech Mondays ';
const PROGRAM = 'ecosystem-edtech-mondays';
const YEAR = 2026;

/** Months run across each half; the last column restates the row as a total. */
const season = ({ name, dimension, value, labelColumn, first, last, firstDataColumn, lastDataColumn }) => ({
  name,
  mapping: {
    layout: 'crosstab',
    fixedDimensions: { [dimension]: value },
    crosstab: {
      headerRow: 4, labelColumn,
      firstDataRow: first, lastDataRow: last,
      firstDataColumn, lastDataColumn,
      headerRole: 'period', defaultYear: YEAR,
    },
  },
});

const byChannel = (value, first, last) =>
  season({ name: `${value} — by month`, dimension: 'channel', value, labelColumn: 'A', first, last, firstDataColumn: 'B', lastDataColumn: 'L' });

const byPlatform = (value, first, last) =>
  season({ name: `${value} — by month`, dimension: 'platform', value, labelColumn: 'O', first, last, firstDataColumn: 'P', lastDataColumn: 'Z' });

const BLOCKS = [
  byChannel('mest-africa', 6, 14),
  // Row 25 is Channel One TV's post count, and February's cell holds a note
  // rather than a number: that month's figures reached MEST as one Citi FM
  // total, before the two were split. Text reads as no value, so February is
  // absent for this channel rather than recorded as zero.
  byChannel('citi-fm', 16, 23),
  byChannel('channel-one-tv', 25, 30),
  byChannel('panelists', 32, 39),

  byPlatform('youtube', 6, 11),
  byPlatform('facebook', 13, 18),
  byPlatform('twitter', 20, 25),
  byPlatform('linkedin', 27, 32),
  byPlatform('instagram', 34, 39),

  {
    name: 'Press coverage — by month',
    mapping: {
      layout: 'crosstab',
      crosstab: {
        headerRow: 4, labelColumn: 'O',
        firstDataRow: 41, lastDataRow: 43,
        firstDataColumn: 'P', lastDataColumn: 'Z',
        headerRole: 'period', defaultYear: YEAR,
        // The rows here name news sites, not measures.
        labelRole: 'dimension', labelDimension: 'outlet', metric: 'article_reach',
      },
    },
  },
];

/** The sheet's own year-end summary, for checking the import against. */
const SUMMARY_ROWS = [
  ['posts', 51], ['impressions', 52], ['reach', 53], ['engagement', 54],
  ['reactions', 55], ['comments', 56], ['shares', 57], ['clicks', 58],
  ['video_views', 59], ['article_reach', 60],
];

/**
 * Cells that must still read what they read when the mapping was written.
 *
 * Every block above is a range of row numbers, which means a row inserted in
 * the sheet silently moves a figure into the wrong metric. These are checked
 * first, and a mismatch stops the import rather than writing into the wrong
 * coordinates.
 */
const ANCHORS = [
  ['A1', '2026  CONSOLIDATED REPORT'], ['A4', 'PLATFORM'], ['B4', 'FEB'], ['L4', 'TOTAL'],
  ['O4', 'MEDIA'], ['P4', 'FEB'], ['Z4', 'TOTAL'],
  ['A5', 'MEST AFRICA'], ['A15', 'CITI FM'], ['A24', 'CHANNEL ONE TV'], ['A31', 'PANELISTS'],
  ['O5', 'YOUTUBE'], ['O12', 'FACEBOOK'], ['O19', 'TWITTER'], ['O26', 'LINKEDIN'],
  ['O33', 'INSTAGRAM'], ['O40', 'ARTICLES'], ['A49', 'SUMMARY (ALL CHANNELS)'],
];

module.exports = { SPREADSHEET_ID, TAB, PROGRAM, YEAR, BLOCKS, SUMMARY_ROWS, ANCHORS };
