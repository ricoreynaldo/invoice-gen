// Halaman Arsip: daftar invoice dari Firestore, cari & filter, unduh ulang
// PDF (memakai snapshot data saat disimpan), edit, dan hapus.

import type { DocumentSnapshot } from "firebase/firestore";
import { deleteInvoice, listInvoices } from "../lib/firebase/archive.ts";
import { fromArchive, type ArchivedInvoice } from "../lib/invoice/archive-model.ts";
import { layoutInvoice } from "../lib/invoice/layout.ts";
import type { PaymentStatus } from "../lib/invoice/types.ts";
import type { Measurer } from "../lib/invoice/doc.ts";
import { formatLongDate, formatRupiah } from "../lib/format.ts";
import { buildPdf, createMeasurer, loadFonts } from "../lib/pdf/engine.ts";
import { requireAdmin } from "./session.ts";
import { confirmDialog, esc, showToast, statusBadge } from "./ui.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const stateEl = $("#list-state");
const table = $("#table");
const rowsEl = $("#rows");
const cardsEl = $("#cards");
const moreWrap = $("#more-wrap");
const moreBtn = $<HTMLButtonElement>("#load-more");
const searchInput = $<HTMLInputElement>("#search");

let invoices: ArchivedInvoice[] = [];
let cursor: DocumentSnapshot | null = null;
let filter: "all" | PaymentStatus = "all";
let search = "";
let measurer: Measurer | null = null;

const UPDATED_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function updatedText(inv: ArchivedInvoice) {
  const when = inv.updatedAt ? UPDATED_FMT.format(inv.updatedAt) : "—";
  const who = inv.updatedBy ? inv.updatedBy.split("@")[0] : "";
  return { when, who, rev: inv.revision > 1 ? `rev. ${inv.revision}` : "" };
}

function actions(inv: ArchivedInvoice) {
  const n = esc(inv.number);
  return `<div class="flex items-center justify-end gap-1">
    <button type="button" class="btn btn-ghost h-8 rounded-lg px-2.5 text-[13px]" data-action="pdf" data-number="${n}" aria-label="Unduh PDF ${n}">PDF</button>
    <a class="btn btn-ghost h-8 rounded-lg px-2.5 text-[13px]" href="/buat?edit=${encodeURIComponent(inv.number)}" aria-label="Edit ${n}">Edit</a>
    <button type="button" class="btn btn-ghost h-8 rounded-lg px-2.5 text-[13px] text-accent-600 hover:bg-accent-50 hover:text-accent-700" data-action="delete" data-number="${n}" aria-label="Hapus ${n}">Hapus</button>
  </div>`;
}

function visibleInvoices() {
  const q = search.trim().toLowerCase();
  return invoices.filter(
    (inv) =>
      (filter === "all" || inv.status === filter) &&
      (!q || inv.customerNameLower.includes(q) || inv.number.toLowerCase().includes(q)),
  );
}

