// Toast & dialog konfirmasi bersama (markup di components/Feedback.astro),
// plus potongan HTML kecil yang dipakai beberapa halaman.

import { STATUS_LABEL, type PaymentStatus } from "../lib/invoice/types.ts";

const toast = document.getElementById("toast")!;
const dialog = document.getElementById("confirm-dialog") as HTMLDialogElement;

let toastTimer = 0;

export function showToast(
  text: string,
  opts: { action?: { label: string; run: () => void }; error?: boolean } = {},
) {
  const { action, error } = opts;
  toast.querySelector<HTMLElement>("[data-text]")!.textContent = text;
  toast.querySelector<HTMLElement>("[data-icon-ok]")!.hidden = !!error;
  toast.querySelector<HTMLElement>("[data-icon-err]")!.hidden = !error;
  const btn = toast.querySelector<HTMLButtonElement>("[data-action]")!;
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
  toastTimer = window.setTimeout(() => (toast.hidden = true), action || error ? 9000 : 3500);
}

export type DialogChoice = "confirm" | "alt" | "cancel";

/**
 * Dialog dengan tombol Batal, konfirmasi, dan (opsional) pilihan ketiga `alt`
 * yang tampil sebagai tombol utama. Esc / klik Batal = "cancel".
 */
export function chooseDialog(opts: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  alt?: string;
}): Promise<DialogChoice> {
  dialog.querySelector<HTMLElement>("[data-title]")!.textContent = opts.title;
  dialog.querySelector<HTMLElement>("[data-body]")!.textContent = opts.body;
  const btn = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
  btn.textContent = opts.confirm;
  // Dengan pilihan ketiga, tombol konfirmasi turun jadi sekunder supaya hanya ada satu tombol utama.
  btn.className = `btn btn-md ${opts.danger ? "btn-danger" : opts.alt ? "btn-outline" : "btn-primary"}`;
  const alt = dialog.querySelector<HTMLButtonElement>("[data-alt]")!;
  alt.hidden = !opts.alt;
  alt.textContent = opts.alt ?? "";
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm" || dialog.returnValue === "alt" ? dialog.returnValue : "cancel"),
      { once: true },
    );
  });
}

/** Dialog konfirmasi; resolve true bila tombol konfirmasi ditekan. */
export async function confirmDialog(opts: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return (await chooseDialog(opts)) === "confirm";
}

/** Escape teks untuk disisipkan ke innerHTML. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BADGE: Record<PaymentStatus, string> = {
  paid: "bg-ink-900 text-white",
  dp: "border border-ink-900 text-ink-900",
  unpaid: "bg-ink-100 text-ink-600",
};

/** Label status pembayaran berbentuk pil. */
export function statusBadge(status: PaymentStatus) {
  return `<span class="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ${BADGE[status]}">${STATUS_LABEL[status]}</span>`;
}
