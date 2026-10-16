// Perhitungan dan validasi invoice. Tidak menyentuh DOM.

import { normalizeWhatsapp, parseQty } from "../format.ts";
import { LIMITS, type InvoiceDraft, type InvoiceItem, type PaymentStatus } from "./types.ts";

export interface LineTotal {
  id: string;
  qty: number;
  price: number;
  total: number;
}

export interface Totals {
  lines: LineTotal[];
  subtotal: number;
  discount: number;
  /** Total tagihan = subtotal − diskon (tidak pernah negatif). */
  total: number;
  /** Nominal yang sudah dibayar sesuai status. */
  paid: number;
  /** Sisa pembayaran = total − dibayar (tidak pernah negatif). */
  balance: number;
}

/** Baris yang benar-benar kosong diabaikan (tidak masuk invoice). */
export function isBlankItem(item: InvoiceItem): boolean {
  return (
    !item.name.trim() &&
    !item.description.trim() &&
    item.price === null &&
    (item.qty.trim() === "" || item.qty.trim() === "1")
  );
}

export function filledItems(items: InvoiceItem[]): InvoiceItem[] {
  return items.filter((item) => !isBlankItem(item));
}

/** qty × harga, dibulatkan ke rupiah. Qty dibatasi 2 desimal. */
export function lineTotal(qty: number, price: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.round((Math.round(qty * 100) * price) / 100);
}

/** Nominal dibayar menurut status: Belum Dibayar = 0, Lunas = total, DP = input. */
export function paidForStatus(status: PaymentStatus, paidInput: number | null, total: number): number {
  if (status === "unpaid") return 0;
  if (status === "paid") return total;
  return paidInput ?? 0;
}

export function computeTotals(draft: InvoiceDraft): Totals {
  const lines = filledItems(draft.items).map((item) => {
    const qty = parseQty(item.qty);
    const price = item.price ?? 0;
    return { id: item.id, qty, price, total: lineTotal(qty, price) };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
  const discount = draft.discount ?? 0;
  const total = Math.max(0, subtotal - discount);
  const paid = paidForStatus(draft.status, draft.paid, total);
  const balance = Math.max(0, total - paid);
  return { lines, subtotal, discount, total, paid, balance };
}

/** Kunci error: "customerName", "items", "item:<id>:name", "discount", dll. */
export type Errors = Record<string, string>;

export function validate(draft: InvoiceDraft, totals: Totals = computeTotals(draft)): Errors {
  const errors: Errors = {};

  if (!draft.customerName.trim()) errors.customerName = "Nama customer wajib diisi.";

  if (draft.customerWhatsapp.trim()) {
    const wa = normalizeWhatsapp(draft.customerWhatsapp);
    if (!/^62\d{8,13}$/.test(wa)) errors.customerWhatsapp = "Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.";
  }

  const items = filledItems(draft.items);
  if (items.length === 0) errors.items = "Tambahkan minimal satu item layanan.";

  for (const item of items) {
    if (!item.name.trim()) errors[`item:${item.id}:name`] = "Nama layanan wajib diisi.";

    const qty = parseQty(item.qty);
    if (!item.qty.trim()) errors[`item:${item.id}:qty`] = "Wajib diisi.";
    else if (!Number.isFinite(qty)) errors[`item:${item.id}:qty`] = "Harus berupa angka.";
    else if (qty <= 0) errors[`item:${item.id}:qty`] = "Harus lebih dari 0.";
    else if (!/^\d+([.,]\d{1,2})?$/.test(item.qty.trim())) {
      errors[`item:${item.id}:qty`] = "Maksimal 2 angka desimal.";
    } else if (qty > 100_000) errors[`item:${item.id}:qty`] = "Kuantitas terlalu besar.";

    if (item.price === null) errors[`item:${item.id}:price`] = "Harga wajib diisi.";
    else if (item.price < 0) errors[`item:${item.id}:price`] = "Harga tidak boleh negatif.";
    else if (item.price > LIMITS.maxMoney) errors[`item:${item.id}:price`] = "Harga terlalu besar.";
  }

  if (totals.subtotal > LIMITS.maxMoney) errors.items = "Total tagihan terlalu besar.";

  const discount = draft.discount ?? 0;
  if (discount < 0) errors.discount = "Diskon tidak boleh negatif.";
  else if (discount > totals.subtotal) errors.discount = "Diskon tidak boleh melebihi subtotal.";

  if (draft.status === "dp") {
    const paid = draft.paid ?? 0;
    if (paid <= 0) errors.paid = "Isi nominal DP yang sudah dibayarkan.";
    else if (paid > totals.total) errors.paid = "DP tidak boleh melebihi total tagihan.";
    else if (paid === totals.total) {
      errors.paid = "DP sama dengan total tagihan. Pilih status Lunas jika sudah dibayar penuh.";
    }
  }

  if (draft.status === "paid" && totals.total <= 0 && items.length > 0) {
    errors.status = "Status Lunas butuh total tagihan lebih dari Rp0.";
  }

  return errors;
}
