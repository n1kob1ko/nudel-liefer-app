import { readFile } from "node:fs/promises";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, rgb } from "pdf-lib";

import { type BillPdfModel, layoutBillPdf, PDF_PAGE } from "@/domain/bill-pdf-layout";

/**
 * Paints the monthly bill as a PDF (NUD-198). The layout is decided in
 * `src/domain/bill-pdf-layout.ts`; this file only knows the PDF library and the font.
 *
 * Font: DejaVu Sans (`assets/fonts`, free licence next to the files), embedded as a subset. The
 * built-in PDF fonts cannot write č, ć, đ or ř, which customer names in Vienna do contain. DejaVu
 * has no Chinese letters; the export therefore writes the PDF in German or English (see
 * `pdfLocaleFor` in bill-export.ts) and a stray Chinese character prints as an empty box instead
 * of failing the download.
 *
 * The files are read from the project folder at run time (the service runs with
 * `WorkingDirectory=/opt/delivery-app`, the build copies nothing), once per process.
 */

const FONT_DIR = join(process.cwd(), "assets", "fonts");

let fontFiles: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

function loadFontFiles() {
  fontFiles ??= Promise.all([
    readFile(join(FONT_DIR, "DejaVuSans.ttf")),
    readFile(join(FONT_DIR, "DejaVuSans-Bold.ttf")),
  ]).then(([regular, bold]) => ({ regular, bold }));
  // A failed read (file missing after a broken deploy) must not be cached for the process lifetime.
  fontFiles.catch(() => {
    fontFiles = null;
  });
  return fontFiles;
}

const INK = rgb(0.09, 0.12, 0.1);
const MUTED = rgb(0.36, 0.4, 0.38);
const RULE = rgb(0.82, 0.85, 0.83);

export async function renderBillPdf(
  model: BillPdfModel,
  meta: { title: string; author?: string },
): Promise<Uint8Array> {
  const files = await loadFontFiles();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(meta.title);
  if (meta.author) pdf.setAuthor(meta.author);
  pdf.setCreator("Nudel Liefer App");
  const regular = await pdf.embedFont(files.regular, { subset: true });
  const bold = await pdf.embedFont(files.bold, { subset: true });
  const font = (isBold: boolean): PDFFont => (isBold ? bold : regular);

  const pages = layoutBillPdf(model, (text, size, isBold) =>
    font(isBold).widthOfTextAtSize(text, size),
  );
  for (const ops of pages) {
    const page = pdf.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    for (const op of ops) {
      if (op.type === "text") {
        page.drawText(op.text, {
          x: op.x,
          y: op.y,
          size: op.size,
          font: font(op.bold),
          color: op.tone === "muted" ? MUTED : INK,
        });
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
