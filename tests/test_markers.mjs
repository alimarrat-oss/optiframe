import { loadImage, DEMO } from './load.mjs';
import { toGray } from '../js/vision/image.js';
import { detectSheet } from '../js/vision/markers.js';
const files = DEMO;
for (const [name, f] of Object.entries(files)) {
  for (const maxLong of [0, 3000, 1920]) {
    const img = await loadImage(f, maxLong);
    const t0 = performance.now();
    const g = toGray(img);
    const r = detectSheet(g);
    const t1 = performance.now();
    const sc = maxLong ? 5712 / Math.max(img.width, img.height) : 1;
    console.log(name, img.width + 'x' + img.height, r.ok, r.reason || '', 'cost', r.cost?.toFixed(3), r.orientation, 'flip', r.flipped, (t1 - t0).toFixed(0) + 'ms');
    if (r.ok) console.log('   markers (full-res px):', r.markers.map(m => `(${(m.x * sc).toFixed(2)},${(m.y * sc).toFixed(2)}) blur ${(m.blurPx ?? NaN).toFixed(2)}`).join(' '), ' sides mm', r.markerSidesMm.map(s => s.toFixed(2)).join(','));
  }
}
