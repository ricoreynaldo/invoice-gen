// Inisialisasi Firebase dari env PUBLIC_FIREBASE_* (lihat .env.example).
// Dengan PUBLIC_FIREBASE_EMULATOR=1 (npm run dev:emulator) semua data ke
// emulator lokal, bukan project asli.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

// Ditulis lengkap (import.meta.env.X) supaya Vite mengganti nilainya saat build
// dan kode khusus emulator terbuang dari build produksi.
const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
};

export const useEmulator = import.meta.env.PUBLIC_FIREBASE_EMULATOR === "1";

/** false bila env Firebase belum diisi; halaman lalu menampilkan petunjuk setup. */
export const firebaseConfigured = !!(config.apiKey && config.authDomain && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function firebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!firebaseConfigured) throw new Error("Firebase belum dikonfigurasi");
  if (!app) {
    app = initializeApp(config);
    auth = getAuth(app);
    auth.languageCode = "id";
    db = getFirestore(app);
    if (useEmulator) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
  }
  return { app, auth: auth!, db: db! };
}
