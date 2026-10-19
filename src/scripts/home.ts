// Beranda: sapaan, kartu draft yang belum selesai (dari localStorage), dan
// beberapa invoice terakhir dari arsip.

import { listInvoices } from "../lib/firebase/archive.ts";
import { filledItems } from "../lib/invoice/calc.ts";
import { toArchivePayload } from "../lib/invoice/archive-model.ts";
import { loadDraft, loadProfile } from "../lib/invoice/store.ts";
import { formatRupiah } from "../lib/format.ts";
import { requireAdmin } from "./session.ts";
import { esc, statusBadge } from "./ui.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const RECENT = 5;
const SHORT_DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 11 ? "pagi" : h < 15 ? "siang" : h < 18 ? "sore" : "malam";
  $("#greeting").textContent = name ? `Selamat ${part}, ${name}` : `Selamat ${part}`;
}

function renderDraft() {
  const d = loadDraft();
  const items = d ? filledItems(d.items).length : 0;
  // Draft kosong tidak perlu ditawarkan; "Buat invoice baru" akan memakainya.
  if (!d || (!d.customerName.trim() && items === 0 && !d.notes.trim())) return;
  const card = $("#draft-card");
  // Sama dengan isDirty() di app.ts: tersimpan bila isi form = isi arsip terakhir.
  const saved = !!d.archived && d.savedSnapshot === JSON.stringify(toArchivePayload(d, loadProfile()));
  card.querySelector("[data-draft-label]")!.textContent = saved ? "Terakhir dibuka" : "Draft belum selesai";
  card.querySelector("[data-draft-title]")!.textContent = d.customerName.trim() || "Tanpa nama customer";
  card.querySelector("[data-draft-number]")!.textContent = d.number;
  card.querySelector("[data-draft-status]")!.textContent = `${items} item · ${saved ? "tersimpan di arsip" : d.archived ? "ada perubahan belum disimpan" : "belum disimpan"}`;
  card.hidden = false;
}

async function renderRecent() {
  const state = $("#recent-state");
  try {
    const { items } = await listInvoices(RECENT);
    if (items.length === 0) {
      state.textContent = "Belum ada invoice. Invoice yang kamu simpan akan muncul di sini.";
      return;
    }
    state.hidden = true;
    $("#recent-all").hidden = false;
    $("#recent-list").innerHTML = items
      .map(
        (inv) => `<li>
          <a href="/buat?edit=${encodeURIComponent(inv.number)}" class="flex items-start gap-3 px-4 py-3 hover:bg-ink-50 sm:items-center sm:px-5 lg:items-start">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-ink-900">${esc(inv.customerName)}</span>
              <span class="block truncate text-xs text-ink-500 tabular-nums">${esc(inv.number)}<span class="hidden sm:inline lg:hidden xl:inline"> · ${SHORT_DATE.format(new Date(`${inv.issueDate}T00:00:00`))}</span></span>
            </span>
            <span class="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3 lg:flex-col lg:items-end lg:gap-1">
              <span class="text-sm font-semibold text-ink-900 tabular-nums">${formatRupiah(inv.totals.total)}</span>
              ${statusBadge(inv.status)}
            </span>
          </a>
        </li>`,
      )
      .join("");
  } catch (err) {
    console.error(err);
    state.textContent = "Arsip gagal dimuat. Periksa koneksi lalu muat ulang halaman.";
  }
}

renderDraft();
requireAdmin().then((user) => {
  greeting((user.displayName ?? "").trim().split(/\s+/)[0] ?? "");
  renderRecent();
});
