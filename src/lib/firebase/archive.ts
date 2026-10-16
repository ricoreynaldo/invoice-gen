// Arsip invoice & penomoran global di Firestore.
//   counters/{YYYYMMDD}  { last, updatedAt }   → nomor urut per tanggal
//   invoices/{nomor}     ArchivedInvoice        → arsip, ID = nomor invoice
// Aturan akses ada di firestore.rules (hanya admin).

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  type DocumentSnapshot,
} from "firebase/firestore";
import { dateKey, formatInvoiceNumber } from "../invoice/store.ts";
import { toArchivePayload, type ArchivedInvoice, type HistoryEntry } from "../invoice/archive-model.ts";
import type { BusinessProfile, InvoiceDraft } from "../invoice/types.ts";
import { firebase } from "./client.ts";

/**
 * Ambil nomor invoice berikutnya untuk tanggal penerbitan. Transaksi menjamin
 * dua admin yang membuat invoice bersamaan tidak mendapat nomor yang sama.
 */
export async function allocateInvoiceNumber(issueDate: string): Promise<string> {
  const { db } = firebase();
  const ref = doc(db, "counters", dateKey(issueDate));
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const last = snap.exists() ? Number(snap.data().last) || 0 : 0;
    tx.set(ref, { last: last + 1, updatedAt: serverTimestamp() });
    return last + 1;
  });
  return formatInvoiceNumber(issueDate, next);
}

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);

function toInvoice(snap: DocumentSnapshot): ArchivedInvoice {
  const d = snap.data()!;
  return { ...(d as ArchivedInvoice), createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) };
}

/**
 * Simpan (buat atau perbarui) invoice ke arsip. Revisi naik satu setiap simpan,
 * dan riwayat status/nominal dicatat (maks 50 entri terakhir).
 */
export async function saveInvoice(draft: InvoiceDraft, profile: BusinessProfile, email: string): Promise<number> {
  const { db } = firebase();
  const ref = doc(db, "invoices", draft.number);
  const payload = toArchivePayload(draft, profile);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists() ? snap.data() : null;
    const entry: HistoryEntry = {
      at: new Date().toISOString(),
      by: email,
      status: payload.status,
      total: payload.totals.total,
      paid: payload.totals.paid,
    };
    const revision = (prev ? Number(prev.revision) || 0 : 0) + 1;
    tx.set(ref, {
      ...payload,
      revision,
      history: [...((prev?.history as HistoryEntry[]) ?? []), entry].slice(-50),
      createdAt: prev ? prev.createdAt : serverTimestamp(),
      createdBy: prev ? prev.createdBy : email,
      updatedAt: serverTimestamp(),
      updatedBy: email,
    });
    return revision;
  });
}

export async function getInvoice(number: string): Promise<ArchivedInvoice | null> {
  const { db } = firebase();
  const snap = await getDoc(doc(db, "invoices", number));
  return snap.exists() ? toInvoice(snap) : null;
}

export interface InvoicePage {
  items: ArchivedInvoice[];
  /** Kursor untuk halaman berikutnya; null bila sudah habis. */
  next: DocumentSnapshot | null;
}

/** Arsip terbaru dulu (berdasarkan waktu dibuat), per halaman. */
export async function listInvoices(pageSize = 100, after: DocumentSnapshot | null = null): Promise<InvoicePage> {
  const { db } = firebase();
  const parts = [orderBy("createdAt", "desc"), ...(after ? [startAfter(after)] : []), limit(pageSize)];
  const snap = await getDocs(query(collection(db, "invoices"), ...parts));
  return {
    items: snap.docs.map(toInvoice),
    next: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null,
  };
}

export async function deleteInvoice(number: string): Promise<void> {
  const { db } = firebase();
  await deleteDoc(doc(db, "invoices", number));
}

/**
 * Cek hak akses: baca satu dokumen arsip. Aturan Firestore yang memutuskan,
 * jadi daftar admin cukup ada di satu tempat (firestore.rules + koleksi admins).
 */
export async function hasAdminAccess(): Promise<boolean> {
  const { db } = firebase();
  try {
    await getDocs(query(collection(db, "invoices"), limit(1)));
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "permission-denied") return false;
    throw err;
  }
}
