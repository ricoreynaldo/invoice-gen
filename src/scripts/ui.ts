// Toast & dialog konfirmasi bersama (markup di components/Feedback.astro).

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

/** Dialog konfirmasi; resolve true bila tombol konfirmasi ditekan. */
export function confirmDialog(opts: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  dialog.querySelector<HTMLElement>("[data-title]")!.textContent = opts.title;
  dialog.querySelector<HTMLElement>("[data-body]")!.textContent = opts.body;
  const btn = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
  btn.textContent = opts.confirm;
  btn.className = `btn btn-md ${opts.danger ? "btn-danger" : "btn-primary"}`;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}
