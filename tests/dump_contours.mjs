import { readFileSync, writeFileSync } from 'fs';
import { loadImage, DEMO } from './load.mjs';
import { analyzePhoto } from '../js/vision/pipeline.js';
import { LensUNet } from '../js/nn/unet.js';
const files = DEMO;
const modelBase = process.argv[2] && process.argv[2] !== 'none' ? process.argv[2] : null;
let net = null;
if (modelBase) { const man = JSON.parse(readFileSync(modelBase + '.json')); const wb = readFileSync(modelBase + '.bin'); net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4)); }
const out = {};
for (const [name, f] of Object.entries(files)) {
  const img = await loadImage(f, 3000);
  const r = await analyzePhoto(img, { net, focal35: 24 });
  out[name] = r.ok ? { ok: true, ai: r.aiContour, raw: r.rawContour, final: r.contour, m: r.measures, pose: r.pose, refined: r.refined, H: r.sheet.H } : { ok: false, error: r.error };
  if (r.ok) console.log(name, r.method, 'A', r.measures.A.toFixed(2), 'B', r.measures.B.toFixed(2), 'refined', (r.refined * 100).toFixed(0) + '%', 'parallax', r.parallaxMax.toFixed(2));
  else console.log(name, 'fail', r.error);
}
writeFileSync(process.env.OUT_JSON || '/tmp/optiframe-contours.json', JSON.stringify(out));
