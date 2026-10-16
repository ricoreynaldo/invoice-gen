// QR di invoice harus terbaca dan isinya sama dengan nomor & tanggal yang tercetak.
// Op "shape" dari layout (yang juga digambar ke PDF) dirasterisasi lalu dibaca jsQR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import jsQR from "jsqr";
import { createMeasurer, setFontData } from "../src/lib/pdf/engine.ts";
import { layoutInvoice } from "../src/lib/invoice/layout.ts";
import { defaultProfile } from "../src/lib/invoice/store.ts";
import { qrText } from "../src/lib/invoice/qr.ts";
import type { InvoiceDraft } from "../src/lib/invoice/types.ts";
import type { Op, ShapeOp, Weight } from "../src/lib/invoice/doc.ts";

const weights: Weight[] = [300, 400, 600, 700, 800];
setFontData(weights.map((w) => [w, readFileSync(`public/fonts/inter-${w}.ttf`).toString("base64")]));
const measurer = createMeasurer();

function draft(over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    version: 1, number: "INV-BRS-20261016-001", issueDate: "2026-10-16", dueDate: "2026-10-23",
    status: "unpaid", customerName: "Budi", customerWhatsapp: "",
    items: [{ id: "a", name: "Website", description: "", qty: "1", price: 1_000_000 }],
    discount: null, paid: null, notes: "", ...over,
  };
}

/** Rasterisasi op QR (8 px/mm) dengan quiet zone putih, lalu decode. */
function scan(pages: Op[][]): string | null {
  const shape = pages.flat().find((op): op is ShapeOp => op.t === "shape");
  assert.ok(shape, "QR tidak ada di dokumen");
  const pxPerMm = 8;
  const xs = shape.rects.map((r) => r[0]);
  const ys = shape.rects.map((r) => r[1]);
  const x0 = Math.min(...xs) - 4;
  const y0 = Math.min(...ys) - 4;
  const size = Math.ceil((Math.max(...shape.rects.map((r) => r[0] + r[2])) - x0 + 4) * pxPerMm);
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const [x, y, w, h] of shape.rects) {
    for (let py = Math.round((y - y0) * pxPerMm); py < Math.round((y + h - y0) * pxPerMm); py++) {
      for (let px = Math.round((x - x0) * pxPerMm); px < Math.round((x + w - x0) * pxPerMm); px++) {
        const i = (py * size + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return jsQR(data, size, size)?.data ?? null;
}

test("isi QR tiga baris: brand, nomor, tanggal Indonesia", () => {
  assert.equal(qrText(draft()), "BERESIN\nINV-BRS-20261016-001\n16 Oktober 2026");
});

test("QR di layout terbaca dan sama dengan data invoice", () => {
  const layout = layoutInvoice(draft(), defaultProfile(), measurer);
  assert.equal(scan(layout.pages), "BERESIN\nINV-BRS-20261016-001\n16 Oktober 2026");
});

test("QR ikut berubah saat nomor atau tanggal penerbitan berubah", () => {
  const layout = layoutInvoice(draft({ number: "INV-BRS-20261231-042", issueDate: "2026-12-31" }), defaultProfile(), measurer);
  const decoded = scan(layout.pages);
  assert.equal(decoded, "BERESIN\nINV-BRS-20261231-042\n31 Desember 2026");
  const printed = layout.pages.flat().filter((op) => op.t === "text").map((op) => (op as { s: string }).s);
  assert.ok(printed.includes("NO. INVOICE: INV-BRS-20261231-042"));
  assert.ok(printed.includes("TANGGAL. 31.12.2026"));
});
