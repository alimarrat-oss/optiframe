// Robustesse sur les photos réelles : la même photo est dégradée de plusieurs façons
// (résolution, rotation dans l'image, exposition, compression, flou) et on mesure la dispersion de A et B.
// Usage : node robustness.mjs models/lensunet  ->  tableau Markdown + JSON (docs/robustesse.json)
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { analyzePhoto } from '../js/vision/pipeline.js';
import { LensUNet } from '../js/nn/unet.js';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = createRequire('/home/claude/dev/')('sharp'); }

const base = process.argv[2] || '../models/lensunet';
const man = JSON.parse(readFileSync(base + '.json'));
const wb = readFileSync(base + '.bin');
const net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4));
const photos = {
  'verre clair (OD)': new URL('../assets/demo/verre_clair_OD.jpg', import.meta.url).pathname,
  'verre teinté (OG)': new URL('../assets/demo/verre_teinte_OG.jpg', import.meta.url).pathname,
};
const variants = [
  ['référence 3000 px', (s) => s],
  ['2200 px', (s) => s.resize({ width: 2200, height: 2200, fit: 'inside' })],
  ['1600 px', (s) => s.resize({ width: 1600, height: 1600, fit: 'inside' })],
  ['rotation +7°', (s) => s.rotate(7, { background: '#333' })],
  ['rotation -12°', (s) => s.rotate(-12, { background: '#333' })],
  ['sous-exposée', (s) => s.linear(0.6, 0)],
  ['surexposée', (s) => s.linear(1.25, 10)],
  ['JPEG q=55', (s) => s.jpeg({ quality: 55 })],
  ['flou léger', (s) => s.blur(1.2)],
];
async function load(path, fn) {
  const buf = await fn(sharp(path)).jpeg({ quality: 92 }).toBuffer();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}
const out = {};
let md = '| Photo | Variante | A (mm) | B (mm) | Périmètre (mm) |\n|---|---|---|---|---|\n';
for (const [pname, path] of Object.entries(photos)) {
  out[pname] = [];
  for (const [vname, fn] of variants) {
    const img = await load(path, fn);
    const r = await analyzePhoto(img, { net, focal35: 24 });
    const row = r.ok ? { variante: vname, A: r.measures.A, B: r.measures.B, P: r.measures.perimeter, ms: r.timings.total } : { variante: vname, erreur: r.error };
    out[pname].push(row);
    md += `| ${pname} | ${vname} | ${r.ok ? r.measures.A.toFixed(2) : '—'} | ${r.ok ? r.measures.B.toFixed(2) : r.error} | ${r.ok ? r.measures.perimeter.toFixed(1) : '—'} |\n`;
    console.error(pname, vname, r.ok ? `${r.measures.A.toFixed(2)} x ${r.measures.B.toFixed(2)}` : r.error);
  }
  const ok = out[pname].filter((x) => x.A);
  const st = (k) => { const v = ok.map((x) => x[k]); const m = v.reduce((a, b) => a + b, 0) / v.length; return { moy: m, et: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), etendue: Math.max(...v) - Math.min(...v) }; };
  out[pname + ' (synthèse)'] = { A: st('A'), B: st('B'), reussite: `${ok.length}/${variants.length}` };
  const sA = st('A'), sB = st('B');
  md += `| **${pname}** | **moyenne ± écart-type (étendue)** | **${sA.moy.toFixed(2)} ± ${sA.et.toFixed(2)} (${sA.etendue.toFixed(2)})** | **${sB.moy.toFixed(2)} ± ${sB.et.toFixed(2)} (${sB.etendue.toFixed(2)})** | ${ok.length}/${variants.length} réussies |\n`;
}
writeFileSync(new URL('../docs/robustesse.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(md);
