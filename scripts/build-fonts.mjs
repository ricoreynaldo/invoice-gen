// Konversi Inter WOFF (dari @fontsource/inter) ke TTF di public/fonts.
// jsPDF hanya menerima TTF, dan preview memakai file yang sama supaya
// metrik huruf di layar dan di PDF identik.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@fontsource/inter/package.json"));
const outDir = new URL("../public/fonts/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const WEIGHTS = [300, 400, 600, 700, 800];

function woffToSfnt(woff) {
  if (woff.toString("ascii", 0, 4) !== "wOFF") throw new Error("Bukan file WOFF");
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    const tag = woff.readUInt32BE(p);
    const offset = woff.readUInt32BE(p + 4);
    const compLength = woff.readUInt32BE(p + 8);
    const origLength = woff.readUInt32BE(p + 12);
    const checksum = woff.readUInt32BE(p + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => a.tag - b.tag);

  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;

  const headerSize = 12 + numTables * 16;
  let size = headerSize;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = Buffer.alloc(size);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);

  let offset = headerSize;
  tables.forEach((t, i) => {
    const p = 12 + i * 16;
    out.writeUInt32BE(t.tag, p);
    out.writeUInt32BE(t.checksum, p + 4);
    out.writeUInt32BE(offset, p + 8);
    out.writeUInt32BE(t.data.length, p + 12);
    t.data.copy(out, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}

for (const w of WEIGHTS) {
  const src = join(pkgDir, "files", `inter-latin-${w}-normal.woff`);
  const ttf = woffToSfnt(readFileSync(src));
  writeFileSync(new URL(`inter-${w}.ttf`, outDir), ttf);
  console.log(`inter-${w}.ttf  ${(ttf.length / 1024).toFixed(1)} KB`);
}
