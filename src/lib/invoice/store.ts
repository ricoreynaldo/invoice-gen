// Draft, profil bisnis, dan penomoran invoice di localStorage.
// Semua akses dibungkus try/catch: mode privat atau storage penuh tidak boleh
// membuat aplikasi berhenti, hanya draft yang tidak tersimpan.

import { todayIso } from "../format.ts";
import type { BusinessProfile, InvoiceDraft, InvoiceItem } from "./types.ts";

const KEY_DRAFT = "beresin-invoice:draft";
const KEY_PROFILE = "beresin-invoice:profile";
const KEY_COUNTER = "beresin-invoice:counter";

/** Nomor WhatsApp admin dari situs Beresin (src/lib/whatsapp-config.ts). */
const BERESIN_WHATSAPP = "6285920063749";

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

/**
 * Ambil nomor berikutnya untuk tanggal hari ini: INV-BRS-YYYYMMDD-001.
 * Counter per tanggal disimpan dan langsung dinaikkan, jadi nomor yang sudah
 * dibagikan tidak dipakai ulang walau invoice-nya di-reset.
 */
export function allocateInvoiceNumber(dateIso: string = todayIso(), kv: KV | null = storage()): string {
  const key = dateIso.replaceAll("-", "");
  const counter = readJson<Record<string, number>>(KEY_COUNTER, kv) ?? {};
  const next = (counter[key] ?? 0) + 1;

  // Cukup simpan beberapa tanggal terakhir.
  const kept = Object.keys(counter).sort().slice(-30);
  const trimmed: Record<string, number> = {};
  for (const k of kept) trimmed[k] = counter[k];
  trimmed[key] = next;
  writeJson(KEY_COUNTER, trimmed, kv);

  return `INV-BRS-${key}-${String(next).padStart(3, "0")}`;
}

export function newDraft(kv: KV | null = storage()): InvoiceDraft {
  const today = todayIso();
  return {
    version: 1,
    number: allocateInvoiceNumber(today, kv),
    issueDate: today,
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
    version: 1,
    paymentMethod: "",
    bankName: "",
    accountNumber: "",
    accountName: "",
    signerName: "",
    whatsapp: BERESIN_WHATSAPP,
    email: "",
    website: "",
    address: "",
  };
}

export function loadProfile(): BusinessProfile {
  const p = readJson<Partial<BusinessProfile>>(KEY_PROFILE);
  const base = defaultProfile();
  if (!p || p.version !== 1) return base;
  const merged = { ...base };
  for (const key of Object.keys(base) as (keyof BusinessProfile)[]) {
    if (key !== "version" && typeof p[key] === "string") (merged[key] as string) = p[key] as string;
  }
  return merged;
}

export function saveProfile(profile: BusinessProfile): boolean {
  return writeJson(KEY_PROFILE, profile);
}
