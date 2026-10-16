// Gerbang login admin untuk setiap halaman. requireAdmin() selesai setelah
// pengguna login dengan Google DAN firestore.rules mengizinkan aksesnya.

import type { User } from "firebase/auth";
import { firebaseConfigured } from "../lib/firebase/client.ts";
import { authErrorMessage, completeRedirect, signInWithGoogle, signOut, watchAuth } from "../lib/firebase/auth.ts";
import { hasAdminAccess } from "../lib/firebase/archive.ts";

const gate = document.getElementById("auth-gate")!;
const errorEl = gate.querySelector<HTMLElement>("[data-gate-error]")!;

type GateState = "loading" | "signin" | "denied" | "setup";

function show(state: GateState) {
  for (const el of gate.querySelectorAll<HTMLElement>("[data-gate]")) el.hidden = el.dataset.gate !== state;
}

function setError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setupUserMenu(user: User) {
  const menu = document.querySelector<HTMLElement>("[data-user-menu]");
  if (!menu) return;
  const email = user.email ?? "";
  menu.hidden = false;
  menu.querySelector("[data-user-initial]")!.textContent = (user.displayName || email || "A").charAt(0).toUpperCase();
  menu.querySelector("[data-user-email]")!.textContent = email;
  const button = menu.querySelector<HTMLButtonElement>("[data-user-button]")!;
  const panel = menu.querySelector<HTMLElement>("[data-user-panel]")!;
  const toggle = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.onclick = () => toggle(panel.hidden === true);
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) toggle(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggle(false);
  });
  menu.querySelector<HTMLButtonElement>("[data-signout]")!.onclick = () => signOut();
}

export function requireAdmin(): Promise<User> {
  if (!firebaseConfigured) {
    show("setup");
    return new Promise(() => {});
  }

  gate.querySelector<HTMLButtonElement>("[data-gate-signin]")!.onclick = async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    setError("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      btn.disabled = false;
    }
  };
  gate.querySelector<HTMLButtonElement>("[data-gate-signout]")!.onclick = () => signOut();
  completeRedirect().catch((err) => setError(authErrorMessage(err)));

  let resolved = false;
  return new Promise((resolve) => {
    watchAuth(async (user) => {
      if (!user) {
        // Sesi berakhir setelah halaman terbuka → muat ulang supaya data di layar ikut hilang.
        if (resolved) {
          window.location.reload();
          return;
        }
        gate.hidden = false;
        show("signin");
        return;
      }
      show("loading");
      try {
        if (!(await hasAdminAccess())) {
          gate.querySelector("[data-gate-email]")!.textContent = user.email ?? "";
          show("denied");
          return;
        }
      } catch {
        show("signin");
        setError("Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
        return;
      }
      if (resolved) return;
      resolved = true;
      setupUserMenu(user);
      gate.hidden = true;
      resolve(user);
    });
  });
}
