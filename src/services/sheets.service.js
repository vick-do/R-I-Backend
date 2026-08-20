const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { columnLetter, columnIndex } = require('../utils/workbook');

/**
 * Reads Google Sheets through a service account.
 *
 * The account is granted Viewer on each sheet, so this path can read the data
 * and can never write back to it — the spreadsheet stays exactly as the R&I
 * team left it.
 *
 * Values are requested UNFORMATTED, which returns real numbers. The
 * `IFERROR(__xludf.DUMMYFUNCTION(...))` wrapper that `workbook.js` exists to
 * unpick is an artifact of exporting a sheet to .xlsx; reading the live API
 * never produces it.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function isConfigured() {
  return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}

function requireConfigured() {
  if (!isConfigured()) {
    throw Object.assign(
      new Error(
        'Google Sheets is not configured. Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY from the service account key.'
      ),
      { status: 503 }
    );
  }
}

let cachedToken = null;

/**
 * Exchanges a signed assertion for an access token, reusing it until a minute
 * before it expires.
 */
async function accessToken() {
  requireConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: env.GOOGLE_CLIENT_EMAIL, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    env.GOOGLE_PRIVATE_KEY,
    { algorithm: 'RS256' }
  );

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(`Google rejected the service account: ${body.error_description ?? body.error ?? res.status}`),
      { status: 502 }
    );
  }

  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function callSheets(path) {
  const token = await accessToken();
  const res = await fetch(`${SHEETS_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = body?.error?.message ?? `Google Sheets returned ${res.status}`;
    // 403 here almost always means the sheet was never shared with the service
    // account, which is worth saying plainly rather than as a status code.
    const hint =
      res.status === 403
        ? ` Share the spreadsheet with ${env.GOOGLE_CLIENT_EMAIL} (Viewer is enough).`
        : res.status === 404
          ? ' Check the spreadsheet ID and tab name.'
          : '';
    throw Object.assign(new Error(`${message}${hint}`), { status: res.status === 404 ? 404 : 502 });
  }

  return body;
}

/** Spreadsheet title and its tabs, used when connecting a sheet. */
async function describe(spreadsheetId) {
  const body = await callSheets(
    `/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(title,gridProperties)`
  );

  return {
    title: body.properties?.title ?? 'Untitled',
    tabs: (body.sheets ?? []).map((s) => ({
      name: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
      columnCount: s.properties.gridProperties?.columnCount ?? 0,
    })),
  };
}

/** Raw row-major values for one tab. */
async function fetchValues({ spreadsheetId, tabName }) {
  // A tab name containing spaces or punctuation has to be quoted in the range,
  // and an embedded quote is escaped by doubling it.
  const range = `'${String(tabName).replace(/'/g, "''")}'`;
  const body = await callSheets(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
      `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`
  );
  return body.values ?? [];
}

/**
 * Wraps a grid of values in the shape the importer expects.
 *
 * `plan`, `extract`, `locateAnchoredBlock`, `reconcile` and `suggestMapping`
 * touch a worksheet through exactly four members — getCell, rowCount,
 * columnCount and name — so satisfying those four lets every one of them run
 * against a Google Sheet with no change.
 *
 * getCell accepts both call styles the importer uses: numeric (row, column) and
 * an A1 address string.
 */
function toWorksheet({ name, values }) {
  const rowCount = values.length;
  const columnCount = values.reduce((max, row) => Math.max(max, row.length), 0);

  const at = (row, col) => {
    const raw = values[row - 1]?.[col - 1];
    return { value: raw === undefined || raw === '' ? null : raw };
  };

  return {
    name,
    rowCount,
    columnCount,
    getCell(a, b) {
      if (typeof b === 'number') return at(a, b);

      const match = /^([A-Za-z]+)(\d+)$/.exec(String(a));
      if (!match) return { value: null };
      return at(Number(match[2]), columnIndex(match[1]));
    },
  };
}

/** One tab, ready for the importer. */
async function loadWorksheet({ spreadsheetId, tabName }) {
  const values = await fetchValues({ spreadsheetId, tabName });
  return toWorksheet({ name: tabName, values });
}

module.exports = {
  isConfigured,
  accessToken,
  describe,
  fetchValues,
  toWorksheet,
  loadWorksheet,
  columnLetter,
};
