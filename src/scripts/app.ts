// Controller halaman Invoice Generator: menghubungkan form, state draft,
// preview SVG, ekspor PDF, dan arsip online. Logika hitung ada di
// lib/invoice/calc.ts, tata letak dokumen di lib/invoice/layout.ts,
// arsip & penomoran di lib/firebase/archive.ts.

import { computeTotals, filledItems, validate, type Errors, type Totals } from "../lib/invoice/calc.ts";
import type { Measurer } from "../lib/invoice/doc.ts";
import { layoutInvoice } from "../lib/invoice/layout.ts";
import {
  clearDraft,
  emptyItem,
  loadDraft,
  loadProfile,
  newDraft,
  saveDraft,
  saveProfile,
} from "../lib/invoice/store.ts";
import { LIMITS, type BusinessProfile, type InvoiceDraft, type InvoiceItem, type PaymentStatus } from "../lib/invoice/types.ts";
import { formatLongDate, formatMoneyInput, formatRupiah, parseMoney } from "../lib/format.ts";
import { buildPdf, createMeasurer, loadFonts } from "../lib/pdf/engine.ts";
import { pageToSvg } from "../lib/pdf/svg.ts";
import { allocateInvoiceNumber, getInvoice, saveInvoice } from "../lib/firebase/archive.ts";
import { fromArchive, toArchivePayload } from "../lib/invoice/archive-model.ts";
import { todayIso } from "../lib/format.ts";
import { requireAdmin } from "./session.ts";
import { chooseDialog, confirmDialog, showToast } from "./ui.ts";

// ---------- DOM ----------
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

const form = $<HTMLFormElement>("#invoice-form");
const itemsList = $<HTMLOListElement>("#items-list");
const itemTemplate = $<HTMLTemplateElement>("#item-template");
const addItemBtn = $<HTMLButtonElement>("#add-item");
const paidInput = $<HTMLInputElement>("#paid");
const previewPages = $("#preview-pages");
const previewWarnings = $("#preview-warnings");
const formErrors = $("#form-errors");
const resetBtn = $<HTMLButtonElement>("#reset-btn");

// ---------- State ----------
let draft: InvoiceDraft;
let userEmail = "";
let profile: BusinessProfile;
let totals: Totals;
let errors: Errors = {};
let measurer: Measurer | null = null;
let fontError = false;
/** Setelah tombol Download ditekan, semua error ditampilkan. */
let showAllErrors = false;
const touched = new Set<string>();

// ---------- Util ----------
function hasContent(d: InvoiceDraft): boolean {
  return !!d.customerName.trim() || filledItems(d.items).length > 0 || !!d.notes.trim();
}

/** Format ulang input nominal dengan pemisah ribuan tanpa membuat kursor meloncat. */
function formatMoneyField(input: HTMLInputElement): number | null {
  const raw = input.value;
  const caret = input.selectionStart ?? raw.length;
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, "").replace(/^0+(?=\d)/, "").length;
  const value = parseMoney(raw);
  const formatted = formatMoneyInput(value);
  if (formatted !== raw) {
    input.value = formatted;
    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < digitsBefore) {
      if (/\d/.test(formatted[pos])) seen++;
      pos++;
    }
    if (document.activeElement === input) input.setSelectionRange(pos, pos);
  }
  return value;
}

// ---------- Simpan draft ----------
let saveTimer = 0;
function setSaveStatus(text: string, ok: boolean) {
  const el = $("#save-status");
  $("[data-text]", el).textContent = text;
  $("[data-dot]", el).className = `size-1.5 rounded-full ${ok ? "bg-ink-900" : "bg-accent-500"}`;
}

function persistNow() {
  window.clearTimeout(saveTimer);
  const ok = saveDraft(draft);
  const time = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  setSaveStatus(ok ? `Draft otomatis ${time}` : "Draft tidak bisa disimpan di browser ini", ok);
}

function schedulePersist() {
  window.clearTimeout(saveTimer);
  setSaveStatus("Menyimpan…", true);
  saveTimer = window.setTimeout(persistNow, 400);
}

