// Render display list ke SVG untuk preview. Unit SVG = mm, jadi koordinatnya
// sama persis dengan yang dipakai jsPDF.

import { PAGE_H, PAGE_W, PT, type Op } from "../invoice/doc.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const n = (v: number) => Math.round(v * 1000) / 1000;

function opToSvg(op: Op): string {
  switch (op.t) {
    case "rect":
      return `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${op.fill}"/>`;
    case "line":
      return `<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${op.color}" stroke-width="${n(op.width)}"/>`;
    case "circle":
      return `<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r)}" fill="${op.fill}"/>`;
    case "shape": {
      const d = op.rects.map(([x, y, w, h]) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`).join("");
      return `<path d="${d}" fill="${op.fill}"/>`;
    }
    case "text": {
      const ls = op.ls ? ` letter-spacing="${n(op.ls)}"` : "";
      return `<text x="${n(op.x)}" y="${n(op.y)}" font-size="${n(op.size * PT)}" font-weight="${op.weight}" fill="${op.color}"${ls}>${esc(op.s)}</text>`;
    }
  }
}

export function pageToSvg(ops: Op[], index: number, total: number): string {
  return (
    `<svg class="invoice-page" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" ` +
    `role="img" aria-label="Halaman ${index + 1} dari ${total}">` +
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>` +
    ops.map(opToSvg).join("") +
    `</svg>`
  );
}
