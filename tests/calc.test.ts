import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotals, validate, lineTotal } from "../src/lib/invoice/calc.ts";
import { formatRupiah, parseMoney, parseQty, displayWhatsapp } from "../src/lib/format.ts";
import { allocateInvoiceNumber } from "../src/lib/invoice/store.ts";
import type { InvoiceDraft } from "../src/lib/invoice/types.ts";

function draft(over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    version: 1, number: "INV-BRS-20261016-001", issueDate: "2026-10-16",
    status: "unpaid", customerName: "Budi", customerWhatsapp: "",
    items: [
      { id: "a", name: "Website", description: "", qty: "2", price: 1_500_000 },
      { id: "b", name: "Logo", description: "", qty: "1,5", price: 300_000 },
    ],
    discount: null, paid: null, notes: "", ...over,
  };
}

test("format rupiah tanpa spasi", () => {
  assert.equal(formatRupiah(1250000), "Rp1.250.000");
  assert.equal(formatRupiah(0), "Rp0");
  assert.equal(parseMoney("Rp 1.250.000"), 1250000);
  assert.equal(parseMoney(""), null);
  assert.equal(parseQty("1,5"), 1.5);
  assert.ok(Number.isNaN(parseQty("1,5,2")));
  assert.equal(displayWhatsapp("081234567890"), "+62 812-3456-7890");
});

test("subtotal, diskon, total, sisa", () => {
  const t = computeTotals(draft({ discount: 200_000, status: "dp", paid: 1_000_000 }));
  assert.equal(lineTotal(1.5, 300_000), 450_000);
  assert.equal(t.subtotal, 3_450_000);
  assert.equal(t.total, 3_250_000);
  assert.equal(t.paid, 1_000_000);
  assert.equal(t.balance, 2_250_000);
});

test("status menentukan nominal dibayar", () => {
  assert.equal(computeTotals(draft({ status: "unpaid", paid: 999 })).paid, 0);
  const lunas = computeTotals(draft({ status: "paid", paid: 5 }));
  assert.equal(lunas.paid, lunas.total);
  assert.equal(lunas.balance, 0);
});

test("baris kosong diabaikan, minimal satu item", () => {
  const d = draft({ items: [{ id: "x", name: "", description: "", qty: "1", price: null }] });
  assert.equal(computeTotals(d).lines.length, 0);
  assert.ok(validate(d).items);
});

test("validasi field", () => {
  assert.deepEqual(validate(draft()), {});
  assert.ok(validate(draft({ customerName: "  " })).customerName);
  assert.ok(validate(draft({ discount: 9_999_999 })).discount);
  assert.ok(validate(draft({ status: "dp", paid: null })).paid);
  assert.ok(validate(draft({ status: "dp", paid: 99_000_000 })).paid);
  assert.ok(validate(draft({ status: "dp", paid: 3_450_000 })).paid, "DP = total harus pakai Lunas");
  assert.deepEqual(validate(draft({ status: "dp", paid: 100_000 })), {});
  assert.ok(validate(draft({ customerWhatsapp: "123" })).customerWhatsapp);
  const bad = validate(draft({ items: [{ id: "q", name: "A", description: "", qty: "0", price: 10 }] }));
  assert.ok(bad["item:q:qty"]);
  const dec = validate(draft({ items: [{ id: "q", name: "A", description: "", qty: "1,555", price: 10 }] }));
  assert.ok(dec["item:q:qty"]);
  const noPrice = validate(draft({ items: [{ id: "q", name: "A", description: "", qty: "1", price: null }] }));
  assert.ok(noPrice["item:q:price"]);
  const zeroLunas = validate(draft({ status: "paid", items: [{ id: "q", name: "A", description: "", qty: "1", price: 0 }] }));
  assert.ok(zeroLunas.status);
});

test("nomor invoice berurutan per tanggal dan tidak dipakai ulang", () => {
  const mem = new Map<string, string>();
  const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.equal(allocateInvoiceNumber("2026-10-16", kv), "INV-BRS-20261016-001");
  assert.equal(allocateInvoiceNumber("2026-10-16", kv), "INV-BRS-20261016-002");
  assert.equal(allocateInvoiceNumber("2026-10-17", kv), "INV-BRS-20261017-001");
  assert.equal(allocateInvoiceNumber("2026-10-16", kv), "INV-BRS-20261016-003");
});
