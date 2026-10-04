// Évaluation sur les 2 photos réelles : silhouette (avant parallaxe) comparée à une référence
// photographique indépendante de l'IA :
//  - verre teinté : bord net raffiné sur l'image pleine résolution (chaîne classique + raffinement) ;
//  - verre clair  : continuité des traits de la grille (training/grid_reference.py).
// Usage : node eval_real.mjs ../models/lensunet [ref.json]
import { readFileSync, writeFileSync } from 'fs';
import { loadImage, DEMO } from './load.mjs';
import { analyzePhoto } from '../js/vision/pipeline.js';
import { LensUNet } from '../js/nn/unet.js';
import { bbox } from '../js/vision/geom.js';
import { readExifFocal35 } from '../js/exif.js';

const base = process.argv[2] || '../models/lensunet';
const refPath = process.argv[3] || new URL('../docs/reference_photos.json', import.meta.url).pathname;
const man = JSON.parse(readFileSync(base + '.json'));
const wb = readFileSync(base + '.bin');
const net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4));
let ref = {};
try { ref = JSON.parse(readFileSync(refPath)); } catch (e) { /* pas encore de référence */ }
const out = {};
for (const [name, path] of Object.entries(DEMO)) {
  const buf = readFileSync(path);
  const ex = readExifFocal35(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const img = await loadImage(path, 3000);
  const r = await analyzePhoto(img, { net, focal35: ex ? ex.focal35 : null });
  const s = bbox(r.rawContour);
  const o = { A_sil: s.w, B_sil: s.h, A: r.measures.A, B: r.measures.B, parallaxMax: r.parallaxMax, refined: r.refined, tilt: r.pose.tilt, ms: r.timings.total };
  if (ref[name]) o.ref = { A_sil: ref[name].A_ref_silhouette, B_sil: ref[name].B_ref_silhouette, methode: ref[name].methode };
  if (o.ref) { o.errA = o.A_sil - o.ref.A_sil; o.errB = o.ref.B_sil != null ? o.B_sil - o.ref.B_sil : null; }
  out[name] = o;
  console.log(name, `silhouette A ${o.A_sil.toFixed(2)} B ${o.B_sil.toFixed(2)}`, o.ref ? `| réf A ${o.ref.A_sil.toFixed(2)} B ${o.ref.B_sil != null ? o.ref.B_sil.toFixed(2) : '–'} | écart A ${o.errA.toFixed(2)} B ${o.errB != null ? o.errB.toFixed(2) : '–'}` : '', `| final A ${o.A.toFixed(2)} B ${o.B.toFixed(2)} (parallaxe max ${o.parallaxMax.toFixed(2)}, ${Math.round(o.ms)} ms)`);
}
writeFileSync(new URL('../docs/eval_reelle.json', import.meta.url), JSON.stringify(out, null, 1));