function render() {
  const list = visibleInvoices();

  const sum = list.reduce(
    (acc, inv) => ({
      total: acc.total + inv.totals.total,
      paid: acc.paid + inv.totals.paid,
      balance: acc.balance + inv.totals.balance,
    }),
    { total: 0, paid: 0, balance: 0 },
  );
  $("[data-sum=count]").textContent = String(list.length);
  $("[data-sum=total]").textContent = formatRupiah(sum.total);
  $("[data-sum=paid]").textContent = formatRupiah(sum.paid);
  $("[data-sum=balance]").textContent = formatRupiah(sum.balance);

  if (invoices.length === 0) {
    stateEl.hidden = false;
    stateEl.innerHTML =
      'Belum ada invoice di arsip.<br/><a class="font-semibold text-ink-900 underline underline-offset-2" href="/buat?new=1">Buat invoice</a> lalu tekan Simpan untuk memasukkannya ke arsip.';
  } else if (list.length === 0) {
    stateEl.hidden = false;
    stateEl.textContent = "Tidak ada invoice yang cocok dengan pencarian atau filter.";
  } else {
    stateEl.hidden = true;
  }
  table.hidden = list.length === 0;

  rowsEl.innerHTML = list
    .map((inv) => {
      const u = updatedText(inv);
      return `<tr class="align-middle hover:bg-ink-50">
        <td class="px-4 py-3"><p class="font-semibold text-ink-900 tabular-nums">${esc(inv.number)}</p><p class="text-xs text-ink-500">${formatLongDate(inv.issueDate)}</p></td>
        <td class="max-w-56 px-4 py-3"><p class="truncate text-ink-900">${esc(inv.customerName)}</p><p class="text-xs text-ink-500">${inv.items.length} item</p></td>
        <td class="px-4 py-3">${statusBadge(inv.status)}</td>
        <td class="px-4 py-3 text-right font-semibold text-ink-900 tabular-nums">${formatRupiah(inv.totals.total)}</td>
        <td class="px-4 py-3 text-right tabular-nums ${inv.totals.balance > 0 ? "text-ink-900" : "text-ink-400"}">${formatRupiah(inv.totals.balance)}</td>
        <td class="px-4 py-3 text-xs text-ink-500"><p class="whitespace-nowrap">${u.when}</p><p>${esc(u.who)}${u.rev ? ` · ${u.rev}` : ""}</p></td>
        <td class="px-3 py-3">${actions(inv)}</td>
      </tr>`;
    })
    .join("");

  cardsEl.innerHTML = list
    .map((inv) => {
      const u = updatedText(inv);
      return `<li class="p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-semibold text-ink-900">${esc(inv.customerName)}</p>
            <p class="text-xs text-ink-500 tabular-nums">${esc(inv.number)} · ${formatLongDate(inv.issueDate)}</p>
          </div>
          ${statusBadge(inv.status)}
        </div>
        <div class="mt-3 flex items-end justify-between gap-3 text-sm tabular-nums">
          <div><p class="text-xs text-ink-500">Total</p><p class="font-semibold text-ink-900">${formatRupiah(inv.totals.total)}</p></div>
          <div class="text-right"><p class="text-xs text-ink-500">Sisa</p><p class="${inv.totals.balance > 0 ? "text-ink-900" : "text-ink-400"}">${formatRupiah(inv.totals.balance)}</p></div>
        </div>
        <div class="mt-3 flex items-center justify-between gap-2 border-t border-ink-100 pt-2">
          <p class="truncate text-xs text-ink-400">${u.when}${u.rev ? ` · ${u.rev}` : ""}</p>
          ${actions(inv)}
        </div>
      </li>`;
    })
    .join("");

  moreWrap.hidden = !cursor;
}

async function loadPage(reset = false) {
  moreBtn.disabled = true;
  try {
    const page = await listInvoices(100, reset ? null : cursor);
    invoices = reset ? page.items : [...invoices, ...page.items];
    cursor = page.next;
    render();
  } catch (err) {
    console.error(err);
    if (invoices.length === 0) {
      stateEl.hidden = false;
      stateEl.innerHTML =
        'Arsip gagal dimuat. Periksa koneksi. <button type="button" class="font-semibold text-ink-900 underline underline-offset-2" id="retry">Coba lagi</button>';
      document.getElementById("retry")?.addEventListener("click", () => loadPage(true));
    } else {
      showToast("Gagal memuat data berikutnya. Coba lagi.", { error: true });
    }
  } finally {
    moreBtn.disabled = false;
  }
}

async function downloadPdf(inv: ArchivedInvoice, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    if (!measurer) {
      await loadFonts();
      measurer = createMeasurer();
    }
    // Pakai data & tujuan pembayaran yang tersimpan, jadi isinya sama dengan PDF yang dikirim.
    const { draft, profile } = fromArchive(inv);
    const pdf = buildPdf(layoutInvoice(draft, profile, measurer), { title: `Invoice ${inv.number}` });
    await pdf.save(`Invoice-Beresin-${inv.number}.pdf`, { returnPromise: true });
  } catch (err) {
    console.error(err);
    showToast("PDF gagal dibuat. Coba lagi.", { error: true });
  } finally {
    button.disabled = false;
  }
}

async function remove(inv: ArchivedInvoice) {
  const ok = await confirmDialog({
    title: `Hapus ${inv.number}?`,
    body: `Invoice ${inv.customerName} dihapus permanen dari arsip dan tidak bisa dikembalikan. Nomor ini tidak akan dipakai ulang.`,
    confirm: "Hapus invoice",
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteInvoice(inv.number);
    invoices = invoices.filter((x) => x.number !== inv.number);
    render();
    showToast(`${inv.number} dihapus dari arsip.`);
  } catch (err) {
    console.error(err);
    showToast("Gagal menghapus. Periksa koneksi lalu coba lagi.", { error: true });
  }
}

document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!btn) return;
  const inv = invoices.find((x) => x.number === btn.dataset.number);
  if (!inv) return;
  if (btn.dataset.action === "pdf") downloadPdf(inv, btn);
  if (btn.dataset.action === "delete") remove(inv);
});

searchInput.addEventListener("input", () => {
  search = searchInput.value;
  render();
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name === "filter") {
    filter = t.value as typeof filter;
    render();
  }
});

moreBtn.addEventListener("click", () => loadPage());

requireAdmin().then(() => loadPage(true));
