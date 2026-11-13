# Fonts for generated PDF files

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` (DejaVu Fonts 2.37, <https://dejavu-fonts.github.io/>)
are embedded into the monthly bill PDF (`src/server/bill-pdf.ts`, NUD-198). They are **not** web
fonts and are never sent to a browser on their own; only the letters a bill uses end up in its PDF.

Licence: Bitstream Vera Fonts licence with the DejaVu changes in the public domain, see
[`LICENSE-DejaVu.txt`](./LICENSE-DejaVu.txt). The fonts may be used, copied and distributed with
this software; they must not be sold on their own.
