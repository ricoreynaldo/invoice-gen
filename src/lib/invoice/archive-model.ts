// Bentuk dokumen arsip invoice di Firestore (koleksi invoices/{nomor}).
// Murni (tanpa SDK Firebase) supaya bisa dipakai di tes dan di browser.

import { computeTotals, filledItems, type Totals } from "./calc.ts";
import { newItemId } from "./store.ts";
import type { BusinessProfile, InvoiceDraft, PaymentStatus } from "./types.ts";

export type ProfileSnapshot = Omit<BusinessProfile, "version">;

export interface HistoryEntry {
  /** ISO time; serverTimestamp tidak boleh dipakai di dalam array. */
  at: string;
  by: string;
  status: PaymentStatus;
  total: number;
  paid: number;
}

/** Field yang ditulis klien (tanpa timestamp & metadata revisi). */
export interface ArchivePayload {
  number: string;
  issueDate: string;
  status: PaymentStatus;
  customerName: string;
  customerNameLower: string;
  customerWhatsapp: string;
  items: { name: string; description: string; qty: string; price: number }[];
  discount: number | null;
  paid: number | null;
  notes: string;
  /** Tujuan pembayaran & kontak saat invoice disimpan; PDF unduh ulang memakai ini. */
  profile: ProfileSnapshot;
  totals: Omit<Totals, "lines">;
}

/** Dokumen lengkap seperti yang dibaca dari Firestore (timestamp sudah jadi Date). */
export interface ArchivedInvoice extends ArchivePayload {
  revision: number;
  history: HistoryEntry[];
  createdAt: Date | null;
  updatedAt: Date | null;
  createdBy: string;
  updatedBy: string;
}

export function toArchivePayload(draft: InvoiceDraft, profile: BusinessProfile): ArchivePayload {
  const totals = computeTotals(draft);
  const { version: _v, ...snapshot } = profile;
  return {
    number: draft.number,
    issueDate: draft.issueDate,
    status: draft.status,
    customerName: draft.customerName.trim(),
    customerNameLower: draft.customerName.trim().toLowerCase(),
    customerWhatsapp: draft.customerWhatsapp.trim(),
    items: filledItems(draft.items).map((it) => ({
      name: it.name.trim(),
      description: it.description.trim(),
      qty: it.qty.trim(),
      price: it.price ?? 0,
    })),
    discount: draft.discount,
    // Nominal dibayar disimpan sesuai status supaya arsip konsisten dengan PDF.
    paid: draft.status === "dp" ? draft.paid : null,
    notes: draft.notes.trim(),
    profile: snapshot,
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
      paid: totals.paid,
      balance: totals.balance,
    },
  };
}

/** Ubah dokumen arsip kembali menjadi draft + profil untuk diedit atau dicetak ulang. */
export function fromArchive(inv: ArchivePayload): { draft: InvoiceDraft; profile: BusinessProfile } {
  return {
    draft: {
      version: 1,
      number: inv.number,
      issueDate: inv.issueDate,
      status: inv.status,
      customerName: inv.customerName,
      customerWhatsapp: inv.customerWhatsapp,
      items: inv.items.map((it) => ({ id: newItemId(), ...it })),
      discount: inv.discount,
      paid: inv.paid,
      notes: inv.notes,
      archived: true,
    },
    profile: { version: 2, ...inv.profile },
  };
}
