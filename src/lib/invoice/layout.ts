// Tata letak invoice A4 mengikuti referensi desain: header wordmark + INVOICE,
// panel abu-abu penerima/status, tabel bergaris tipis, ringkasan total di
// kanan dengan kotak "total due" berarsir di kiri, blok info pembayaran /
// catatan / tanda tangan, lalu kontak di kaki halaman.
// Semua ukuran dalam mm, ukuran huruf dalam pt.

import { displayWhatsapp, formatDotDate, formatLongDate, formatQty, formatRupiah, parseQty } from "../format.ts";
import { computeTotals, filledItems } from "./calc.ts";
import { QR_QUIET_MODULES, qrMatrix, qrRects, qrText } from "./qr.ts";
import { PAGE_H, PAGE_W, PT, type LaidOutDocument, type Measurer, type Op, type Weight } from "./doc.ts";
import { STATUS_LABEL, type BusinessProfile, type InvoiceDraft } from "./types.ts";

const C = {
  ink: "#141414",
  text: "#2b2b2b",
  muted: "#666666",
  soft: "#8f8f8f",
  line: "#e2e2e2",
  strong: "#3c3c3c",
  panel: "#f1f1f2",
  hatch: "#e2e2e2",
  dot: "#3a3a3a",
};

const X0 = 17.5;
const X1 = PAGE_W - 17.5;
const CW = X1 - X0;

/** Batas bawah konten di setiap halaman (di atas kaki halaman). */
const CONTENT_BOTTOM = PAGE_H - 24;
/** Batas bawah konten di halaman terakhir bila ada blok "Ada pertanyaan?". */
const LAST_PAGE_BOTTOM = PAGE_H - 46;
/** Y awal konten di halaman lanjutan. */
const CONT_TOP = 30;

/** Kolom tabel, relatif terhadap X0. */
const COL = {
  no: 4.5,
  desc: 15.5,
  descWidth: 74,
  priceRight: 112.5,
  qtyCenter: 135,
  totalRight: CW - 4.5,
};

/** Sisi pola QR (tanpa quiet zone) dalam mm; versi 3 → ±0,7 mm per modul. */
const QR_SIZE = 20;

const capH = (size: number) => size * PT * 0.727;

type Align = "left" | "right" | "center";

/** Karakter tak terlihat yang aman dibuang (variation selector, ZWJ, skin tone). */
const INVISIBLE = /[​-‍︎️]|\uD83C[\uDFFB-\uDFFF]/g;

class Builder {
  pages: Op[][] = [];
  page: Op[] = [];
  replaced = false;
  private m: Measurer;

  constructor(m: Measurer) {
    this.m = m;
    this.addPage();
  }

  addPage() {
    this.page = [];
    this.pages.push(this.page);
  }

  /** Ganti karakter yang tidak ada di font PDF supaya tidak tampil kosong. */
  clean(input: string): string {
    const s = input.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(INVISIBLE, "");
    let out = "";
    for (const ch of s) {
      if (ch === "\n" || this.m.supports(ch)) {
        out += ch;
        continue;
      }
      this.replaced = true;
      // Emoji tidak punya bentuk di font PDF; dibuang daripada jadi "?".
      if (/\p{Extended_Pictographic}/u.test(ch)) continue;
      const base = ch.normalize("NFD")[0];
      out += base && base !== ch && this.m.supports(base) ? base : "?";
    }
    return out;
  }

  width(s: string, size: number, weight: Weight, ls = 0) {
    return this.m.width(s, size, weight, ls);
  }

  text(
    s: string,
    x: number,
    y: number,
    size: number,
    weight: Weight,
    color: string,
    opts: { align?: Align; ls?: number } = {},
  ): number {
    const str = this.clean(s);
    if (!str) return 0;
    const ls = opts.ls ?? 0;
    const w = this.m.width(str, size, weight, ls);
    // Spasi huruf ikut terhitung setelah huruf terakhir; buang supaya rata kanan presisi.
    const visual = w - (ls ? ls : 0);
    let left = x;
    if (opts.align === "right") left = x - visual;
    else if (opts.align === "center") left = x - visual / 2;
    this.page.push({ t: "text", x: left, y, s: str, size, weight, color, ls: ls || undefined });
    return visual;
  }

  /** Pecah teks; batasi jumlah baris dan beri elipsis bila terpotong. */
  wrap(s: string, size: number, weight: Weight, maxWidth: number, maxLines = Infinity): string[] {
    const str = this.clean(s).replace(/\n{3,}/g, "\n\n").trim();
    if (!str) return [];
    const lines = this.m.wrap(str, size, weight, maxWidth).map((l) => l.replace(/\s+$/, ""));
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && this.m.width(last + "…", size, weight) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last.replace(/\s+$/, "") + "…";
    return kept;
  }

