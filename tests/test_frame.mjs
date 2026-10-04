import { writeFileSync } from 'fs';
import { loadManifold, buildFrame, meshToSTL } from '../js/frame/frame.js';
const wasm = await loadManifold(new URL('../lib/manifold/manifold.js', import.meta.url).href);
const ellipse = (a, b, cx = 50, cy = 35, n = 400) => Array.from({ length: n }, (_, i) => [cx + a * Math.cos(2 * Math.PI * i / n), cy + b * Math.sin(2 * Math.PI * i / n)]);
// verre « aviateur » : rayon modulé
const avi = (n = 400) => Array.from({ length: n }, (_, i) => { const t = 2 * Math.PI * i / n; const r = 1 + 0.18 * Math.max(0, Math.cos(t - 2.3)) ** 2; return [50 + 27 * r * Math.cos(t), 35 + 20 * r * Math.sin(t)]; });
for (const [name, od, og] of [['ellipses', ellipse(25, 18), ellipse(25, 18)], ['mixed', ellipse(26, 19), avi()]]) {
  const t0 = performance.now();
  const r = buildFrame(wasm, od, og, {});
  const t1 = performance.now();
  console.log(name, JSON.stringify(r.stats), 'time', (t1 - t0).toFixed(0), 'ms');
  console.log('  check', r.check.map(c => c && `mean ${c.mean.toFixed(3)} min ${c.min.toFixed(3)} max ${c.max.toFixed(3)}`).join(' | '));
  writeFileSync(`${process.env.OUT || '/tmp'}/${name}.stl`, Buffer.from(meshToSTL(r.mesh)));
}
