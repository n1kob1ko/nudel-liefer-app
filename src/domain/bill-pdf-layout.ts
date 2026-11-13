/**
 * Page layout of the monthly bill as a PDF (NUD-198). Pure: a model of ready-made texts goes in,
 * drawing operations per page come out; `src/server/bill-pdf.ts` paints them. Keeping the layout
 * free of the PDF library makes it testable line by line (wrapping, page breaks, alignment).
 *
 * Units are PDF points (1/72 inch), the origin is the bottom-left corner of the page, `y` of a text
 * is its baseline.
 */

export const PDF_PAGE = { width: 595.28, height: 841.89, margin: 56 } as const;

export type BillPdfModel = {
  /** Who bills: the depot of the settings. */
  sender: { name: string; addressLines: string[] };
  /** Address block of the customer, first line in bold. */
  recipient: string[];
  /** Small lines under the address: customer number, VAT id. */
  meta: string[];
  title: string;
  monthLabel: string;
  columns: { date: string; items: string; amount: string };
  orders: Array<{ date: string; items: string; amount: string }>;
  /** Shown instead of the table body when the month has no orders. */
  emptyText: string;
  /**
   * The foot of the bill, top to bottom: `muted` for the orders' subtotal, `plain` for a correction
   * line, `total` for the sum (bold, separated by a rule).
   */
  foot: Array<{ label: string; amount: string; style: "muted" | "plain" | "total" }>;
  /** Status, the office's note, the hint about orders without an amount. */
  notes: string[];
  footerLeft: string;
  pageLabel: (page: number, pages: number) => string;
};

export type PdfOp =
  | {
      type: "text";
      text: string;
      x: number;
      y: number;
      size: number;
      bold: boolean;
      tone: "ink" | "muted";
    }
  | { type: "line"; x1: number; x2: number; y: number; weight: number; tone: "rule" | "ink" };

/** Width of a text in points for a font size; supplied by the painter, which knows the font. */
export type Measure = (text: string, size: number, bold: boolean) => number;

const LEFT = PDF_PAGE.margin;
const RIGHT = PDF_PAGE.width - PDF_PAGE.margin;
const TOP = PDF_PAGE.height - PDF_PAGE.margin;
/** Lowest baseline of body content; the page footer sits below it. */
const BOTTOM = PDF_PAGE.margin + 28;
const FOOTER_Y = PDF_PAGE.margin - 16;

const BODY = 10;
const SMALL = 8.5;
const LINE = 14;
const DATE_COLUMN = 84;
const AMOUNT_COLUMN = 96;
const ROW_GAP = 7;
const FOOT_WIDTH = 340;

/**
 * Splits a text into lines that fit `maxWidth`. Breaks at spaces; a single word wider than the
 * column (a long product code, a URL in a note) is cut into pieces rather than overflowing.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  let current = "";
  const push = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, size, bold) <= maxWidth) {
      current = candidate;
      continue;
    }
    push();
    let rest = word;
    while (measure(rest, size, bold) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), size, bold) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  push();
  return lines.length > 0 ? lines : [""];
}

/** A one-line text cut to `maxWidth`, ending in "…" when something had to go. */
export function fitText(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
  measure: Measure,
): string {
  if (measure(text, size, bold) <= maxWidth) return text;
  let cut = text.length - 1;
  while (cut > 0 && measure(`${text.slice(0, cut).trimEnd()}…`, size, bold) > maxWidth) cut--;
  return `${text.slice(0, cut).trimEnd()}…`;
}

/**
 * Cuts a text into stretches the main font can write and stretches it cannot (Chinese in a
 * customer or product name), in reading order. The painter writes the second kind with its
 * fallback font. Walks code points, so a character of two code units stays whole.
 */
export function splitFontRuns(
  text: string,
  inMainFont: (codePoint: number) => boolean,
): Array<{ text: string; fallback: boolean }> {
  const runs: Array<{ text: string; fallback: boolean }> = [];
  for (const character of text) {
    const fallback = !inMainFont(character.codePointAt(0)!);
    const last = runs.at(-1);
    if (last && last.fallback === fallback) last.text += character;
    else runs.push({ text: character, fallback });
  }
  return runs;
}

