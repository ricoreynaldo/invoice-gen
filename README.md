# Beresin Invoice Generator

Aplikasi admin Beresin untuk membuat invoice customer, mengunduhnya sebagai PDF A4, dan
menyimpannya di arsip online. Astro (output statis) + TypeScript sisi klien + Firebase
(Auth Google & Firestore). Tidak ada server sendiri.

```bash
npm install
npm run dev:emulator  # http://localhost:3090 dengan Auth & Firestore lokal (butuh Java 11+)
npm run dev           # http://localhost:3090 dengan project Firebase asli (.env)
npm test              # unit test perhitungan, validasi, QR
npm run test:rules    # uji firestore.rules di emulator
npm run build         # astro check + build ke dist/
```

`scripts/firebase.mjs` menjalankan Firebase CLI dan memakai Java bawaan Android Studio
bila `java` tidak ada di PATH. Di mode emulator, login Google memakai akun palsu lokal.

## Setup Firebase (sekali)

1. Firebase console → buat project baru, lalu **Project settings → Your apps → Web** dan
   salin config-nya ke `.env` (format di `.env.example`).
2. **Authentication → Sign-in method → Google**: aktifkan.
   **Authentication → Settings → Authorized domains**: tambahkan domain Vercel aplikasi.
3. **Firestore Database → Create database** (production mode; lokasi disarankan
   `asia-southeast2` Jakarta).
4. **Firestore → Rules**: tempel isi `firestore.rules` lalu **Publish**
   (atau `node scripts/firebase.mjs deploy --only firestore:rules --project <id>`).
5. Vercel → Project → Settings → Environment Variables: isi semua `PUBLIC_FIREBASE_*`,
   lalu redeploy.

Admin: `beresincorp@gmail.com` (ditulis di `firestore.rules`). Admin lain cukup dibuatkan
dokumen kosong `admins/<email>` di Firestore console, tanpa ubah kode.

## Cara kerja

- `src/lib/invoice/calc.ts` perhitungan (total item, subtotal, diskon, DP, sisa) dan validasi.
- `src/lib/invoice/layout.ts` menata invoice A4 menjadi *display list* (teks, garis, kotak dalam mm).
- Display list yang sama digambar dua kali: `src/lib/pdf/svg.ts` untuk preview dan
  `src/lib/pdf/engine.ts` (jsPDF) untuk file PDF. Preview dan PDF identik, teks PDF vektor.
- Font Inter TTF di `public/fonts/` dipakai UI, preview, dan PDF (`npm run fonts`).
- Draft yang sedang diketik dan isian tujuan pembayaran/info bisnis disimpan di
  `localStorage`. Arsip dan counter nomor ada di Firestore (`src/lib/firebase/archive.ts`).

## Login & akses

Semua halaman tertutup layar login (`src/scripts/session.ts`). Setelah login Google,
aplikasi mencoba membaca arsip; kalau `firestore.rules` menolak, muncul "Akses ditolak".
Keamanan data sepenuhnya dijaga rules: hanya admin dengan email terverifikasi yang bisa
membaca/menulis, data invoice divalidasi, dan `createdAt/createdBy` tidak bisa diubah.

## Nomor invoice

Format `INV-BRS-YYYYMMDD-001`, diambil dari `counters/{YYYYMMDD}` lewat transaksi Firestore
saat invoice baru dimulai. Rules hanya mengizinkan counter naik satu, jadi nomor unik di
semua perangkat dan tidak pernah dipakai ulang (invoice yang dihapus meninggalkan celah).

## Arsip

- **Simpan & Unduh PDF** menyimpan invoice ke `invoices/{nomor}` dulu, baru mengunduh PDF.
  Kalau penyimpanan gagal, PDF tidak diunduh.
- Invoice di arsip bisa dibuka lagi (`/?edit=<nomor>`), misalnya DP → Lunas, lalu diunduh
  ulang dengan nomor sama. Setiap simpan menaikkan `revision` dan mencatat riwayat status.
- Arsip menyimpan salinan tujuan pembayaran & kontak saat disimpan. Unduh ulang dari halaman
  Arsip memakai salinan itu; mengedit lewat form memakai isian tujuan pembayaran saat ini.
- Halaman `/arsip`: cari nama/nomor, filter status, ringkasan total, unduh PDF, edit, hapus.

## QR code identitas

Area "Hormat kami" berisi QR vektor (`qrcode`) dengan teks tiga baris: `BERESIN`, nomor
invoice, tanggal penerbitan. Informatif, bukan tanda tangan digital.

## Cek visual PDF tanpa browser

```bash
node tests/render-sample.ts contoh.pdf          # 1 halaman
node tests/render-sample.ts contoh.pdf banyak   # multi-halaman
```

## Deploy

Vercel mendeteksi Astro otomatis (build `npm run build`, output `dist/`). Wajib mengisi env
`PUBLIC_FIREBASE_*`; tanpa itu halaman menampilkan petunjuk setup.
