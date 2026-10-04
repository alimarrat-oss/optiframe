// Messages d'erreur : photo floue, repères hors cadre, repère masqué (variantes générées à la volée).
// Usage : node test_errors.mjs ../models/lensunet
import { readFileSync } from 'fs';
import { sharp, DEMO } from './load.mjs';
import { analyzePhoto } from '../js/vision/pipeline.js';
import { LensUNet } from '../js/nn/unet.js';

const base = process.argv[2] || '../models/lensunet';
const man = JSON.parse(readFileSync(base + '.json'));
const wb = readFileSync(base + '.bin');
const net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4));
const meta = await sharp(DEMO.dark).metadata();
const W = meta.width, H = meta.height;
const cases = [
  ['flou léger (σ 2 px)', (s) => s.blur(2), 'ok'],
  ['flou fort (σ 8 px)', (s) => s.blur(8), 'blurry'],
  ['cadrage serré sans repères', (s) => s.extract({ left: Math.round(W * 0.25), top: Math.round(H * 0.42), width: Math.round(W * 0.5), height: Math.round(H * 0.2) }), 'markers-missing'],
  ['repère 3 masqué', (s) => s.composite([{ input: { create: { width: 300, height: 240, channels: 3, background: '#3c3c3c' } }, left: 1350, top: 1560 }]), 'markers-inconsistent'],
];
let fail = 0;
for (const [name, fn, expected] of cases) {
  const buf = await fn(sharp(DEMO.dark)).jpeg({ quality: 92 }).toBuffer();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = await analyzePhoto({ width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }, { net, focal35: 24 });
  const got = r.ok ? 'ok' : r.error;
  const pass = got === expected;
  if (!pass) fail++;
  console.log(pass ? '✓' : '✗', name.padEnd(30), '→', got, r.ok ? `(A ${r.measures.A.toFixed(2)} B ${r.measures.B.toFixed(2)}, ${r.warnings.join(',')})` : '');
}
process.exit(fail ? 1 : 0);