// ---------- Render form ----------
function itemNode(item: InvoiceItem, index: number): HTMLLIElement {
  const node = itemTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  node.dataset.id = item.id;
  for (const field of ["name", "description", "qty", "price"] as const) {
    const input = $<HTMLInputElement | HTMLTextAreaElement>(`[data-item-field="${field}"]`, node);
    const id = `item-${item.id}-${field}`;
    input.id = id;
    const label = $<HTMLLabelElement>(`[data-label="${field}"]`, node);
    label.htmlFor = id;
    const err = node.querySelector<HTMLElement>(`[data-item-error="${field}"]`);
    if (err) {
      err.id = `${id}-error`;
      input.setAttribute("aria-describedby", err.id);
    }
    if (field === "price") input.value = formatMoneyInput(item.price);
    else input.value = item[field];
  }
  $("[data-item-title]", node).textContent = `Item ${index + 1}`;
  $("[data-item-remove]", node).setAttribute("aria-label", `Hapus item ${index + 1}`);
  return node;
}

function renderItems() {
  itemsList.replaceChildren(...draft.items.map(itemNode));
}

function renderArchiveChip() {
  $("#archive-chip").textContent = draft.archived ? "Di arsip" : "Otomatis";
}

function fillForm() {
  $("#invoice-number").textContent = draft.number;
  renderArchiveChip();
  $("#issue-date").textContent = formatLongDate(draft.issueDate);
  for (const input of $$<HTMLInputElement | HTMLTextAreaElement>("[data-field]", form)) {
    const key = input.dataset.field as keyof InvoiceDraft;
    const value = draft[key];
    input.value = input.hasAttribute("data-money") ? formatMoneyInput(value as number | null) : String(value ?? "");
  }
  for (const input of $$<HTMLInputElement | HTMLSelectElement>("[data-profile]", form)) {
    input.value = profile[input.dataset.profile as keyof BusinessProfile] as string;
  }
  for (const radio of $$<HTMLInputElement>('input[name="status"]', form)) radio.checked = radio.value === draft.status;
  renderItems();
}

// ---------- Update setiap perubahan ----------
// Beberapa perubahan dalam satu event digabung jadi satu update. Sengaja tidak
// memakai requestAnimationFrame: rAF berhenti di tab latar, dan update yang
// tertunda akan memblokir update berikutnya.
let pending = false;
function scheduleUpdate() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    update();
  });
}

