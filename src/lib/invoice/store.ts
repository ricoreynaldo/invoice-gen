// Draft dan profil bisnis di localStorage (arsip & penomoran ada di Firestore).
// Semua akses dibungkus try/catch: mode privat atau storage penuh tidak boleh
// membuat aplikasi berhenti, hanya draft yang tidak tersimpan.

import { todayIso } from "../format.ts";
import { PAYMENT_METHODS, type BusinessProfile, type InvoiceDraft, type InvoiceItem } from "./types.ts";

const KEY_DRAFT = "beresin-invoice:draft";
const KEY_PROFILE = "beresin-invoice:profile";

/** Kontak resmi Beresin; jadi isi awal info bisnis dan tetap bisa diubah admin. */
const BERESIN_WHATSAPP = "6285920063749";
const BERESIN_EMAIL = "beresincorp@gmail.com";
const BERESIN_WEBSITE = "https://beresin-agent.vercel.app/";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, kv: KV | null = storage()): T | null {
  try {
    const raw = kv?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, kv: KV | null = storage()): boolean {
  try {
    if (!kv) return false;
    kv.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function newItemId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyItem(): InvoiceItem {
  return { id: newItemId(), name: "", description: "", qty: "1", price: null };
}

/** "2026-10-16" -> "20261016" (kunci counter & bagian nomor invoice). */
export function dateKey(iso: string): string {
  return iso.replaceAll("-", "");
}

/** INV-BRS-20261016-001 */
export function formatInvoiceNumber(iso: string, n: number): string {
  return `INV-BRS-${dateKey(iso)}-${String(n).padStart(3, "0")}`;
}

/** Invoice kosong. Nomor diambil dari counter online (lib/firebase/archive.ts). */
export function newDraft(number: string, issueDate: string = todayIso()): InvoiceDraft {
  return {
    version: 1,
    number,
    issueDate,
    status: "unpaid",
    customerName: "",
    customerWhatsapp: "",
    items: [emptyItem()],
    discount: null,
    paid: null,
    notes: "",
  };
}

function isDraft(value: unknown): value is InvoiceDraft {
  const d = value as InvoiceDraft;
  return (
    !!d &&
    d.version === 1 &&
    typeof d.number === "string" &&
    /^INV-BRS-\d{8}-\d{3,}$/.test(d.number) &&
    Array.isArray(d.items) &&
    ["unpaid", "dp", "paid"].includes(d.status)
  );
}

export function loadDraft(): InvoiceDraft | null {
  const raw = readJson<InvoiceDraft & { dueDate?: unknown }>(KEY_DRAFT);
  if (!isDraft(raw)) return null;
  // Draft versi lama masih punya jatuh tempo; buang.
  const { dueDate: _dueDate, ...d } = raw;
  // Tanggal terbit selalu ada; fallback ke tanggal di nomor invoice.
  const fromNumber = d.number.replace(/^INV-BRS-(\d{4})(\d{2})(\d{2})-.*$/, "$1-$2-$3");
  // Lengkapi field yang mungkin hilang dari versi lama.
  return {
    ...d,
    issueDate: /^\d{4}-\d{2}-\d{2}$/.test(d.issueDate ?? "") ? d.issueDate : fromNumber,
    customerName: d.customerName ?? "",
    customerWhatsapp: d.customerWhatsapp ?? "",
    notes: d.notes ?? "",
    discount: d.discount ?? null,
    paid: d.paid ?? null,
    archived: d.archived === true,
    items: d.items.map((it) => ({
      id: it.id || newItemId(),
      name: it.name ?? "",
      description: it.description ?? "",
      qty: it.qty ?? "1",
      price: typeof it.price === "number" ? it.price : null,
    })),
  };
}

export function saveDraft(draft: InvoiceDraft): boolean {
  return writeJson(KEY_DRAFT, draft);
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(KEY_DRAFT);
  } catch {
    /* abaikan */
  }
}

export function defaultProfile(): BusinessProfile {
  return {
    version: 2,
    paymentMethod: "",
    bankName: "",
    accountNumber: "",
    accountName: "",
    signerName: "",
    whatsapp: BERESIN_WHATSAPP,
    email: BERESIN_EMAIL,
    website: BERESIN_WEBSITE,
  };
}

export function loadProfile(): BusinessProfile {
  const p = readJson<Partial<Omit<BusinessProfile, "version">> & { version?: number }>(KEY_PROFILE);
  const base = defaultProfile();
  if (!p || (p.version !== 1 && p.version !== 2)) return base;
  const merged = { ...base };
  for (const key of Object.keys(base) as (keyof BusinessProfile)[]) {
    if (key !== "version" && typeof p[key] === "string") (merged[key] as string) = p[key] as string;
  }
  // Versi 1 belum punya isi awal email & website, jadi yang kosong diisi default.
  // Di versi 2, field yang sengaja dikosongkan admin tetap kosong.
  if (p.version === 1) {
    merged.email ||= base.email;
    merged.website ||= base.website;
    merged.whatsapp ||= base.whatsapp;
    saveProfile(merged);
  }
  // Metode di luar daftar (mis. "QRIS" dari versi lama) dikosongkan.
  if (!(PAYMENT_METHODS as readonly string[]).includes(merged.paymentMethod)) merged.paymentMethod = "";
  return merged;
}

export function saveProfile(profile: BusinessProfile): boolean {
  return writeJson(KEY_PROFILE, profile);
}
