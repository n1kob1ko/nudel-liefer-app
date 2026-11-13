# Fonts for generated PDF files

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` (DejaVu Fonts 2.37, <https://dejavu-fonts.github.io/>)
are embedded into the monthly bill PDF (`src/server/bill-pdf.ts`, NUD-198). They are **not** web
fonts and are never sent to a browser on their own; only the letters a bill uses end up in its PDF.

Licence: Bitstream Vera Fonts licence with the DejaVu changes in the public domain, see
[`LICENSE-DejaVu.txt`](./LICENSE-DejaVu.txt). The fonts may be used, copied and distributed with
this software; they must not be sold on their own.

`NotoSansSC-Subset.ttf` is Noto Sans SC (<https://github.com/google/fonts/tree/main/ofl/notosanssc>),
embedded only when a bill holds Chinese text that DejaVu cannot write (a customer, a product or a
note in Chinese). It is a modified version of the original font: fixed to the regular weight and
cut down to the 6,763 characters of GB 2312 plus Chinese punctuation and full-width forms, about
2 MB instead of 17 MB. Rare or traditional characters outside that set print as an empty box.

Licence: SIL Open Font License 1.1, see [`LICENSE-NotoSansSC.txt`](./LICENSE-NotoSansSC.txt).

How the file was made (fontTools 4.x), in case it has to be rebuilt:

1. `fontTools.varLib.instancer.instantiateVariableFont(font, {"wght": 400})`
2. `fontTools.subset` with the GB 2312 characters from U+2E80 up, U+3000 to U+303F and U+FF00 to
   U+FFEF, without layout tables and hinting.
3. `font["glyf"].padding = 4` before saving. This matters: the PDF library drops every letter
   that starts at an odd position in the file (`bill-pdf.test.ts` checks it).
