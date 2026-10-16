// Model dokumen invoice yang sudah ditata (display list).
// Satu hasil layout dipakai dua renderer: SVG untuk preview dan jsPDF untuk
// file PDF. Karena posisi setiap teks dihitung di sini, preview dan PDF
// selalu identik, termasuk pemenggalan baris dan halaman.

export type Weight = 300 | 400 | 600 | 700 | 800;

export interface TextOp {
  t: "text";
  /** Posisi kiri baseline, dalam mm. Semua teks digambar rata kiri. */
  x: number;
  y: number;
  s: string;
  /** Ukuran huruf dalam pt. */
  size: number;
  weight: Weight;
  color: string;
  /** Letter-spacing dalam mm. */
  ls?: number;
}

export interface RectOp {
  t: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface LineOp {
  t: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface CircleOp {
  t: "circle";
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

/**
 * Kumpulan kotak yang diisi sebagai satu path (pola QR code). Satu path
 * mencegah garis rambut di antara modul yang bersebelahan saat dirender.
 */
export interface ShapeOp {
  t: "shape";
  /** [x, y, w, h] per kotak, dalam mm. */
  rects: [number, number, number, number][];
  fill: string;
}

export type Op = TextOp | RectOp | LineOp | CircleOp | ShapeOp;

export interface LaidOutDocument {
  pages: Op[][];
  /** true bila ada karakter yang tidak didukung font PDF lalu diganti. */
  replacedChars: boolean;
}

export const PAGE_W = 210;
export const PAGE_H = 297;
/** 1pt dalam mm. */
export const PT = 25.4 / 72;

/** Pengukur teks; implementasinya memakai metrik font yang sama dengan PDF. */
export interface Measurer {
  width(text: string, size: number, weight: Weight, ls?: number): number;
  /** Pecah teks menjadi baris yang muat di maxWidth (mm). Menghormati "\n". */
  wrap(text: string, size: number, weight: Weight, maxWidth: number): string[];
  /** Apakah font punya glyph untuk karakter ini. */
  supports(char: string): boolean;
}
