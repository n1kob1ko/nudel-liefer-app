import { readFile } from "node:fs/promises";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, rgb } from "pdf-lib";

import {
  type BillPdfModel,
  layoutBillPdf,
  PDF_PAGE,
  splitFontRuns,
} from "@/domain/bill-pdf-layout";

/**
 * Paints the monthly bill as a PDF (NUD-198). The layout is decided in
 * `src/domain/bill-pdf-layout.ts`; this file only knows the PDF library and the fonts.
 *
 * Fonts (`assets/fonts`, free licences next to the files), embedded as subsets:
 * - DejaVu Sans for everything it can write. The built-in PDF fonts cannot write č, ć, đ or ř,
 *   which customer names in Vienna do contain.
 * - Noto Sans SC for the Chinese letters DejaVu lacks (a customer, a product or a note in
 *   Chinese). It is read and embedded only when a bill needs it, and has one weight: bold Chinese
 *   text prints regular. A letter neither font has prints as an empty box instead of failing the
 *   download.
 *
 * The labels of the bill stay German or English (see `pdfLocaleFor` in bill-export.ts).
 *
 * The files are read from the project folder at run time (the service runs with
 * `WorkingDirectory=/opt/delivery-app`, the build copies nothing), once per process.
 */

const FONT_DIR = join(process.cwd(), "assets", "fonts");

/** Reads a font file once per process. A failed read (file missing after a broken deploy) is not kept. */
function fontFile(name: string): () => Promise<Uint8Array> {
  let file: Promise<Uint8Array> | null = null;
  return () => {
    file ??= readFile(join(FONT_DIR, name));
    file.catch(() => {
      file = null;
    });
    return file;
  };
}
const regularFile = fontFile("DejaVuSans.ttf");
const boldFile = fontFile("DejaVuSans-Bold.ttf");
const chineseFile = fontFile("NotoSansSC-Subset.ttf");

const INK = rgb(0.09, 0.12, 0.1);
const MUTED = rgb(0.36, 0.4, 0.38);
const RULE = rgb(0.82, 0.85, 0.83);

export async function renderBillPdf(
  model: BillPdfModel,
  meta: { title: string; author?: string },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(meta.title);
  if (meta.author) pdf.setAuthor(meta.author);
  pdf.setCreator("Nudel Liefer App");
  const regular = await pdf.embedFont(await regularFile(), { subset: true });
  const bold = await pdf.embedFont(await boldFile(), { subset: true });
  const mainFont = (isBold: boolean): PDFFont => (isBold ? bold : regular);

  // Regular and bold DejaVu cover the same letters, so one set decides for both.
  const mainLetters = new Set(regular.getCharacterSet());
  let chinese: PDFFont | null = null;
  let chineseLetters = new Set<number>();
  let needsChinese = false;
  /** The font for each stretch of a text: the main font unless only the Chinese one has the letters. */
  const runs = (text: string, isBold: boolean) =>
    splitFontRuns(text, (codePoint) => {
      if (mainLetters.has(codePoint)) return true;
      needsChinese = true;
      return !chineseLetters.has(codePoint);
    }).map((run) => ({ text: run.text, font: run.fallback ? chinese! : mainFont(isBold) }));
  const measure = (text: string, size: number, isBold: boolean) =>
    runs(text, isBold).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);

  let pages = layoutBillPdf(model, measure);
  if (needsChinese) {
    // Measured without the Chinese font so far: embed it and lay the bill out again.
    chinese = await pdf.embedFont(await chineseFile(), { subset: true });
    chineseLetters = new Set(chinese.getCharacterSet());
    pages = layoutBillPdf(model, measure);
  }

  for (const ops of pages) {
    const page = pdf.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    for (const op of ops) {
      if (op.type === "text") {
        let x = op.x;
        for (const run of runs(op.text, op.bold)) {
          page.drawText(run.text, {
            x,
            y: op.y,
            size: op.size,
            font: run.font,
            color: op.tone === "muted" ? MUTED : INK,
          });
          x += run.font.widthOfTextAtSize(run.text, op.size);
        }
      } else {
        page.drawLine({
          start: { x: op.x1, y: op.y },
          end: { x: op.x2, y: op.y },
          thickness: op.weight,
          color: op.tone === "ink" ? INK : RULE,
        });
      }
    }
  }
  return pdf.save();
}
