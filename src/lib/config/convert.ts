/**
 * Converting one configuration document into another spelling of itself:
 * JSON, YAML, TOML and CSV, in any direction.
 *
 * The pivot is a plain JavaScript value. Every parser here produces one and
 * every serializer takes one, so adding a format is two functions rather than
 * twelve pairings — and a conversion can never carry a formatting detail from
 * the source into the target, because there is no path for it to travel.
 *
 * What that pivot cannot carry is the point of the warnings this module
 * returns. **Comments do not survive**: they belong to the text, not to the
 * data, and the moment a document becomes a value they are gone. YAML anchors
 * collapse into the value they pointed at. TOML dates arrive as `Date`s and
 * leave as ISO strings. None of this is a bug to be fixed later; it is what
 * converting between formats means, and the modal says so rather than letting
 * someone discover it after replacing a file.
 *
 * TOML arrives through `smol-toml` (MIT), lazily: it is the one format here
 * whose grammar is too large to hand-roll honestly — dates, multi-line
 * strings, arrays of tables — and a converter that quietly mis-reads a
 * document is worse than one that is not offered. CSV is hand-rolled to
 * RFC 4180 below, because it is small enough to be read in one sitting.
 */
import { parse as parseYamlText, stringify as stringifyYaml } from 'yaml';
import { tabulateDocument } from './tabulate';

export type ConvertFormat = 'json' | 'yaml' | 'toml' | 'csv';

export const CONVERT_FORMATS: readonly ConvertFormat[] = ['json', 'yaml', 'toml', 'csv'];

export const FORMAT_LABELS: Record<ConvertFormat, string> = {
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  csv: 'CSV',
};

/** The Prism grammar each format is highlighted with, and its file extension. */
export const FORMAT_GRAMMAR: Record<ConvertFormat, string> = {
  json: 'json',
  yaml: 'yaml',
  toml: 'toml',
  csv: 'csv',
};

export const FORMAT_EXTENSION: Record<ConvertFormat, string> = {
  json: 'json',
  yaml: 'yaml',
  toml: 'toml',
  csv: 'csv',
};

export type ConvertResult =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; message: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Read `text` as `format` into a plain value. Errors come back as a sentence
 * rather than an exception: every caller here has somewhere to show one.
 */
