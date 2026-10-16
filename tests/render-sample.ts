// Render contoh invoice ke PDF (untuk cek visual): node tests/render-sample.ts <out.pdf> [banyak]
import { readFileSync, writeFileSync } from "node:fs";
import { setFontData, createMeasurer, buildPdf } from "../src/lib/pdf/engine.ts";
import { layoutInvoice } from "../src/lib/invoice/layout.ts";
import { defaultProfile } from "../src/lib/invoice/store.ts";
import type { InvoiceDraft } from "../src/lib/invoice/types.ts";
import type { Weight } from "../src/lib/invoice/doc.ts";

const weights: Weight[] = [300, 400, 600, 700, 800];
setFontData(weights.map((w) => [w, readFileSync(`public/fonts/inter-${w}.ttf`).toString("base64")]));

const many = process.argv[3] === "banyak";
const items = [
  { id: "a", name: "Pembuatan website company profile", description: "5 halaman, responsif, termasuk domain .com dan hosting 1 tahun", qty: "1", price: 3500000 },
  { id: "b", name: "Desain grafis feed Instagram", description: "Paket 12 desain", qty: "2", price: 450000 },
  { id: "c", name: "Pengolahan data penelitian", description: "", qty: "1,5", price: 300000 },
  { id: "d", name: "Revisi minor", description: "", qty: "3", price: 50000 },
];
if (many) {
  for (let i = 0; i < 22; i++) items.push({ id: "x" + i, name: `Layanan tambahan nomor ${i + 1} dengan nama yang cukup panjang supaya terbungkus`, description: i % 3 === 0 ? "Deskripsi panjang ".repeat(14) : "", qty: String(i + 1), price: 125000 * (i + 1) });
}
const draft: InvoiceDraft = {
  version: 1, number: "INV-BRS-20261016-001", issueDate: "2026-10-16", dueDate: "2026-10-23",
  status: "dp", customerName: "Rina Kartika Sari", customerWhatsapp: "081234567890",
  items, discount: 250000, paid: 1000000,
  notes: "Pengerjaan dimulai setelah DP diterima. Revisi mayor maksimal 2 kali. 😀",
};
const profile = { ...defaultProfile(), paymentMethod: "Transfer Bank", bankName: "BCA", accountNumber: "1234567890", accountName: "Contoh Nama", signerName: "Admin Contoh", email: "halo@contoh.id", website: "contoh.id" };
const layout = layoutInvoice(draft, profile, createMeasurer());
console.log("pages", layout.pages.length, "replaced", layout.replacedChars);
writeFileSync(process.argv[2], Buffer.from(buildPdf(layout, { title: draft.number }).output("arraybuffer")));