  /** Satu baris, dipotong dengan elipsis bila lebih lebar dari maxWidth. */
  fit(s: string, size: number, weight: Weight, maxWidth: number, ls = 0): string {
    let str = this.clean(s).replace(/\s*\n\s*/g, " ");
    if (this.m.width(str, size, weight, ls) <= maxWidth) return str;
    while (str && this.m.width(str + "…", size, weight, ls) > maxWidth) str = str.slice(0, -1);
    return str.replace(/\s+$/, "") + "…";
  }

  /** Teks yang sudah bersih (hasil wrap/fit) digambar tanpa dibersihkan ulang. */
  raw(s: string, x: number, y: number, size: number, weight: Weight, color: string, align: Align = "left", ls = 0) {
    const w = this.m.width(s, size, weight, ls) - ls;
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.page.push({ t: "text", x: left, y, s, size, weight, color, ls: ls || undefined });
    return w;
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.page.push({ t: "rect", x, y, w, h, fill });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
    this.page.push({ t: "line", x1, y1, x2, y2, color, width });
  }

  circle(cx: number, cy: number, r: number, fill: string) {
    this.page.push({ t: "circle", cx, cy, r, fill });
  }

  /** Arsir diagonal "/" di dalam kotak, dipotong tepat di tepi kotak. */
  hatch(x: number, y: number, w: number, h: number, gap: number, color: string) {
    for (let c = x + y + gap; c < x + w + y + h; c += gap) {
      const xa = Math.max(x, c - (y + h));
      const xb = Math.min(x + w, c - y);
      if (xb - xa > 0.05) this.line(xa, c - xa, xb, c - xb, color, 0.18);
    }
  }
}

interface Row {
  no: string;
  nameLines: string[];
  descLines: string[];
  price: string;
  qty: string;
  total: string;
  height: number;
}

const ROW = {
  nameSize: 6.6,
  descSize: 6.2,
  lineGap: 3.5,
  pad: 3.4,
  minHeight: 10.5,
};

