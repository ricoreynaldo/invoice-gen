// Login admin dengan akun Google.

import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { firebase, useEmulator } from "./client.ts";

const ERRORS: Record<string, string> = {
  "auth/popup-closed-by-user": "Jendela login ditutup sebelum selesai.",
  "auth/cancelled-popup-request": "Jendela login ditutup sebelum selesai.",
  "auth/network-request-failed": "Tidak ada koneksi internet.",
  "auth/unauthorized-domain": "Domain ini belum diizinkan di Firebase (Authentication → Settings → Authorized domains).",
  "auth/operation-not-allowed": "Login Google belum diaktifkan di Firebase (Authentication → Sign-in method).",
  "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi beberapa saat.",
};

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  return ERRORS[code] ?? "Login gagal. Coba lagi.";
}

export function watchAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(firebase().auth, callback);
}

export async function signInWithGoogle(): Promise<void> {
  const { auth } = firebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // Browser yang memblokir popup (sering di mobile) → pakai redirect.
    if ((err as { code?: string }).code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

/** Selesaikan login redirect (bila ada) supaya error-nya bisa ditampilkan. */
export function completeRedirect(): Promise<unknown> {
  return getRedirectResult(firebase().auth);
}

export function signOut(): Promise<void> {
  return fbSignOut(firebase().auth);
}

// Khusus `npm run dev:emulator`: login tanpa popup untuk uji otomatis.
// Emulator Auth menerima token Google palsu; build produksi tidak memuat ini.
if (useEmulator && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__emulatorSignIn = (email: string, verified = true) =>
    signInWithCredential(
      firebase().auth,
      GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: verified })),
    );
}