function setError(el: HTMLElement | null, message: string | undefined, input?: Element | null) {
  if (el) {
    el.hidden = !message;
    el.textContent = message ?? "";
  }
  if (input) {
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
}

const visible = (key: string) => showAllErrors || touched.has(key);

function renderErrors() {
  for (const el of $$("[data-error]", form)) {
    const key = el.dataset.error!;
    const msg = visible(key) ? errors[key] : undefined;
    setError(el, msg, form.querySelector(`[data-field="${key}"]`));
  }
  for (const node of $$("[data-item]", itemsList)) {
    const id = node.dataset.id!;
    for (const field of ["name", "qty", "price"]) {
      const key = `item:${id}:${field}`;
      setError($(`[data-item-error="${field}"]`, node), visible(key) ? errors[key] : undefined, $(`[data-item-field="${field}"]`, node));
    }
  }

  const count = Object.keys(errors).length;
  if (showAllErrors && count > 0) {
    $("[data-text]", formErrors).textContent =
      count === 1
        ? "Ada 1 isian yang perlu diperbaiki sebelum PDF bisa dibuat."
        : `Ada ${count} isian yang perlu diperbaiki sebelum PDF bisa dibuat.`;
    formErrors.hidden = false;
  } else {
    formErrors.hidden = true;
  }
}

function renderPaidField() {
  const status = draft.status;
  const label = $<HTMLLabelElement>('label[for="paid"]');
  const hint = $('[data-hint="paid"]');
  const shouldDisable = status !== "dp";
  if (status === "dp") {
    label.textContent = "Nominal DP dibayar";
    hint.textContent = "Isi jumlah yang sudah dibayar customer.";
    if (paidInput.disabled) paidInput.value = formatMoneyInput(draft.paid);
  } else {
    label.textContent = "Nominal dibayar";
    hint.textContent =
      status === "paid" ? "Status Lunas: sama dengan total tagihan." : "Status Belum Dibayar: belum ada pembayaran.";
    paidInput.value = formatMoneyInput(status === "paid" ? totals.total : 0);
  }
  paidInput.disabled = shouldDisable;
}

function renderSummary() {
  const set = (key: string, value: string) => ($(`[data-sum="${key}"]`).textContent = value);
  set("subtotal", formatRupiah(totals.subtotal));
  set("discount", totals.discount > 0 ? `-${formatRupiah(totals.discount)}` : formatRupiah(0));
  set("total", formatRupiah(totals.total));
  set("paid", formatRupiah(totals.paid));
  set("balance", formatRupiah(totals.balance));

  const lineMap = new Map(totals.lines.map((l) => [l.id, l.total]));
  for (const node of $$("[data-item]", itemsList)) {
    $("[data-item-total]", node).textContent = formatRupiah(lineMap.get(node.dataset.id!) ?? 0);
  }

  const filled = filledItems(draft.items).length;
  $("#item-count").textContent = `${filled} item`;
  addItemBtn.disabled = draft.items.length >= LIMITS.maxItems;
  $("#notes-count").textContent = `${draft.notes.length}/${LIMITS.notes}`;

  const [label, amount] =
    draft.status === "dp"
      ? ["Sisa pembayaran", totals.balance]
      : draft.status === "paid"
        ? ["Total (lunas)", totals.total]
        : ["Total tagihan", totals.total];
  $("#mobile-total-label").textContent = label;
  $("#mobile-total").textContent = formatRupiah(amount);
}

function renderPreview() {
  if (fontError) return;
  if (!measurer) return;
  const layout = layoutInvoice(draft, profile, measurer);
  const n = layout.pages.length;
  previewPages.innerHTML = layout.pages.map((ops, i) => pageToSvg(ops, i, n)).join("");
  $("#page-count").textContent = `A4 · ${n} halaman`;

  const warnings: string[] = [];
  if (layout.replacedChars) warnings.push("Emoji atau karakter khusus tidak didukung PDF, jadi dihilangkan atau diganti “?”.");
  if (!profile.paymentMethod.trim() && !profile.bankName.trim() && !profile.accountNumber.trim()) {
    warnings.push("Tujuan pembayaran belum diisi, bagian Info Pembayaran di invoice akan kosong.");
  }
  previewWarnings.hidden = warnings.length === 0;
  previewWarnings.innerHTML = warnings
    .map((w) => `<li class="rounded-lg bg-white/70 px-3 py-2">${w.replace(/</g, "&lt;")}</li>`)
    .join("");
}

function update() {
  totals = computeTotals(draft);
  errors = validate(draft, totals);
  renderPaidField();
  renderSummary();
  renderErrors();
  renderPreview();
  renderSaveButtons();
}

function changed() {
  scheduleUpdate();
  schedulePersist();
}

// ---------- Event ----------
form.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;

  if (target.name === "status") return; // ditangani di "change"

  const isMoney = target.hasAttribute("data-money");
  const money = isMoney ? formatMoneyField(target as HTMLInputElement) : null;

  if (target.dataset.field) {
    const key = target.dataset.field;
    touched.add(key);
    if (key === "discount" || key === "paid") (draft[key] as number | null) = money;
    else (draft as unknown as Record<string, unknown>)[key] = target.value;
    changed();
    return;
  }

  if (target.dataset.profile) {
    const key = target.dataset.profile as Exclude<keyof BusinessProfile, "version">;
    profile[key] = target.value;
    saveProfile(profile);
    // Tujuan pembayaran & kontak ikut tersimpan di arsip, jadi tombol Simpan ikut diperbarui.
    scheduleUpdate();
    return;
  }

  const field = target.dataset.itemField as keyof InvoiceItem | undefined;
  const node = target.closest<HTMLElement>("[data-item]");
  if (field && node) {
    const item = draft.items.find((it) => it.id === node.dataset.id);
    if (!item) return;
    if (field === "price") item.price = money;
    else if (field === "qty") {
      const clean = target.value.replace(/[^\d.,]/g, "");
      if (clean !== target.value) target.value = clean;
      item.qty = clean;
    } else if (field === "name" || field === "description") item[field] = target.value;
    touched.add(`item:${item.id}:${field}`);
    changed();
  }
});

form.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === "status") {
    draft.status = target.value as PaymentStatus;
    touched.add("paid");
    changed();
    if (draft.status === "dp") paidInput.focus();
  }
});

