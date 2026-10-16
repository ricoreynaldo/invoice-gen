// Controller halaman Invoice Generator: menghubungkan form, state draft,
// preview SVG, dan ekspor PDF. Logika hitung ada di lib/invoice/calc.ts,
// tata letak dokumen di lib/invoice/layout.ts.

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
import { formatMoneyInput, formatRupiah, parseMoney } from "../lib/format.ts";
import { buildPdf, createMeasurer, loadFonts } from "../lib/pdf/engine.ts";
import { pageToSvg } from "../lib/pdf/svg.ts";

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
const resetDialog = $<HTMLDialogElement>("#reset-dialog");
const toast = $("#toast");

// ---------- State ----------
let draft: InvoiceDraft;
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

let toastTimer = 0;
function showToast(text: string, action?: { label: string; run: () => void }) {
  $("[data-text]", toast).textContent = text;
  const btn = $<HTMLButtonElement>("[data-action]", toast);
  btn.hidden = !action;
  btn.textContent = action?.label ?? "";
  btn.onclick = action
    ? () => {
        toast.hidden = true;
        action.run();
      }
    : null;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), action ? 8000 : 3500);
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
  setSaveStatus(ok ? `Draft tersimpan ${time}` : "Draft tidak bisa disimpan di browser ini", ok);
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

function fillForm() {
  $("#invoice-number").textContent = draft.number;
  for (const input of $$<HTMLInputElement | HTMLTextAreaElement>("[data-field]", form)) {
    const key = input.dataset.field as keyof InvoiceDraft;
    const value = draft[key];
    input.value = input.hasAttribute("data-money") ? formatMoneyInput(value as number | null) : String(value ?? "");
  }
  for (const input of $$<HTMLInputElement>("[data-profile]", form)) {
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

// ---------- Reset ----------
function openReset() {
  $("#reset-number").textContent = draft.number;
  resetDialog.returnValue = "";
  resetDialog.showModal();
}

function doReset() {
  clearDraft();
  draft = newDraft();
  persistNow();
  showAllErrors = false;
  touched.clear();
  $("#restore-banner").hidden = true;
  fillForm();
  update();
  window.scrollTo({ top: 0 });
  $<HTMLInputElement>("#customerName").focus({ preventScroll: true });
  showToast(`Form direset. Nomor invoice baru: ${draft.number}`);
}

resetDialog.addEventListener("close", () => {
  if (resetDialog.returnValue === "confirm") doReset();
});
$("#reset-btn").addEventListener("click", openReset);
$("#restore-new").addEventListener("click", openReset);
$("#restore-dismiss").addEventListener("click", () => ($("#restore-banner").hidden = true));

// ---------- Download PDF ----------
function focusFirstError() {
  const order = [
    "issueDate",
    "dueDate",
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

async function download() {
  showAllErrors = true;
  update();
  if (Object.keys(errors).length > 0) {
    focusFirstError();
    return;
  }

  const buttons = $$<HTMLButtonElement>(".js-download");
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (!measurer) {
      await loadFonts();
      measurer = createMeasurer();
    }
    const layout = layoutInvoice(draft, profile, measurer);
    const filename = `Invoice-Beresin-${draft.number}.pdf`;
    const pdf = buildPdf(layout, { title: `Invoice ${draft.number}` });
    await pdf.save(filename, { returnPromise: true });
    persistNow();
    showToast(`PDF diunduh: ${filename}`, { label: "Invoice baru", run: openReset });
  } catch (err) {
    console.error(err);
    showToast("PDF gagal dibuat. Muat ulang halaman lalu coba lagi.");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

for (const btn of $$(".js-download")) btn.addEventListener("click", download);

// Ctrl/Cmd+S tidak menyimpan halaman HTML, tetapi menyimpan draft.
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    persistNow();
  }
});
window.addEventListener("pagehide", persistNow);

// ---------- Init ----------
function init() {
  profile = loadProfile();
  const restored = loadDraft();
  draft = restored ?? newDraft();
  persistNow();

  if (restored && hasContent(restored)) {
    $("#restore-number").textContent = restored.number;
    $("#restore-banner").hidden = false;
  }

  fillForm();
  update();

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