export function layoutInvoice(draft: InvoiceDraft, profile: BusinessProfile, m: Measurer): LaidOutDocument {
  const b = new Builder(m);
  const totals = computeTotals(draft);
  const lineById = new Map(totals.lines.map((l) => [l.id, l]));
  const items = filledItems(draft.items);

  // ---------- Header halaman 1 ----------
  b.text("BERESIN", X0, 22.2, 17, 800, C.ink, { ls: 0.05 });
  b.text("BUTUH SESUATU? BIAR KITA BERESIN.", X0 + 0.2, 26.4, 4.6, 600, C.soft, { ls: 0.32 });

  const titleW = b.text("INVOICE", X1, 24.4, 30, 800, C.ink, { align: "right", ls: 0.15 });
  b.text(`TANGGAL. ${formatDotDate(draft.issueDate)}`, X1 - titleW + 0.5, 29.6, 6.2, 700, C.text, { ls: 0.12 });

  // ---------- Panel penerima & status ----------
  const panelTop = 38;
  const padX = 8;
  const leftX = X0 + padX;
  const rightX = X0 + 104;
  const labelY = panelTop + 10.5;
  const firstY = panelTop + 18.6;
  const step = 3.7;

  const label = (s: string, x: number, y: number) => b.text(s, x, y, 6.4, 700, C.ink, { ls: 0.14 });

  label("DITAGIHKAN KEPADA", leftX, labelY);
  const nameLines = b.wrap(draft.customerName.toUpperCase() || "—", 6.6, 700, 88, 3);
  nameLines.forEach((l, i) => b.raw(l, leftX, firstY + i * step, 6.6, 700, C.ink));
  let leftBottom = firstY + (nameLines.length - 1) * step;
  const customerWa = displayWhatsapp(draft.customerWhatsapp);
  if (customerWa) {
    leftBottom += 7.4;
    b.text(`WhatsApp ${customerWa}`, leftX, leftBottom, 6.4, 400, C.muted);
  }

  label("STATUS PEMBAYARAN", rightX, labelY);
  const statusText =
    draft.status === "dp" ? "DP (DIBAYAR SEBAGIAN)" : STATUS_LABEL[draft.status].toUpperCase();
  b.text(statusText, rightX, firstY, 6.6, 700, C.ink, { ls: 0.05 });
  const statusLines: string[] = [];
  if (draft.status === "unpaid") statusLines.push(`Total tagihan ${formatRupiah(totals.total)}`);
  if (draft.status === "dp") {
    statusLines.push(`DP diterima ${formatRupiah(totals.paid)}`);
    statusLines.push(`Sisa ${formatRupiah(totals.balance)}`);
  }
  if (draft.status === "paid") statusLines.push(`Dibayar penuh ${formatRupiah(totals.paid)}`);
  if (profile.paymentMethod.trim()) statusLines.push(`Metode: ${profile.paymentMethod.trim()}`);
  let rightBottom = firstY;
  statusLines.forEach((s, i) => {
    const y = firstY + 7.4 + i * step;
    b.raw(b.fit(s, 6.4, 400, CW - 104 - padX), rightX, y, 6.4, 400, C.muted);
    rightBottom = y;
  });

  const panelBottom = Math.max(panelTop + 46, Math.max(leftBottom, rightBottom) + 10);
  // Panel digambar di awal daftar supaya berada di bawah teks.
  b.page.unshift({ t: "rect", x: X0, y: panelTop, w: CW, h: panelBottom - panelTop, fill: C.panel });

  // ---------- Baris jatuh tempo + nomor invoice ----------
  const metaY = panelBottom + 14.5;
  b.text(`JATUH TEMPO: ${formatLongDate(draft.dueDate).toUpperCase()}`, X0, metaY, 6.2, 400, C.muted, { ls: 0.1 });
  b.text(`NO. INVOICE: ${draft.number}`, X1, metaY, 6.4, 700, C.ink, { align: "right", ls: 0.1 });

  // ---------- Tabel item ----------
  const rows: Row[] = items.map((item, i) => {
    const line = lineById.get(item.id);
    const nameLines = b.wrap(item.name || "—", ROW.nameSize, 600, COL.descWidth, 3);
    const descLines = b.wrap(item.description, ROW.descSize, 400, COL.descWidth, 12);
    const n = nameLines.length + descLines.length;
    const qty = parseQty(item.qty);
    return {
      no: `${i + 1}.`,
      nameLines,
      descLines,
      price: formatRupiah(item.price ?? 0),
      qty: Number.isFinite(qty) ? formatQty(qty) : "—",
      total: formatRupiah(line?.total ?? 0),
      height: Math.max(ROW.minHeight, ROW.pad * 2 + capH(ROW.nameSize) + (n - 1) * ROW.lineGap),
    };
  });

  const tableHeader = (top: number) => {
    b.line(X0, top, X1, top, C.strong, 0.35);
    const y = top + 6.3;
    const h = (s: string, x: number, align: Align = "left") =>
      b.text(s, x, y, 6.2, 700, C.ink, { align, ls: 0.14 });
    h("NO", X0 + COL.no);
    h("DESKRIPSI LAYANAN", X0 + COL.desc);
    h("HARGA", X0 + COL.priceRight, "right");
    h("QTY", X0 + COL.qtyCenter, "center");
    h("TOTAL", X0 + COL.totalRight, "right");
    return top + 10.5;
  };

  const continuationHeader = () => {
    b.addPage();
    b.text("BERESIN", X0, 20.2, 12, 800, C.ink, { ls: 0.04 });
    b.text(`INVOICE  ·  ${draft.number}`, X1, 19.6, 6.4, 700, C.ink, { align: "right", ls: 0.12 });
    return CONT_TOP;
  };

  let y = tableHeader(metaY + 5.5);

  if (rows.length === 0) {
    b.text("Belum ada item layanan.", X0 + COL.desc, y + 6.4, ROW.nameSize, 400, C.soft);
    y += ROW.minHeight;
  }

  rows.forEach((row, i) => {
    if (y + row.height > CONTENT_BOTTOM) {
      y = tableHeader(continuationHeader());
    }
    const n = row.nameLines.length + row.descLines.length;
    const blockH = (n - 1) * ROW.lineGap;
    const baseY = y + (row.height - blockH) / 2 + capH(ROW.nameSize) / 2;

    b.raw(row.no, X0 + COL.no, baseY, ROW.nameSize, 400, C.text);
    row.nameLines.forEach((l, k) => b.raw(l, X0 + COL.desc, baseY + k * ROW.lineGap, ROW.nameSize, 600, C.ink));
    row.descLines.forEach((l, k) =>
      b.raw(l, X0 + COL.desc, baseY + (row.nameLines.length + k) * ROW.lineGap, ROW.descSize, 400, C.muted),
    );
    b.raw(row.price, X0 + COL.priceRight, baseY, ROW.nameSize, 400, C.text, "right");
    b.raw(row.qty, X0 + COL.qtyCenter, baseY, ROW.nameSize, 400, C.text, "center");
    b.raw(row.total, X0 + COL.totalRight, baseY, ROW.nameSize, 400, C.text, "right");

    y += row.height;
    const isLast = i === rows.length - 1;
    const nextBreaks = !isLast && y + rows[i + 1].height > CONTENT_BOTTOM;
    if (!isLast && !nextBreaks) b.line(X0, y, X1, y, C.line, 0.2);
    if (nextBreaks) b.line(X0, y, X1, y, C.strong, 0.35);
  });
  b.line(X0, y, X1, y, C.strong, 0.35);

  // ---------- Ringkasan total ----------
  const summaryRows: [string, string][] = [
    ["SUBTOTAL:", formatRupiah(totals.subtotal)],
    ["DISKON:", totals.discount > 0 ? `-${formatRupiah(totals.discount)}` : formatRupiah(0)],
    ["TOTAL TAGIHAN:", formatRupiah(totals.total)],
    ["DIBAYAR:", formatRupiah(totals.paid)],
    ["SISA PEMBAYARAN:", formatRupiah(totals.balance)],
  ];
  const sumStep = 6.9;

  const dueLabel =
    draft.status === "paid" ? "TOTAL DIBAYAR" : draft.status === "dp" ? "SISA PEMBAYARAN" : "TOTAL TAGIHAN";
  const dueAmount = draft.status === "paid" ? totals.total : totals.balance;
  const dueText = formatRupiah(dueAmount);
  const dueSize = 20;
  const boxW = Math.max(50, b.width(dueText, dueSize, 300) + 10);
  const boxH = 17.5;
  const caption =
    draft.status === "paid"
      ? "Lunas. Terima kasih atas pembayarannya."
      : draft.status === "dp"
        ? `Dari total ${formatRupiah(totals.total)}, DP ${formatRupiah(totals.paid)} sudah diterima.`
        : `Mohon dibayar sebelum ${formatLongDate(draft.dueDate)}.`;

  const summaryHeight = Math.max(4.4 + (summaryRows.length - 1) * sumStep + 2, sumStep + 3.6 + boxH + 6.5);
  if (y + 4 + summaryHeight > CONTENT_BOTTOM) y = continuationHeader();

  const sumTop = y + 4.4;
  summaryRows.forEach(([k, v], i) => {
    const ry = sumTop + i * sumStep + capH(6.4) / 2;
    const strong = i === summaryRows.length - 1;
    b.text(k, X0 + 127.5, ry, 6.2, 700, strong ? C.ink : C.text, { align: "right", ls: 0.12 });
    b.text(v, X0 + COL.totalRight, ry, 6.4, 700, strong ? C.ink : C.text, { align: "right" });
  });

  const dueLabelY = sumTop + sumStep + capH(6.4) / 2;
  b.text(dueLabel, X0, dueLabelY, 6.6, 700, C.ink, { ls: 0.14 });
  const boxTop = dueLabelY + 3.6;
  b.hatch(X0, boxTop, boxW, boxH, 1.15, C.hatch);
  b.text(dueText, X0 + 4.6, boxTop + boxH / 2 + capH(dueSize) / 2, dueSize, 300, C.ink);
  const captionLines = b.wrap(caption, 5.8, 400, 95, 2);
  captionLines.forEach((l, i) => b.raw(l, X0, boxTop + boxH + 4.6 + i * 3.1, 5.8, 400, C.muted));

  y = Math.max(
    sumTop + (summaryRows.length - 1) * sumStep + 2,
    boxTop + boxH + 4.6 + (captionLines.length - 1) * 3.1,
  );

  // ---------- Info pembayaran / catatan / tanda tangan ----------
  const payLines = [
    profile.paymentMethod.trim() && `Metode: ${profile.paymentMethod.trim()}`,
    profile.bankName.trim() && `Bank: ${profile.bankName.trim()}`,
    profile.accountNumber.trim() && `No. Rek: ${profile.accountNumber.trim()}`,
    profile.accountName.trim() && `A/N: ${profile.accountName.trim()}`,
  ].filter(Boolean) as string[];
  const payWrapped = (payLines.length ? payLines : ["—"]).flatMap((l) => b.wrap(l, 6.4, 400, 44, 2));
  const noteLines = b.wrap(draft.notes, 6.4, 400, 66, 14);
  const infoLineGap = 3.9;
  const textHeight = Math.max(
    7.6 + (payWrapped.length - 1) * infoLineGap,
    noteLines.length ? 7.6 + (noteLines.length - 1) * infoLineGap : 0,
  );

  // Blok pengesahan: QR identitas invoice + nama penanda tangan + keterangan.
  const qrMatrixData = qrMatrix(qrText(draft));
  const qrModule = QR_SIZE / qrMatrixData.length;
  const qrBox = QR_SIZE + 2 * QR_QUIET_MODULES * qrModule;
  const signCaption = b.wrap("Invoice diterbitkan secara elektronik oleh Beresin", 5.2, 400, 44, 2);
  const signHeight = 0.2 + qrBox + 3.2 + 3.1 + (signCaption.length - 1) * 2.5;
  const infoHeight = Math.max(textHeight, signHeight);

  const wa = displayWhatsapp(profile.whatsapp);
  const email = profile.email.trim();
  const hasQuestions = !!(wa || email);
  const lastBottom = hasQuestions ? LAST_PAGE_BOTTOM : CONTENT_BOTTOM;

  let infoTop = y + 13;
  if (infoTop + infoHeight > lastBottom) infoTop = continuationHeader() + 4;

  b.text("Info Pembayaran:", X0, infoTop, 7, 600, C.ink);
  payWrapped.forEach((l, i) => b.raw(l, X0, infoTop + 7.6 + i * infoLineGap, 6.4, 400, C.text));

  if (noteLines.length) {
    const noteX = X0 + 54.5;
    b.line(X0 + 48, infoTop - 2.8, X0 + 48, infoTop + Math.max(textHeight, 19) + 0.6, C.line, 0.25);
    b.text("Catatan", noteX, infoTop, 7, 600, C.ink);
    noteLines.forEach((l, i) => b.raw(l, noteX, infoTop + 7.6 + i * infoLineGap, 6.4, 400, C.text));
  }

  const signCx = X0 + 152;
  b.text("HORMAT KAMI,", signCx, infoTop - 2.6, 6.2, 700, C.ink, { align: "center", ls: 0.14 });
  const boxX = signCx - qrBox / 2;
  const boxY = infoTop + 0.2;
  const quiet = QR_QUIET_MODULES * qrModule;
  // Latar putih + quiet zone 4 modul supaya mudah dipindai.
  b.rect(boxX, boxY, qrBox, qrBox, "#ffffff");
  b.page.push({ t: "shape", rects: qrRects(qrMatrixData, boxX + quiet, boxY + quiet, QR_SIZE), fill: "#000000" });
  const nameY = boxY + qrBox + 3.2;
  const signer = b.fit((profile.signerName.trim() || "Admin Beresin").toUpperCase(), 7.2, 700, 46, 0.1);
  b.raw(signer, signCx, nameY, 7.2, 700, C.soft, "center", 0.1);
  signCaption.forEach((l, i) => b.raw(l, signCx, nameY + 3.1 + i * 2.5, 5.2, 400, C.muted, "center"));

  // ---------- Blok "Ada pertanyaan?" (halaman terakhir) ----------
  if (hasQuestions) {
    const qy = PAGE_H - 33.5;
    b.text("Ada pertanyaan?", X0 + 0.5, qy, 7, 600, C.ink);
    const lines = wa
      ? [`Hubungi kami via WhatsApp ${wa}`, ...(email ? [`atau email ke ${email}`] : [])]
      : [`Email kami di ${email}`];
    lines.forEach((l, i) => b.raw(b.fit(l, 6.4, 400, 120), X0 + 0.5, qy + 4.9 + i * 3.6, 6.4, 400, C.text));
  }

  // ---------- Kaki halaman (semua halaman) ----------
  const total = b.pages.length;
  const footY = PAGE_H - 13.2;
  const contacts = [wa, email].filter(Boolean);
  const leftText =
    [profile.address.trim(), profile.website.trim()].filter(Boolean).join(" • ") ||
    "Beresin — Butuh sesuatu? Biar kita Beresin.";

  b.pages.forEach((page, idx) => {
    b.page = page;

    let cx = X1;
    for (let i = contacts.length - 1; i >= 0; i--) {
      const w = b.raw(b.clean(contacts[i]), cx, footY, 5.8, 400, C.soft, "right");
      cx -= w + 2.2;
      b.circle(cx - 1.15, footY - capH(5.8) / 2, 1.15, C.dot);
      cx -= 2.3 + 5.5;
    }

    b.line(0, footY - capH(5.8) / 2, X0 - 3, footY - capH(5.8) / 2, C.line, 0.25);
    const suffix = total > 1 ? `  •  Halaman ${idx + 1}/${total}` : "";
    const maxLeft = cx - X0 - 4;
    b.raw(b.fit(leftText, 5.8, 400, maxLeft - b.width(suffix, 5.8, 400)) + suffix, X0, footY, 5.8, 400, C.soft);
  });

  return { pages: b.pages, replacedChars: b.replaced };
}