export function layoutBillPdf(model: BillPdfModel, measure: Measure): PdfOp[][] {
  const pages: PdfOp[][] = [];
  let ops: PdfOp[] = [];
  let y = TOP;

  const text = (
    value: string,
    x: number,
    baseline: number,
    options: { size?: number; bold?: boolean; tone?: "ink" | "muted"; align?: "right" } = {},
  ) => {
    const size = options.size ?? BODY;
    const bold = options.bold ?? false;
    ops.push({
      type: "text",
      text: value,
      x: options.align === "right" ? x - measure(value, size, bold) : x,
      y: baseline,
      size,
      bold,
      tone: options.tone ?? "ink",
    });
  };
  const rule = (at: number, x1: number = LEFT, x2: number = RIGHT, tone: "rule" | "ink" = "rule") =>
    ops.push({ type: "line", x1, x2, y: at, weight: tone === "ink" ? 0.9 : 0.5, tone });

  const tableHeader = () => {
    text(model.columns.date, LEFT, y, { size: SMALL, tone: "muted" });
    text(model.columns.items, LEFT + DATE_COLUMN, y, { size: SMALL, tone: "muted" });
    text(model.columns.amount, RIGHT, y, { size: SMALL, tone: "muted", align: "right" });
    y -= 7;
    rule(y);
    y -= LINE + 2;
  };
  const newPage = (withTableHeader: boolean) => {
    pages.push(ops);
    ops = [];
    y = TOP;
    if (withTableHeader) tableHeader();
  };

  // Letterhead: sender on the left, title and month on the right. The sender wraps in the space
  // the title leaves, so a long company name or address never runs into it.
  text(model.title, RIGHT, y - 6, { size: 20, bold: true, align: "right" });
  text(model.monthLabel, RIGHT, y - 26, { size: 12, tone: "muted", align: "right" });
  const titleWidth = Math.max(measure(model.title, 20, true), measure(model.monthLabel, 12, false));
  const senderWidth = Math.max(120, RIGHT - LEFT - titleWidth - 24);
  let senderY = y;
  for (const line of wrapText(model.sender.name, senderWidth, BODY, true, measure)) {
    text(line, LEFT, senderY, { bold: true });
    senderY -= LINE;
  }
  for (const address of model.sender.addressLines) {
    for (const line of wrapText(address, senderWidth, SMALL, false, measure)) {
      text(line, LEFT, senderY, { size: SMALL, tone: "muted" });
      senderY -= 12;
    }
  }
  y = Math.min(senderY, y - 26) - 34;

  // Recipient.
  model.recipient.forEach((entry, index) => {
    for (const line of wrapText(entry, RIGHT - LEFT, 11, index === 0, measure)) {
      text(line, LEFT, y, { size: 11, bold: index === 0 });
      y -= 15;
    }
  });
  y -= 3;
  for (const entry of model.meta) {
    for (const line of wrapText(entry, RIGHT - LEFT, SMALL, false, measure)) {
      text(line, LEFT, y, { size: SMALL, tone: "muted" });
      y -= 12;
    }
  }
  y -= 26;

  // Orders.
  tableHeader();
  const itemsWidth = RIGHT - LEFT - DATE_COLUMN - AMOUNT_COLUMN;
  if (model.orders.length === 0) {
    text(model.emptyText, LEFT, y, { tone: "muted" });
    y -= LINE + ROW_GAP;
  }
  for (const order of model.orders) {
    const lines = wrapText(order.items, itemsWidth, BODY, false, measure);
    const height = lines.length * LINE + ROW_GAP;
    // A row is never split across pages: its amount would lose its products.
    const fits = () => y - height + LINE >= BOTTOM;
    if (!fits()) newPage(true);
    text(order.date, LEFT, y);
    text(order.amount, RIGHT, y, { align: "right" });
    if (fits()) {
      lines.forEach((line, index) => text(line, LEFT + DATE_COLUMN, y - index * LINE));
      y -= height;
      continue;
    }
    // The one exception: a product list longer than a whole page continues on the next one.
    for (const line of lines) {
      if (y < BOTTOM) newPage(true);
      text(line, LEFT + DATE_COLUMN, y);
      y -= LINE;
    }
    y -= ROW_GAP;
  }

  // Foot: subtotal, corrections, total. Kept together so the total never stands alone.
  const footLeft = RIGHT - FOOT_WIDTH;
  const labelWidth = FOOT_WIDTH - AMOUNT_COLUMN;
  const footRows = model.foot.map((row) => {
    const total = row.style === "total";
    const size = total ? 12 : BODY;
    return { row, total, size, lines: wrapText(row.label, labelWidth, size, total, measure) };
  });
  const footHeight = footRows.reduce(
    (sum, entry) => sum + entry.lines.length * (entry.total ? 17 : LINE) + (entry.total ? 18 : 3),
    10,
  );
  if (y - footHeight < BOTTOM) newPage(false);
  // A foot taller than a whole page (dozens of corrections) cannot be kept together: its rows
  // then continue on further pages.
  const splitFoot = y - footHeight < BOTTOM;
  rule(y + 4);
  y -= 14;
  for (const { row, total, size, lines } of footRows) {
    const rowHeight = lines.length * (total ? 17 : LINE) + (total ? 9 : 0) + 3;
    if (splitFoot && y - rowHeight < BOTTOM) newPage(false);
    if (total) {
      rule(y + 9, footLeft, RIGHT, "ink");
      y -= 9;
    }
    const tone = row.style === "muted" ? "muted" : "ink";
    lines.forEach((line, index) =>
      text(line, footLeft, y - index * (total ? 17 : LINE), { size, bold: total, tone }),
    );
    text(row.amount, RIGHT, y, { size, bold: total, tone, align: "right" });
    y -= lines.length * (total ? 17 : LINE) + 3;
  }
  y -= 18;

  // Notes.
  for (const note of model.notes) {
    const lines = wrapText(note, RIGHT - LEFT, 9, false, measure);
    if (y - lines.length * 12 < BOTTOM) newPage(false);
    for (const line of lines) {
      text(line, LEFT, y, { size: 9, tone: "muted" });
      y -= 12;
    }
    y -= 4;
  }
  pages.push(ops);

  // Footer of every page, written last because it needs the page count.
  pages.forEach((page, index) => {
    ops = page;
    rule(FOOTER_Y + 12);
    const label = model.pageLabel(index + 1, pages.length);
    const room = RIGHT - LEFT - measure(label, 8, false) - 16;
    text(fitText(model.footerLeft, room, 8, false, measure), LEFT, FOOTER_Y, {
      size: 8,
      tone: "muted",
    });
    text(label, RIGHT, FOOTER_Y, {
      size: 8,
      tone: "muted",
      align: "right",
    });
  });
  return pages;
}
