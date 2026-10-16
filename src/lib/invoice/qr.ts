// QR code identitas invoice. Isinya teks biasa tiga baris (bukan URL):
//   BERESIN
//   <nomor invoice>
//   <tanggal penerbitan, format Indonesia>
// Ini identitas informatif, bukan tanda tangan digital.

import QRCode from "qrcode";
import { formatLongDate } from "../format.ts";
import type { InvoiceDraft } from "./types.ts";

export const QR_QUIET_MODULES = 4;

export function qrText(draft: Pick<InvoiceDraft, "number" | "issueDate">): string {
  return ["BERESIN", draft.number, formatLongDate(draft.issueDate)].join("\n");
}

/** Matriks modul QR (true = hitam). Error correction M: tahan noda/cetak buram ringan. */
export function qrMatrix(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => !!modules.get(r, c)));
}

/**
 * Ubah matriks menjadi kotak-kotak (modul hitam berurutan dalam satu baris
 * digabung) yang mengisi persegi `size` mm, tanpa quiet zone.
 */
export function qrRects(matrix: boolean[][], x: number, y: number, size: number): [number, number, number, number][] {
  const n = matrix.length;
  const m = size / n;
  const rects: [number, number, number, number][] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < n) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && row[c]) c++;
      rects.push([x + start * m, y + r * m, (c - start) * m, m]);
    }
  });
  return rects;
}