export async function parseAs(
  text: string,
  format: ConvertFormat
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  if (text.trim() === '') return { ok: false, message: 'There is nothing to convert.' };
  try {
    switch (format) {
      case 'json':
        return { ok: true, value: JSON.parse(text) };
      case 'yaml':
        return { ok: true, value: parseYamlText(text) };
      case 'toml': {
        const { parse } = await import('smol-toml');
        return { ok: true, value: parse(text) };
      }
      case 'csv':
        return { ok: true, value: parseCsv(text) };
    }
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * Write `value` out as `format`. Two of the four have shapes they cannot
 * express, and both are refused by name rather than approximated: TOML has no
 * way to spell a document whose root is an array or a scalar, and CSV is a
 * table, so it needs rows to make.
 */
export async function serializeAs(
  value: unknown,
  format: ConvertFormat
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    switch (format) {
      case 'json':
        return { ok: true, text: JSON.stringify(value, null, 2) + '\n' };
      case 'yaml':
        return { ok: true, text: stringifyYaml(value) };
      case 'toml': {
        if (!isPlainObject(value)) {
          return {
            ok: false,
            message:
              'TOML documents are tables, so the top level has to be an object — this one is ' +
              (Array.isArray(value) ? 'an array' : `a ${typeof value}`) +
              '. Wrap it in a key first.',
          };
        }
        const { stringify } = await import('smol-toml');
        return { ok: true, text: stringify(value) };
      }
      case 'csv':
        return toCsvDocument(value);
    }
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** What is lost on the way from `from` to `to`, in the reader's words. */
export function conversionWarnings(from: ConvertFormat, to: ConvertFormat): string[] {
  const notes: string[] = [];
  if (from === 'yaml' || from === 'toml') {
    notes.push('Comments are part of the text, not the data — they do not survive the conversion.');
  }
  if (from === 'yaml') {
    notes.push('Anchors and aliases are expanded: shared structure becomes a copy in each place.');
  }
  if (from === 'toml') {
    notes.push('TOML dates and times become ISO-8601 strings — no other format here has a date type.');
  }
  if (to === 'csv') {
    notes.push('CSV is a table: nested values are flattened into dotted columns, and arrays are kept as JSON text in one cell.');
  }
  if (from === 'csv') {
    notes.push('CSV has no types. A cell becomes a number or a boolean only when the text round-trips exactly, so "007" and "1.0" stay strings.');
  }
  return notes;
}

/** Parse `text` as `from` and write it back out as `to`. */
export async function convertDocument(
  text: string,
  from: ConvertFormat,
  to: ConvertFormat
): Promise<ConvertResult> {
  const parsed = await parseAs(text, from);
  if (!parsed.ok) return { ok: false, message: `Could not read the document as ${FORMAT_LABELS[from]}: ${parsed.message}` };
  const written = await serializeAs(parsed.value, to);
  if (!written.ok) return { ok: false, message: written.message };
  return { ok: true, text: written.text, warnings: conversionWarnings(from, to) };
}

// --- CSV, to RFC 4180 -------------------------------------------------------

/**
 * Split CSV text into rows of raw cells.
 *
 * One pass, character by character, because the shortcuts do not survive
 * contact with real files: a quoted cell may hold commas, newlines and `""`
 * for a literal quote, so neither `split(',')` nor a line-oriented reader is
 * correct. CRLF and CR are normalised to LF on the way in. A trailing newline
 * ends the last row rather than adding an empty one.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false;
  const source = text.replace(/\r\n?/g, '\n');

  const endCell = () => {
    row.push(cell);
    cell = '';
    started = true;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      started = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\n') {
      endRow();
    } else {
      cell += ch;
      started = true;
    }
  }
  // Whatever is still in hand is the last row, unless the file simply ended
  // with a newline.
  if (started || cell !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * A cell as the value it plainly is. The rule is exactness: text becomes a
 * number only when writing that number back gives the same characters, so
 * `007`, `1.0`, `+1` and `1e3`-as-typed keep their spelling and a zip code
 * survives a round trip. `true`/`false` are booleans; an empty cell is an
 * empty string, never null — CSV cannot tell those apart and guessing would
 * invent a distinction the file does not make.
 */
export function csvCellValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '') return '';
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && String(asNumber) === raw) return asNumber;
  return raw;
}

/** CSV text as a list of records, keyed by the header row. */
export function parseCsv(text: string): Record<string, unknown>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h, i) => (h.trim() === '' ? `column${i + 1}` : h.trim()));
  return rows.slice(1).map((cells) => {
    const record: Record<string, unknown> = {};
    header.forEach((key, i) => {
      record[key] = csvCellValue(cells[i] ?? '');
    });
    return record;
  });
}

/** One cell, quoted only when it has to be. */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Rows and columns as CSV text, with the header row first. */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map((key) => csvEscape(cell(row[key]))).join(','));
  return lines.join('\n') + '\n';
}

/**
 * A whole document as CSV, through the same tabulation the page's Data card
 * draws: an array of objects is one row per element with dotted columns; an
 * object is one row per leaf (`path`, `type`, `value`), which is the readable
 * view of a settings file. Anything the tabulator refuses is refused here too,
 * with its sentence.
 */
function toCsvDocument(value: unknown): { ok: true; text: string } | { ok: false; message: string } {
  const table = tabulateDocument(value);
  if ('error' in table) return { ok: false, message: table.error };
  return { ok: true, text: toCsv(table.columns, table.rows) };
}
