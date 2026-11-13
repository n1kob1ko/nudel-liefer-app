/**
 * The monthly bill as a file for the accounting (NUD-198). Pure: rows in, CSV text out. The rows
 * are the same lines the month page shows (one per order, one per correction); the server builds
 * them, this module only decides how they are written.
 */

import type { MonthlyState } from "./payment";

export type BillExportRow = {
  /** `YYYY-MM` of the billed month. */
  monthKey: string;
  customerNumber: string;
  customerName: string;
  /** `YYYY-MM-DD` delivery day of an order; a correction belongs to the month, not to a day. */
  date: string | null;
  kind: "order" | "adjustment";
  /** Products of the order ("2 Kiste Nudeln, ...") or the text of the correction. */
  description: string;
  /** Euro cents; `null` for an order the office gave no amount. Corrections carry their sign. */
  amountCents: number | null;
  state: MonthlyState;
  /** `YYYY-MM-DD` the month was marked paid, when it is. */
  paidOn: string | null;
  /**
   * What was paid for the whole month (the snapshot of the paid note), repeated on every line of
   * that month. It can differ from the sum of the lines when an order was changed afterwards.
   */
  paidCents: number | null;
};

export type ExportLabels = {
  columns: Record<
    | "month"
    | "customerNumber"
    | "customer"
    | "date"
    | "kind"
    | "description"
    | "amount"
    | "status"
    | "paidOn"
    | "paidAmount",
    string
  >;
  order: string;
  adjustment: string;
  open: string;
  paid: string;
  current: string;
};

/**
 * How numbers and dates are written. A CSV file carries no format of its own, the spreadsheet
 * guesses from the computer's language: a German Excel wants `;` between cells and `42,50`, an
 * English one `,` and `42.50`. So the file follows the language of whoever downloads it.
 */
export type CsvStyle = { delimiter: ";" | ","; decimal: "," | "."; date: "dmy" | "iso" };

export function csvStyleFor(locale: string): CsvStyle {
  return locale === "de"
    ? { delimiter: ";", decimal: ",", date: "dmy" }
    : { delimiter: ",", decimal: ".", date: "iso" };
}

/** Whole cents to a plain decimal number: no currency sign, no thousands separator, no rounding. */
function csvAmount(cents: number | null, style: CsvStyle): string {
  if (cents === null) return "";
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const rest = String(absolute % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${euros}${style.decimal}${rest}`;
}

function csvDate(iso: string | null, style: CsvStyle): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  return style.date === "dmy" ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

/**
 * A text cell. Two protections: a leading `=`, `+`, `-`, `@`, tab or carriage return would make a
 * spreadsheet run the cell as a formula (customer names and correction texts are typed by people),
 * so such a cell gets an apostrophe in front; and a cell holding the delimiter, a quote or a line
 * break is quoted, quotes doubled.
 */
function csvText(value: string, style: CsvStyle): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(style.delimiter) || /["\r\n]/.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

/**
 * The CSV file: a header line and one line per row. UTF-8 with a byte order mark (Excel reads
 * umlauts and Chinese product names correctly only with it) and CRLF line ends.
 */
export function buildBillCsv(
  rows: readonly BillExportRow[],
  labels: ExportLabels,
  style: CsvStyle,
): string {
  const text = (value: string) => csvText(value, style);
  const header = [
    labels.columns.month,
    labels.columns.customerNumber,
    labels.columns.customer,
    labels.columns.date,
    labels.columns.kind,
    labels.columns.description,
    labels.columns.amount,
    labels.columns.status,
    labels.columns.paidOn,
    labels.columns.paidAmount,
  ].map(text);
  const body = rows.map((row) => [
    text(row.monthKey),
    text(row.customerNumber),
    text(row.customerName),
    csvDate(row.date, style),
    text(row.kind === "order" ? labels.order : labels.adjustment),
    text(row.description),
    csvAmount(row.amountCents, style),
    text(labels[row.state]),
    csvDate(row.paidOn, style),
    csvAmount(row.paidCents, style),
  ]);
  return `\uFEFF${[header, ...body].map((cells) => `${cells.join(style.delimiter)}\r\n`).join("")}`;
}

/**
 * File name of a download. Only letters, digits, `-` and `_` of the customer number survive: the
 * name goes into a `Content-Disposition` header and onto somebody's disk.
 */
export function exportFileName(input: {
  customerNumber?: string;
  monthKey: string;
  extension: "pdf" | "csv";
}): string {
  if (input.customerNumber === undefined) {
    return `monatsrechnungen-${input.monthKey}.${input.extension}`;
  }
  const number =
    input.customerNumber
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") || "kunde";
  return `monatsrechnung-${number}-${input.monthKey}.${input.extension}`;
}

/** Address of a download (`GET /api/admin/payments/export`); without a customer: all customers. */
export function billExportHref(input: {
  /** `YYYY-MM` */
  month: string;
  customerId?: string;
  format: "pdf" | "csv";
  locale: string;
}): string {
  const query = new URLSearchParams({
    month: input.month,
    format: input.format,
    locale: input.locale,
  });
  if (input.customerId) query.set("customer", input.customerId);
  return `/api/admin/payments/export?${query}`;
}
