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

  // Letterhead: sender on the left, title and month on the right.
  text(model.sender.name, LEFT, y, { bold: true });
  text(model.title, RIGHT, y - 6, { size: 20, bold: true, align: "right" });
  let senderY = y - LINE;
  for (const line of model.sender.addressLines) {
    text(line, LEFT, senderY, { size: SMALL, tone: "muted" });
    senderY -= 12;
  }
  text(model.monthLabel, RIGHT, y - 26, { size: 12, tone: "muted", align: "right" });
  y = Math.min(senderY, y - 26) - 34;

  // Recipient.
  model.recipient.forEach((line, index) => {
    text(line, LEFT, y, { size: 11, bold: index === 0 });
    y -= 15;
  });
  y -= 3;
  for (const line of model.meta) {
    text(line, LEFT, y, { size: SMALL, tone: "muted" });
    y -= 12;
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
    if (y - height + LINE < BOTTOM) newPage(true);
    text(order.date, LEFT, y);
    text(order.amount, RIGHT, y, { align: "right" });
    lines.forEach((line, index) => text(line, LEFT + DATE_COLUMN, y - index * LINE));
    y -= height;
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
  rule(y + 4);
  y -= 14;
  for (const { row, total, size, lines } of footRows) {
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
    text(model.footerLeft, LEFT, FOOTER_Y, { size: 8, tone: "muted" });
    text(model.pageLabel(index + 1, pages.length), RIGHT, FOOTER_Y, {
      size: 8,
      tone: "muted",
      align: "right",
    });
  });
  return pages;
}
