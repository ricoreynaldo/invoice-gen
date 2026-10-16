# Beresin Invoice Generator

Aplikasi admin Beresin untuk membuat invoice customer dan mengunduhnya sebagai PDF A4.
Astro (output statis) + TypeScript sisi klien, tanpa backend dan tanpa database.

```bash
npm install
npm run dev      # http://localhost:3090
npm test         # unit test perhitungan, validasi, penomoran
npm run build    # astro check + build ke dist/
```

## Cara kerja

- `src/lib/invoice/calc.ts` perhitungan (total item, subtotal, diskon, DP, sisa) dan validasi.
- `src/lib/invoice/layout.ts` menata invoice A4 menjadi *display list* (teks, garis, kotak dalam mm).
- Display list yang sama digambar dua kali: `src/lib/pdf/svg.ts` untuk preview dan
  `src/lib/pdf/engine.ts` (jsPDF) untuk file PDF. Karena itu preview dan PDF identik,
  termasuk pemenggalan baris dan halaman. Teks PDF berupa teks vektor (bukan screenshot).
- Font Inter TTF di `public/fonts/` dipakai UI, preview, dan PDF. File dibuat dari
  `@fontsource/inter` dengan `npm run fonts` (subset latin).
- Draft invoice, data tujuan pembayaran/info bisnis, dan counter nomor invoice disimpan
  di `localStorage` browser yang dipakai admin.

## Nomor invoice

Format `INV-BRS-YYYYMMDD-001`. Nomor diambil saat invoice baru dimulai (buka pertama kali
atau setelah reset) dan tidak berubah selama invoice diedit. Counter per tanggal disimpan di
browser dan selalu naik, jadi nomor tidak dipakai ulang di browser yang sama. Browser atau
perangkat lain punya counter sendiri.

## QR code identitas

Area "Hormat kami" berisi QR (library `qrcode`, error correction M, digambar sebagai
vektor) dengan teks biasa tiga baris: `BERESIN`, nomor invoice, tanggal penerbitan
(mis. `16 Oktober 2026`). QR bersifat informatif, bukan tanda tangan digital atau bukti
keaslian. `tests/qr.test.ts` membaca ulang QR dari layout dengan `jsqr`.

## Cek visual PDF tanpa browser

```bash
node tests/render-sample.ts contoh.pdf          # 1 halaman
node tests/render-sample.ts contoh.pdf banyak   # multi-halaman
```

## Deploy

Vercel mendeteksi Astro otomatis (build `npm run build`, output `dist/`). Tidak ada env var.