// Tandai field yang sudah disentuh supaya error wajib-isi muncul setelah blur.
form.addEventListener("focusout", (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset.field) touched.add(target.dataset.field);
  const node = target.closest<HTMLElement>("[data-item]");
  if (node && target.dataset.itemField) touched.add(`item:${node.dataset.id}:${target.dataset.itemField}`);
  scheduleUpdate();
});

addItemBtn.addEventListener("click", () => {
  if (draft.items.length >= LIMITS.maxItems) return;
  const item = emptyItem();
  draft.items.push(item);
  itemsList.append(itemNode(item, draft.items.length - 1));
  $<HTMLInputElement>(`#item-${item.id}-name`).focus();
  changed();
});

itemsList.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest("[data-item-remove]");
  if (!btn) return;
  const id = btn.closest<HTMLElement>("[data-item]")!.dataset.id;
  const index = draft.items.findIndex((it) => it.id === id);
  if (index < 0) return;
  // Item terakhir tidak dihapus, hanya dikosongkan, supaya form selalu punya satu baris.
  if (draft.items.length === 1) draft.items[0] = emptyItem();
  else draft.items.splice(index, 1);
  renderItems();
  const focusTarget = draft.items[Math.min(index, draft.items.length - 1)];
  $<HTMLElement>(`#item-${focusTarget.id}-name`)?.focus();
  changed();
});

// ---------- Invoice baru ----------
function setRestoreBanner(text: string | null) {
  $("#restore-banner").hidden = !text;
  $("#restore-text").textContent = text ?? "";
}

/** Ganti form dengan invoice lain (baru atau dari arsip). */
function loadIntoForm(next: InvoiceDraft) {
  draft = next;
  persistNow();
  showAllErrors = false;
  touched.clear();
  fillForm();
  update();
  window.scrollTo({ top: 0 });
}

async function startNewInvoice(): Promise<boolean> {
  resetBtn.disabled = true;
  $("#invoice-number").textContent = "Mengambil nomor…";
  try {
    const today = todayIso();
    const number = await allocateInvoiceNumber(today);
    clearDraft();
    loadIntoForm(newDraft(number, today));
    setRestoreBanner(null);
    return true;
  } catch (err) {
    console.error(err);
    $("#invoice-number").textContent = draft?.number ?? "—";
    showToast("Nomor invoice gagal diambil. Periksa koneksi lalu coba lagi.", { error: true });
    return false;
  } finally {
    resetBtn.disabled = false;
  }
}

/**
 * Ganti form dengan invoice kosong. Konfirmasi hanya bila ada isian yang belum
 * masuk arsip; admin bisa memilih menyimpannya dulu atau membuangnya.
 */
async function openReset() {
  const focusName = () => $<HTMLInputElement>("#customerName").focus({ preventScroll: true });

  // Form masih kosong dan belum diarsipkan: sudah invoice baru, jangan buang nomornya.
  if (!hasContent(draft) && !draft.archived && draft.issueDate === todayIso()) {
    focusName();
    showToast(`${draft.number} sudah invoice baru yang masih kosong.`);
    return;
  }

  let savedNote = "";
  if (hasContent(draft) && isDirty()) {
    const what = draft.archived ? `Perubahan pada ${draft.number}` : `Isian ${draft.number}`;
    const choice = await chooseDialog({
      title: "Buat invoice baru?",
      body: `${what} belum disimpan ke arsip. Simpan dulu supaya tidak hilang, atau buang isiannya. Tujuan pembayaran dan info bisnis tetap tersimpan.`,
      confirm: "Buang isian",
      danger: true,
      alt: "Simpan & buat baru",
    });
    if (choice === "cancel") return;
    if (choice === "alt") {
      const number = draft.number;
      // Gagal simpan (belum lengkap / koneksi): tetap di invoice ini, error/toast sudah tampil.
      if (!(await save())) return;
      savedNote = `${number} tersimpan. `;
    }
  }

  if (await startNewInvoice()) {
    focusName();
    showToast(`${savedNote}Invoice baru: ${draft.number}`);
  }
}

resetBtn.addEventListener("click", openReset);
$("#restore-new").addEventListener("click", openReset);
$("#restore-dismiss").addEventListener("click", () => setRestoreBanner(null));

