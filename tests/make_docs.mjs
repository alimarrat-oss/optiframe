// Génère les images du README (pas à pas) et les exemples de sorties (STL, SVG, JSON) pour la paire de démo.
// Usage : node make_docs.mjs ../models/lensunet
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { loadImage, sharp, DEMO } from './load.mjs';
import { analyzePhoto } from '../js/vision/pipeline.js';
import { LensUNet } from '../js/nn/unet.js';
import { MODEL_FRAME } from '../js/vision/rectify.js';
import { bbox } from '../js/vision/geom.js';
import { loadManifold, buildFrame, meshToSTL } from '../js/frame/frame.js';
import { contoursSVG } from '../js/frame/svg.js';
import { readExifFocal35 } from '../js/exif.js';

const base = process.argv[2] || '../models/lensunet';
const man = JSON.parse(readFileSync(base + '.json'));
const wb = readFileSync(base + '.bin');
const net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4));
const DOCS = new URL('../docs/', import.meta.url).pathname;
mkdirSync(DOCS + 'img', { recursive: true });
mkdirSync(DOCS + 'exemples', { recursive: true });

const PW = 420, PH = 300;
const viridis = (v) => {
  const s = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const x = Math.min(0.999, Math.max(0, v)) * 4, i = Math.floor(x), f = x - i;
  return s[i].map((c, k) => Math.round(c + (s[i + 1][k] - c) * f));
};
const rgbaBuf = (d) => Buffer.from(d.buffer, d.byteOffset, d.length);
const toPng = (img) => sharp(rgbaBuf(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();

async function panelsFor(eye, path) {
  const buf = readFileSync(path);
  const exif = readExifFocal35(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const img = await loadImage(path, 3000);
  const r = await analyzePhoto(img, { net, focal35: exif ? exif.focal35 : null });
  if (!r.ok) throw new Error(eye + ' ' + r.error);
  // 1. photo + repères
  const s = PH * 1.6 / img.height;
  const pw = Math.round(img.width * s), ph = Math.round(img.height * s);
  const mk = r.sheet.markers.map((m) => [m.x * s, m.y * s]);
  const svg1 = `<svg width="${pw}" height="${ph}" xmlns="http://www.w3.org/2000/svg"><path d="M${mk.map((p) => p.join(',')).join('L')}Z" fill="none" stroke="#3ddc97" stroke-width="3"/>${mk.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="6" fill="#3ddc97"/><text x="${p[0] + 8}" y="${p[1] - 8}" font-size="16" font-weight="700" fill="#3ddc97" font-family="Arial">${i + 1}</text>`).join('')}</svg>`;
  const p1 = await sharp(await toPng(img)).resize(pw, ph).composite([{ input: Buffer.from(svg1) }]).png().toBuffer();
  // 2. redressée
  const p2 = await sharp(await toPng(r.rect.imageData)).resize(PW, PH).png().toBuffer();
  // 3. probabilité
  const W = MODEL_FRAME.w, H = MODEL_FRAME.h;
  const pd = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const [a, b, c] = viridis(r.prob[i]); pd[4 * i] = a; pd[4 * i + 1] = b; pd[4 * i + 2] = c; pd[4 * i + 3] = 255; }
  const p3 = await sharp(rgbaBuf(pd), { raw: { width: W, height: H, channels: 4 } }).resize(PW, PH).png().toBuffer();
  // 4. contour + boxing
  const sx = PW / W;
  const X = (x) => ((x - MODEL_FRAME.x0) / MODEL_FRAME.res) * sx, Y = (y) => ((y - MODEL_FRAME.y0) / MODEL_FRAME.res) * sx;
  const b = bbox(r.contour);
  const d = 'M' + r.contour.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('L') + 'Z';
  const svg4 = `<svg width="${PW}" height="${PH}" xmlns="http://www.w3.org/2000/svg" font-family="Arial">
    <rect x="${X(b.x0)}" y="${Y(b.y0)}" width="${X(b.x1) - X(b.x0)}" height="${Y(b.y1) - Y(b.y0)}" fill="none" stroke="#ffbe00" stroke-width="1.5" stroke-dasharray="6 4"/>
    <path d="${d}" fill="none" stroke="#ff2d55" stroke-width="2"/>
    <rect x="6" y="6" width="190" height="44" rx="6" fill="rgba(10,25,40,.8)"/>
    <text x="14" y="25" font-size="15" font-weight="700" fill="#fff">A = ${r.measures.A.toFixed(2)} mm</text>
    <text x="14" y="43" font-size="15" font-weight="700" fill="#fff">B = ${r.measures.B.toFixed(2)} mm</text></svg>`;
  const p4 = await sharp(p2).composite([{ input: Buffer.from(svg4) }]).png().toBuffer();
  return { r, panels: [[p1, pw, ph], [p2, PW, PH], [p3, PW, PH], [p4, PW, PH]] };
}

const rows = [];
const results = {};
for (const [eye, path] of [['OD', DEMO.clear], ['OG', DEMO.dark]]) {
  const { r, panels } = await panelsFor(eye, path);
  results[eye] = r;
  rows.push(panels);
}
const titles = ['1. Photo + repères détectés', '2. Vue redressée (0,25 mm/px)', '3. Probabilité « verre » (U-Net)', '4. Contour, boxing, A et B'];
const colW = rows[0].map((p, i) => Math.max(...rows.map((r) => r[i][1])));
const gap = 12, top = 34, rowH = PH * 1.6;
const Wt = colW.reduce((a, b) => a + b, 0) + gap * 5, Ht = top + rows.length * (rowH + gap) + gap;
const comps = [];
let y = top;
for (const row of rows) {
  let x = gap;
  row.forEach(([buf, w, h], i) => { comps.push({ input: buf, left: Math.round(x + (colW[i] - w) / 2), top: Math.round(y + (rowH - h) / 2) }); x += colW[i] + gap; });
  y += rowH + gap;
}
let xx = gap;
const tsvg = `<svg width="${Wt}" height="${top}" xmlns="http://www.w3.org/2000/svg" font-family="Arial" font-size="17" font-weight="700" fill="#12324a">${titles.map((tt, i) => { const tx = xx + colW[i] / 2; xx += colW[i] + gap; return `<text x="${tx}" y="23" text-anchor="middle">${tt}</text>`; }).join('')}</svg>`;
comps.push({ input: Buffer.from(tsvg), left: 0, top: 0 });
await sharp({ create: { width: Wt, height: Ht, channels: 4, background: '#f3f6f8' } }).composite(comps).flatten({ background: '#f3f6f8' }).jpeg({ quality: 82 }).toFile(DOCS + 'img/pas-a-pas.jpg');

// exemples de sorties pour la paire de démo
const wasm = await loadManifold(new URL('../lib/manifold/manifold.js', import.meta.url).href);
const fr = buildFrame(wasm, results.OD.contour, results.OG.contour, {});
writeFileSync(DOCS + 'exemples/monture.stl', Buffer.from(meshToSTL(fr.mesh)));
const items = [['OD', 1], ['OG', -1]].map(([e, n]) => { const b = bbox(results[e].contour); return { label: e === 'OD' ? 'OD (verre droit)' : 'OG (verre gauche)', contour: results[e].contour, A: b.w, B: b.h, nasal: n }; });
writeFileSync(DOCS + 'exemples/contours_OD_OG.svg', contoursSVG(items, 'OptiFrame - contours OD / OG (demo) - echelle 1:1'));
const json = { lenses: {}, frame: { stats: fr.stats, fit: fr.check.map((c) => c && { mean: c.mean, max: c.max }) } };
for (const e of ['OD', 'OG']) {
  const r = results[e];
  json.lenses[e] = { A: r.measures.A, B: r.measures.B, perimeter: r.measures.perimeter, ED: r.measures.ED, pose: { height: r.pose.height, tilt: r.pose.tilt }, parallaxMax: r.parallaxMax, refined: r.refined, timings: r.timings, contour: r.contour.filter((_, i) => i % 4 === 0).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) };
}
writeFileSync(DOCS + 'exemples/mesures_demo.json', JSON.stringify(json, null, 1));
console.log('OD', results.OD.measures.A.toFixed(2), results.OD.measures.B.toFixed(2), '| OG', results.OG.measures.A.toFixed(2), results.OG.measures.B.toFixed(2), '| monture', JSON.stringify(fr.stats), fr.check.map((c) => c && c.mean.toFixed(3)));
