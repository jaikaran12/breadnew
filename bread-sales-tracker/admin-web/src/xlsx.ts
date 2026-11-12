import { strToU8, zipSync } from 'fflate';

/*
 * A small Excel (.xlsx) writer for one sheet, made in the browser. It writes the file the way Excel itself
 * does (shared strings, a real date cell with a date format) so programs that import Excel files, such as
 * Tally, read it like a sheet typed in Excel.
 */

/** A cell: text, a number, a date ("YYYY-MM-DD", shown with the sheet's date format), or empty. */
export type Cell = string | number | { date: string } | null | undefined;

export interface Sheet {
  name: string;
  header: string[];
  rows: Cell[][];
  /** Column widths in Excel units, by column (missing = Excel's default). */
  widths?: number[];
  /** Excel number format for date cells, e.g. "dd-mm-yyyy". */
  dateFormat: string;
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** "A", "B", … "Z", "AA", "AB", … for a 0-based column index. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Days since 30 Dec 1899 (Excel's date numbers) for "YYYY-MM-DD". */
export function excelDate(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Not a date: ${isoDate}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 + 25_569;
}

function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '') // not allowed in XML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Number as Excel stores it: plain digits, no exponent, at most 10 decimals. */
function numberText(n: number): string {
  if (!Number.isFinite(n)) throw new Error('A number in the sheet is not finite');
  const rounded = Math.round(n * 1e10) / 1e10;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function buildXlsx(sheet: Sheet): Uint8Array {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  let stringCount = 0;
  const shared = (text: string) => {
    stringCount++;
    let i = stringIndex.get(text);
    if (i === undefined) {
      i = strings.length;
      strings.push(text);
      stringIndex.set(text, i);
    }
    return i;
  };

  const DATE_STYLE = 1;
  const rowXml = (cells: Cell[], r: number) => {
    const out: string[] = [];
    cells.forEach((cell, c) => {
      if (cell === null || cell === undefined || cell === '') return;
      const ref = `${columnName(c)}${r}`;
      if (typeof cell === 'number') out.push(`<c r="${ref}"><v>${numberText(cell)}</v></c>`);
      else if (typeof cell === 'string') out.push(`<c r="${ref}" t="s"><v>${shared(cell)}</v></c>`);
      else out.push(`<c r="${ref}" s="${DATE_STYLE}"><v>${excelDate(cell.date)}</v></c>`);
    });
    return `<row r="${r}">${out.join('')}</row>`;
  };

  const lastColumn = columnName(Math.max(sheet.header.length, ...sheet.rows.map((r) => r.length)) - 1);
  const body = [rowXml(sheet.header, 1), ...sheet.rows.map((cells, i) => rowXml(cells, i + 2))].join('');
  const cols = (sheet.widths ?? [])
    .map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : ''))
    .join('');
  const worksheet =
    `${XML_HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">` +
    `<dimension ref="A1:${lastColumn}${sheet.rows.length + 1}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${body}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`;

  const sst =
    `${XML_HEAD}<sst xmlns="${MAIN}" count="${stringCount}" uniqueCount="${strings.length}">` +
    strings
      .map((t) => {
        const keepSpaces = /^\s|\s$|\n/.test(t) ? ' xml:space="preserve"' : '';
        return `<si><t${keepSpaces}>${escapeXml(t)}</t></si>`;
      })
      .join('') +
    `</sst>`;

  const styles =
    `${XML_HEAD}<styleSheet xmlns="${MAIN}">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="${escapeXml(sheet.dateFormat)}"/></numFmts>` +
    `<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const workbook =
    `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}">` +
    `<bookViews><workbookView/></bookViews>` +
    `<sheets><sheet name="${escapeXml(sheet.name)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML_HEAD}<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML_HEAD}<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
        `</Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
    'xl/styles.xml': strToU8(styles),
    'xl/sharedStrings.xml': strToU8(sst),
  };
  return zipSync(files, { level: 6 });
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