// ---------- Simpan & PDF ----------
// Simpan = tulis ke arsip online. PDF = unduh saja. Keduanya terpisah supaya
// admin bisa menyimpan (mis. DP -> Lunas) tanpa mengunduh, dan sebaliknya.

let saving = false;

/** Isi arsip untuk form saat ini; sama dengan snapshot berarti tidak ada perubahan. */
function archiveSnapshot(): string {
  return JSON.stringify(toArchivePayload(draft, profile));
}

function isDirty(): boolean {
  return !draft.archived || draft.savedSnapshot !== archiveSnapshot();
}

function renderSaveButtons() {
  const dirty = isDirty();
  for (const btn of $$<HTMLButtonElement>(".js-save")) {
    btn.classList.toggle("btn-primary", dirty);
    btn.classList.toggle("btn-outline", !dirty);
    btn.disabled = saving;
    $("[data-save-label]", btn).textContent = saving ? "Menyimpan…" : dirty ? "Simpan" : "Tersimpan";
    $('[data-save-icon="save"]', btn).hidden = !dirty;
    $('[data-save-icon="check"]', btn).hidden = dirty;
    btn.title = dirty ? "Simpan ke arsip" : "Sudah tersimpan di arsip";
  }
  for (const btn of $$<HTMLButtonElement>(".js-pdf")) {
    btn.classList.toggle("btn-primary", !dirty);
    btn.classList.toggle("btn-outline", dirty);
  }
}

/** Tampilkan semua error; false bila invoice belum lengkap. */
function ensureValid(): boolean {
  showAllErrors = true;
  update();
  if (Object.keys(errors).length === 0) return true;
  focusFirstError();
  return false;
}

async function save(): Promise<boolean> {
  if (saving || !ensureValid()) return false;
  if (!isDirty()) {
    showToast(`${draft.number} sudah tersimpan di arsip.`, { action: { label: "Unduh PDF", run: downloadPdf } });
    return true;
  }
  saving = true;
  renderSaveButtons();
  try {
    const snapshot = archiveSnapshot();
    const revision = await saveInvoice(draft, profile, userEmail);
    draft.archived = true;
    draft.savedSnapshot = snapshot;
    persistNow();
    renderArchiveChip();
    showToast(revision > 1 ? `Arsip diperbarui (revisi ${revision}).` : `${draft.number} tersimpan di arsip.`, {
      action: { label: "Unduh PDF", run: downloadPdf },
    });
    return true;
  } catch (err) {
    console.error(err);
    showToast("Gagal menyimpan ke arsip. Periksa koneksi lalu coba lagi.", {
      error: true,
      action: { label: "Coba lagi", run: save },
    });
    return false;
  } finally {
    saving = false;
    renderSaveButtons();
  }
}

function focusFirstError() {
  const order = [
    "status",
    "customerName",
    "customerWhatsapp",
    "items",
    ...draft.items.flatMap((it) => ["name", "qty", "price"].map((f) => `item:${it.id}:${f}`)),
    "discount",
    "paid",
  ];
  const key = order.find((k) => errors[k]);
  let el: HTMLElement | null = null;
  if (!key) el = formErrors;
  else if (key.startsWith("item:")) {
    const [, id, field] = key.split(":");
    el = document.getElementById(`item-${id}-${field}`);
  } else if (key === "items") el = addItemBtn;
  else if (key === "status") el = $('input[name="status"]:checked') ?? null;
  else el = document.getElementById(key);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.focus({ preventScroll: true });
}

async function downloadPdf() {
  if (!ensureValid()) return;
  const buttons = $$<HTMLButtonElement>(".js-pdf");
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (!measurer) {
      await loadFonts();
      measurer = createMeasurer();
    }
    const pdf = buildPdf(layoutInvoice(draft, profile, measurer), { title: `Invoice ${draft.number}` });
    await pdf.save(`Invoice-Beresin-${draft.number}.pdf`, { returnPromise: true });
    if (isDirty()) {
      showToast(
        draft.archived ? "PDF diunduh. Perubahan terakhir belum disimpan ke arsip." : "PDF diunduh. Invoice ini belum disimpan ke arsip.",
        { action: { label: "Simpan", run: save } },
      );
    } else {
      showToast("PDF diunduh.", { action: { label: "Invoice baru", run: openReset } });
    }
  } catch (err) {
    console.error(err);
    showToast("PDF gagal dibuat. Muat ulang halaman lalu coba lagi.", { error: true });
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

for (const btn of $$(".js-save")) btn.addEventListener("click", save);
for (const btn of $$(".js-pdf")) btn.addEventListener("click", downloadPdf);

// Ctrl/Cmd+S sama dengan tombol Simpan (draft di browser ikut tersimpan).
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    persistNow();
    save();
  }
});
window.addEventListener("pagehide", persistNow);

