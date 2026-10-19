export type PaymentStatus = "unpaid" | "dp" | "paid";

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Belum Dibayar",
  dp: "DP",
  paid: "Lunas",
};

export interface InvoiceItem {
  id: string;
  name: string;
  description: string;
  /** Teks mentah dari input supaya "1," yang sedang diketik tidak hilang. */
  qty: string;
  price: number | null;
}

/** Data satu invoice. Disimpan sebagai draft di localStorage. */
export interface InvoiceDraft {
  version: 1;
  number: string;
  /** Tanggal penerbitan, diisi otomatis saat invoice dibuat dan tidak diedit. */
  issueDate: string;
  status: PaymentStatus;
  customerName: string;
  customerWhatsapp: string;
  items: InvoiceItem[];
  discount: number | null;
  /** Nominal DP; hanya dipakai saat status "dp". */
  paid: number | null;
  notes: string;
  /** true bila invoice ini sudah ada di arsip online (perubahan disimpan saat unduh ulang). */
  archived?: boolean;
  /** Isi arsip saat terakhir disimpan (JSON payload), untuk tahu ada perubahan yang belum disimpan. */
  savedSnapshot?: string;
}

/**
 * Data bisnis & tujuan pembayaran milik admin. Dipakai ulang untuk setiap
 * invoice, jadi disimpan terpisah dari draft dan tidak ikut terhapus saat reset.
 */
export interface BusinessProfile {
  version: 2;
  paymentMethod: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  signerName: string;
  whatsapp: string;
  email: string;
  website: string;
}

/** Pilihan metode pembayaran di form. */
export const PAYMENT_METHODS = ["Transfer Bank", "E-Wallet", "Tunai"] as const;

export const LIMITS = {
  customerName: 80,
  itemName: 120,
  itemDescription: 500,
  notes: 600,
  maxItems: 60,
  maxMoney: 999_999_999_999,
} as const;
