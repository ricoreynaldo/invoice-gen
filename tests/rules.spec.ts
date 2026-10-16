// Uji firestore.rules di emulator: npm run test:rules
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { toArchivePayload } from "../src/lib/invoice/archive-model.ts";
import { defaultProfile } from "../src/lib/invoice/store.ts";
import type { InvoiceDraft } from "../src/lib/invoice/types.ts";

let env: RulesTestEnvironment;

const OWNER = "beresincorp@gmail.com";
const owner = () => env.authenticatedContext("owner", { email: OWNER, email_verified: true }).firestore();
const stranger = () => env.authenticatedContext("x", { email: "orang@gmail.com", email_verified: true }).firestore();
const unverified = () => env.authenticatedContext("u", { email: OWNER, email_verified: false }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const NUMBER = "INV-BRS-20261016-001";
const draft: InvoiceDraft = {
  version: 1, number: NUMBER, issueDate: "2026-10-16", status: "dp",
  customerName: "Budi", customerWhatsapp: "", notes: "",
  items: [{ id: "a", name: "Website", description: "", qty: "1", price: 1_000_000 }],
  discount: null, paid: 400_000,
};

function invoiceDoc(email: string, revision: number, extra: Record<string, unknown> = {}) {
  return {
    ...toArchivePayload(draft, defaultProfile()),
    revision,
    history: [],
    createdAt: serverTimestamp(),
    createdBy: email,
    updatedAt: serverTimestamp(),
    updatedBy: email,
    ...extra,
  };
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-beresin",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

test("tanpa login / bukan admin / email belum terverifikasi: ditolak", async () => {
  for (const db of [anon(), stranger(), unverified()]) {
    await assertFails(getDocs(collection(db, "invoices")));
    await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc("orang@gmail.com", 1)));
    await assertFails(setDoc(doc(db, "counters", "20261016"), { last: 1, updatedAt: serverTimestamp() }));
  }
});

test("pemilik bisa buat, baca, perbarui, hapus invoice", async () => {
  const db = owner();
  await assertSucceeds(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 1)));
  const snap = await assertSucceeds(getDoc(doc(db, "invoices", NUMBER)));
  const createdAt = snap.data()!.createdAt;
  await assertSucceeds(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 2, { createdAt, status: "paid" })));
  await assertSucceeds(deleteDoc(doc(db, "invoices", NUMBER)));
});

test("admin tambahan lewat koleksi admins", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "admins", "orang@gmail.com"), { note: "admin kedua" });
  });
  await assertSucceeds(getDocs(collection(stranger(), "invoices")));
  // Admin tidak bisa mengubah daftar admin dari aplikasi.
  await assertFails(setDoc(doc(owner(), "admins", "lain@gmail.com"), {}));
});

test("validasi data invoice", async () => {
  const db = owner();
  // ID dokumen harus sama dengan nomor & berformat benar.
  await assertFails(setDoc(doc(db, "invoices", "INV-BRS-20261016-002"), invoiceDoc(OWNER, 1)));
  await assertFails(setDoc(doc(db, "invoices", "bebas"), { ...invoiceDoc(OWNER, 1), number: "bebas" }));
  // Nama customer wajib, status harus valid, dibayar tidak boleh melebihi total.
  await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 1, { customerName: "" })));
  await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 1, { status: "batal" })));
  await assertFails(
    setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 1, { totals: { subtotal: 1, discount: 0, total: 1, paid: 5, balance: 0 } })),
  );
  // Tidak bisa memalsukan pembuat/pengubah.
  await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 1, { updatedBy: "lain@gmail.com" })));
});

test("update: revisi naik satu, createdAt & createdBy tetap", async () => {
  const db = owner();
  await setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 1));
  const createdAt = (await getDoc(doc(db, "invoices", NUMBER))).data()!.createdAt;
  await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 3, { createdAt })));
  await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 2)));
  await assertFails(setDoc(doc(db, "invoices", NUMBER), invoiceDoc(OWNER, 2, { createdAt, createdBy: "x@gmail.com" })));
});

test("counter: mulai dari 1, hanya naik satu, tidak bisa dihapus", async () => {
  const db = owner();
  const ref = doc(db, "counters", "20261016");
  await assertFails(setDoc(ref, { last: 5, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(ref, { last: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { last: 1 }));
  await assertFails(updateDoc(ref, { last: 3 }));
  await assertSucceeds(updateDoc(ref, { last: 2, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(doc(db, "counters", "2026-10"), { last: 1, updatedAt: serverTimestamp() }));
});