// ---------- Init ----------
/** ?edit=NOMOR dari halaman arsip: buka invoice arsip di form. */
async function openFromArchive(number: string): Promise<boolean> {
  const inv = await getInvoice(number);
  if (!inv) {
    showToast(`Invoice ${number} tidak ditemukan di arsip.`, { error: true });
    return false;
  }
  const current = loadDraft();
  if (current && current.number !== number && !current.archived && hasContent(current)) {
    const ok = await confirmDialog({
      title: `Buka ${number}?`,
      body: `Draft ${current.number} yang belum tersimpan di arsip akan diganti.`,
      confirm: "Buka invoice",
      danger: true,
    });
    if (!ok) return false;
  }
  draft = fromArchive(inv).draft;
  draft.savedSnapshot = archiveSnapshot();
  loadIntoForm(draft);
  setRestoreBanner(`Mengedit ${number} dari arsip. Tekan Simpan untuk menyimpan perubahan.`);
  return true;
}

async function init() {
  profile = loadProfile();
  const user = await requireAdmin();
  userEmail = user.email ?? "";

  const params = new URLSearchParams(location.search);
  const editNumber = params.get("edit");
  /** ?new=1 dari menu "Buat Invoice" dan tombol "Buat invoice baru" di beranda/arsip. */
  const wantsNew = params.has("new");
  if (editNumber || wantsNew) history.replaceState(null, "", location.pathname);

  const restored = loadDraft();
  let ready = false;
  /** Draft berisi yang belum masuk arsip: jangan dibuang tanpa konfirmasi. */
  let confirmNew = false;
  if (editNumber) {
    try {
      ready = await openFromArchive(editNumber);
    } catch (err) {
      console.error(err);
      showToast("Invoice arsip gagal dibuka. Periksa koneksi.", { error: true });
    }
  }
  // ?new selalu berakhir di invoice kosong. Pengecualian:
  // - draft kosong hari ini dipakai ulang supaya nomor urut tidak terbuang;
  // - draft dengan isian yang belum masuk arsip dibuka dulu lalu dikonfirmasi.
  if (!ready && wantsNew && restored) {
    const unsaved =
      hasContent(restored) &&
      (!restored.archived || restored.savedSnapshot !== JSON.stringify(toArchivePayload(restored, profile)));
    const reusable = !restored.archived && !hasContent(restored) && restored.issueDate === todayIso();
    if (unsaved) confirmNew = true;
    else if (!reusable) ready = await startNewInvoice();
  }
  if (!ready && restored) {
    loadIntoForm(restored);
    if (hasContent(restored)) {
      setRestoreBanner(
        restored.archived
          ? `Melanjutkan ${restored.number} (ada di arsip). Tekan Simpan untuk menyimpan perubahan.`
          : `Melanjutkan draft ${restored.number} yang belum tersimpan di arsip.`,
      );
    }
    ready = true;
  }
  if (!ready) ready = await startNewInvoice();
  resetBtn.disabled = false;
  if (!ready) {
    $("#invoice-number").textContent = "Gagal mengambil nomor";
    return;
  }
  if (confirmNew) openReset();

  loadFonts()
    .then(async () => {
      measurer = createMeasurer();
      // Pastikan font Inter di halaman sudah siap supaya preview tidak berkedip.
      await Promise.all([300, 400, 600, 700, 800].map((w) => document.fonts?.load(`${w} 12px Inter`)));
      renderPreview();
    })
    .catch((err) => {
      console.error(err);
      fontError = true;
      previewPages.innerHTML =
        '<div class="grid aspect-[210/297] place-items-center rounded-[3px] bg-white p-6 text-center text-sm text-accent-600">Font invoice gagal dimuat. Periksa koneksi lalu muat ulang halaman.</div>';
    });
}

init();
