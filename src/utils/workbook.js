const ExcelJS = require('exceljs');

/**
 * Spreadsheet cell reading.
 *
 * Both source workbooks were exported from Google Sheets, which wraps every
 * single cell as:
 *
 *   IFERROR(__xludf.DUMMYFUNCTION("COMPUTED_VALUE"), 793)
 *
 * so `cell.value` is a formula object and the real figure lives in
 * `cell.result`. Reading `cell.value` naively yields formula text for every
 * cell in the file, which would silently import zero usable numbers — hence
 * this module is the only place cells are read.
 */

/** Unwraps a cell to a plain JS value: number, string, Date, or null. */
function readCell(cell) {
  if (!cell) return null;

  let value = cell.value;

  // Google Sheets / Excel formula cells carry the evaluated value separately.
  if (value !== null && typeof value === 'object') {
    if ('result' in value) {
      value = value.result;
    } else if ('richText' in value) {
      value = value.richText.map((part) => part.text).join('');
    } else if ('text' in value) {
      value = value.text; // hyperlink
    } else if ('error' in value) {
      return null; // #REF!, #N/A — treated as empty
    }
  }

  // A formula's cached result can itself be an error object.
  if (value !== null && typeof value === 'object' && 'error' in value) return null;

  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  return value ?? null;
}

/** Cell as trimmed text, or '' when empty. */
function readText(cell) {
  const value = readCell(cell);
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * Cell as a finite number, or null.
 *
 * Handles the thousands separators, currency prefixes, percent suffixes, and
 * "-" placeholders that appear throughout the source sheets.
 */
function readNumber(cell) {
  const value = readCell(cell);
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const text = String(value).trim();
  if (text === '' || text === '-' || text === '—' || /^n\/?a$/i.test(text)) return null;

  const cleaned = text.replace(/[,\s$₵]/g, '').replace(/%$/, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Converts a 1-based column index to its letter, e.g. 1 → A, 27 → AA. */
function columnLetter(index) {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Converts a column letter to its 1-based index, e.g. AA → 27. */
function columnIndex(letter) {
  return String(letter)
    .toUpperCase()
    .split('')
    .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
}

/** Provenance string stored on every imported fact. */
function sourceRef(fileName, sheetName, address) {
  return `${fileName} › ${sheetName} › ${address}`;
}

async function loadWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

async function loadWorkbookFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/**
 * Rectangular preview of a sheet for the mapping UI: addresses plus unwrapped
 * values, so the operator sees the same numbers the importer will read.
 */
function previewSheet(worksheet, { maxRows = 60, maxCols = 30 } = {}) {
  const rowCount = Math.min(worksheet.rowCount, maxRows);
  const colCount = Math.min(worksheet.columnCount, maxCols);

  const rows = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const cells = [];
    for (let c = 1; c <= colCount; c += 1) {
      const cell = worksheet.getCell(r, c);
      const value = readCell(cell);
      cells.push({
        address: `${columnLetter(c)}${r}`,
        column: columnLetter(c),
        value: value instanceof Date ? value.toISOString() : value,
        isNumber: readNumber(cell) !== null,
      });
    }
    rows.push({ row: r, cells });
  }

  return {
    name: worksheet.name,
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    truncated: worksheet.rowCount > rowCount || worksheet.columnCount > colCount,
    rows,
  };
}

module.exports = {
  readCell,
  readText,
  readNumber,
  columnLetter,
  columnIndex,
  sourceRef,
  loadWorkbook,
  loadWorkbookFromBuffer,
  previewSheet,
};
