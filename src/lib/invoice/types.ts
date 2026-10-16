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
  issueDate: string;
  dueDate: string;
  status: PaymentStatus;
  customerName: string;
  customerWhatsapp: string;
  items: InvoiceItem[];
  discount: number | null;
  /** Nominal DP; hanya dipakai saat status "dp". */
  paid: number | null;
  notes: string;
}

/**
 * Data bisnis & tujuan pembayaran milik admin. Dipakai ulang untuk setiap
 * invoice, jadi disimpan terpisah dari draft dan tidak ikut terhapus saat reset.
 */
export interface BusinessProfile {
  version: 1;
  paymentMethod: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  signerName: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
}

export const LIMITS = {
  customerName: 80,
  itemName: 120,
  itemDescription: 500,
  notes: 600,
  maxItems: 60,
  maxMoney: 999_999_999_999,
} as const;
