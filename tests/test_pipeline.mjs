// Test de bout en bout sur les photos réelles (Node). Usage : node test_pipeline.mjs [modelBase] [maxLong]
import { readFileSync, mkdirSync } from 'fs';
import { loadImage, saveRGBA, DEMO } from './load.mjs';
import { analyzePhoto } from '../js/vision/pipeline.js';
import { LensUNet } from '../js/nn/unet.js';
import { MODEL_FRAME } from '../js/vision/rectify.js';

const files = DEMO;
const modelBase = process.argv[2] && process.argv[2] !== 'none' ? process.argv[2] : null;
const maxLong = +(process.argv[3] || 3000);
let net = null;
if (modelBase) {
  const man = JSON.parse(readFileSync(modelBase + '.json'));
  const wb = readFileSync(modelBase + '.bin');
  net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4));
}
const OUT = process.env.OUT || '/tmp/optiframe-tests';
mkdirSync(OUT, { recursive: true });
for (const [name, f] of Object.entries(files)) {
  const img = await loadImage(f, maxLong);
  const f35 = img.exif?.exif ? null : null;
  const r = await analyzePhoto(img, { net, focal35: 24 });
  if (!r.ok) { console.log(name, 'ECHEC', r.error); continue; }
  const m = r.measures;
  console.log(`${name} [${r.method}] A=${m.A.toFixed(2)} B=${m.B.toFixed(2)} P=${m.perimeter.toFixed(1)} ED=${m.ED.toFixed(2)} | pose H=${r.pose.height.toFixed(0)} tilt=${r.pose.tilt.toFixed(1)} C=(${r.pose.X.toFixed(0)},${r.pose.Y.toFixed(0)}) parallax max ${r.parallaxMax.toFixed(2)} | blur ${r.blurMm?.toFixed(3)} mm | warn ${r.warnings.join(',')} | ${Object.entries(r.timings).map(([k, v]) => k + ' ' + v.toFixed(0)).join(' ')}`);
  // image de contrôle : redressée + contour
  const im = r.rect.imageData;
  const vis = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
  const put = (X, Y, c) => {
    const x = Math.round((X - MODEL_FRAME.x0) / MODEL_FRAME.res - 0.5), y = Math.round((Y - MODEL_FRAME.y0) / MODEL_FRAME.res - 0.5);
    if (x < 0 || y < 0 || x >= im.width || y >= im.height) return;
    const i = (y * im.width + x) * 4; vis.data[i] = c[0]; vis.data[i + 1] = c[1]; vis.data[i + 2] = c[2];
  };
  for (const [x, y] of r.rawContour) put(x, y, [0, 120, 255]);
  for (const [x, y] of r.contour) put(x, y, [255, 0, 0]);
  await saveRGBA(vis, `${OUT}/${name}_${r.method}_contour.png`);
  const pv = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.width * im.height * 4) };
  for (let i = 0; i < im.width * im.height; i++) { const v = r.prob[i] * 255; pv.data[i * 4] = v; pv.data[i * 4 + 1] = v; pv.data[i * 4 + 2] = v; pv.data[i * 4 + 3] = 255; }
  await saveRGBA(pv, `${OUT}/${name}_${r.method}_prob.png`);
}
