// Format angka, tanggal, dan nomor telepon. Murni (tanpa DOM) supaya bisa
// dipakai form, layout PDF, dan unit test.

const NUMBER_FMT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** Rp1.250.000 (tanpa spasi). Nilai negatif ditulis -Rp50.000. */
export function formatRupiah(value: number): string {
  const n = Math.round(value);
  return (n < 0 ? "-" : "") + "Rp" + NUMBER_FMT.format(Math.abs(n));
}

/** 1250000 -> "1.250.000"; null -> "". Untuk isi input nominal. */
export function formatMoneyInput(value: number | null): string {
  return value === null ? "" : NUMBER_FMT.format(value);
}

/** Ambil digit saja: "Rp 1.250.000" -> 1250000; kosong -> null. */
export function parseMoney(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits.slice(0, 15));
}

/**
 * Kuantitas boleh desimal (mis. 1,5 jam). Koma dan titik sama-sama dianggap
 * pemisah desimal. Kembalikan NaN bila bukan angka valid.
 */
export function parseQty(raw: string): number {
  const s = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

export function formatQty(qty: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(qty);
}

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-10-16" -> { y, m, d }; null bila format salah. */
function splitIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

/** "2026-10-16" -> "16 Oktober 2026". */
export function formatLongDate(iso: string): string {
  const p = splitIsoDate(iso);
  if (!p) return "—";
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "2026-10-16" -> "16.10.2026". */
export function formatDotDate(iso: string): string {
  const p = splitIsoDate(iso);
  if (!p) return "—";
  return `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}`;
}

/** Tanggal lokal hari ini dalam format input date (YYYY-MM-DD). */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Normalisasi nomor WhatsApp Indonesia ke 62xxxxxxxxx, supaya "0812...",
 * "+62812..." dan "0812-3456" dianggap nomor yang sama.
 */
export function normalizeWhatsapp(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

/** 6281234567890 -> "+62 812-3456-7890". */
export function displayWhatsapp(input: string): string {
  const n = normalizeWhatsapp(input);
  if (!n) return "";
  if (!n.startsWith("62")) return "+" + n;
  const rest = n.slice(2);
  const groups = [rest.slice(0, 3), rest.slice(3, 7), rest.slice(7)].filter(Boolean);
  return "+62 " + groups.join("-");
}
