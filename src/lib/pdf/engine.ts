// Jembatan ke jsPDF: memuat font Inter (TTF yang sama dengan preview),
// menyediakan pengukur teks untuk layout, dan menggambar display list ke PDF.

import { jsPDF } from "jspdf";
import type { LaidOutDocument, Measurer, Op, Weight } from "../invoice/doc.ts";

const WEIGHTS: Weight[] = [300, 400, 600, 700, 800];
const fontName = (w: Weight) => `Inter${w}`;

let fontData: Map<Weight, string> | null = null;
let loading: Promise<void> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Unduh file TTF sekali; dipakai ulang untuk pengukuran dan setiap PDF. */
export function loadFonts(base = "/fonts/"): Promise<void> {
  if (fontData) return Promise.resolve();
  loading ??= Promise.all(
    WEIGHTS.map(async (w) => {
      const res = await fetch(`${base}inter-${w}.ttf`);
      if (!res.ok) throw new Error(`Font inter-${w}.ttf gagal dimuat (${res.status})`);
      return [w, toBase64(await res.arrayBuffer())] as const;
    }),
  )
    .then((entries) => {
      fontData = new Map(entries);
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** Untuk lingkungan tanpa fetch (skrip Node/tes): isi font langsung. */
export function setFontData(entries: [Weight, string][]) {
  fontData = new Map(entries);
}

function registerFonts(doc: jsPDF) {
  if (!fontData) throw new Error("Font belum dimuat");
  for (const [w, data] of fontData) {
    doc.addFileToVFS(`inter-${w}.ttf`, data);
    doc.addFont(`inter-${w}.ttf`, fontName(w), "normal");
  }
}

function newDoc(): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  registerFonts(doc);
  return doc;
}

/** Pengukur memakai metrik font di jsPDF, jadi hasil wrap sama persis dengan PDF. */
export function createMeasurer(): Measurer {
  const doc = newDoc();
  doc.setFont(fontName(400), "normal");
  const font = doc.getFont() as unknown as { metadata?: { cmap?: { unicode?: { codeMap?: Record<number, number> } } } };
  const codeMap = font.metadata?.cmap?.unicode?.codeMap ?? {};
  const cache = new Map<string, number>();

  const use = (size: number, weight: Weight) => {
    doc.setFont(fontName(weight), "normal");
    doc.setFontSize(size);
  };

  return {
    width(text, size, weight, ls = 0) {
      const key = `${weight}|${size}|${text}`;
      let w = cache.get(key);
      if (w === undefined) {
        use(size, weight);
        w = doc.getTextWidth(text);
        if (cache.size > 5000) cache.clear();
        cache.set(key, w);
      }
      return w + ls * [...text].length;
    },
    wrap(text, size, weight, maxWidth) {
      use(size, weight);
      return doc.splitTextToSize(text, maxWidth) as string[];
    },
    supports(char) {
      const cp = char.codePointAt(0) ?? 0;
      return cp === 32 || codeMap[cp] !== undefined;
    },
  };
}

function drawOp(doc: jsPDF, op: Op) {
  switch (op.t) {
    case "rect":
      doc.setFillColor(op.fill);
      doc.rect(op.x, op.y, op.w, op.h, "F");
      break;
    case "line":
      doc.setDrawColor(op.color);
      doc.setLineWidth(op.width);
      doc.line(op.x1, op.y1, op.x2, op.y2);
      break;
    case "circle":
      doc.setFillColor(op.fill);
      doc.circle(op.cx, op.cy, op.r, "F");
      break;
    case "shape":
      // Semua modul jadi satu path lalu diisi sekali: tidak ada celah antar-modul.
      doc.setFillColor(op.fill);
      for (const [x, y, w, h] of op.rects) {
        doc.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).close();
      }
      doc.fill();
      break;
    case "text":
      doc.setFont(fontName(op.weight), "normal");
      doc.setFontSize(op.size);
      doc.setTextColor(op.color);
      doc.text(op.s, op.x, op.y, { baseline: "alphabetic", charSpace: op.ls ?? 0 });
      break;
  }
}

export function buildPdf(layout: LaidOutDocument, meta: { title: string }): jsPDF {
  const doc = newDoc();
  layout.pages.forEach((ops, i) => {
    if (i > 0) doc.addPage("a4", "portrait");
    for (const op of ops) drawOp(doc, op);
  });
  doc.setProperties({ title: meta.title, author: "Beresin", creator: "Beresin Invoice Generator" });
  return doc;
}
