// Raffinement sous-pixel du contour sur l'image source pleine résolution.
// Le contour de l'IA (0,25 mm/px) guide la recherche ; pour chaque rayon, on cherche le front
// d'intensité le plus net (verre sombre -> papier clair) dans une fenêtre de +/- 1 mm.
// Appliqué seulement là où le contraste intérieur/extérieur est franc (verres teintés) :
// pour un verre clair, la frontière ne se lit pas sur l'intensité et on garde celle de l'IA.
import { bilinear } from './image.js';

export function refineEdges(gray, Hs2i, pts, centre, opts = {}) {
  const win = opts.win || 1.0, step = 0.04, sigma = 0.06;
  const n = pts.length;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = Hs2i;
  const ns = Math.round((2 * win) / step) + 1;
  const prof = new Float64Array(ns), sm = new Float64Array(ns);
  const kr = Math.ceil((3 * sigma) / step), ker = [];
  let ks = 0;
  for (let i = -kr; i <= kr; i++) { const v = Math.exp(-((i * step) ** 2) / (2 * sigma * sigma)); ker.push(v); ks += v; }
  const shifts = new Float64Array(n);
  const valid = new Uint8Array(n);
  let paper = 0, np = 0;
  for (let k = 0; k < n; k++) {
    const [px, py] = pts[k];
    let ux = px - centre[0], uy = py - centre[1];
    const r0 = Math.hypot(ux, uy);
    if (r0 < 1) continue;
    ux /= r0; uy /= r0;
    for (let i = 0; i < ns; i++) {
      const r = r0 - win + i * step;
      const X = centre[0] + r * ux, Y = centre[1] + r * uy;
      const w = h6 * X + h7 * Y + h8;
      prof[i] = bilinear(gray, (h0 * X + h1 * Y + h2) / w, (h3 * X + h4 * Y + h5) / w);
    }
    for (let i = 0; i < ns; i++) {
      let s = 0, ww = 0;
      for (let j = -kr; j <= kr; j++) { const q = i + j; if (q < 0 || q >= ns) continue; s += prof[q] * ker[j + kr]; ww += ker[j + kr]; }
      sm[i] = s / ww;
    }
    const inside = sm[2], outside = sm[ns - 3];
    paper += outside; np++;
    const contrast = outside - inside;
    if (contrast < (opts.minContrast || 45)) continue;
    // front montant le plus fort
    let best = -1, bv = 0;
    for (let i = 1; i < ns - 1; i++) {
      const d = sm[i + 1] - sm[i - 1];
      if (d > bv) { bv = d; best = i; }
    }
    if (best < 2 || best > ns - 3) continue;
    // la marche doit représenter l'essentiel du contraste (pas un petit reflet)
    if (bv / (2 * step) * 0.3 < contrast * 0.35) continue;
    const dm = sm[best] - sm[best - 2], dp = sm[best + 2] - sm[best];
    const d0 = sm[best + 1] - sm[best - 1];
    const den = dm - 2 * d0 + dp;
    const off = den !== 0 ? Math.max(-1, Math.min(1, (0.5 * (dm - dp)) / den)) : 0;
    shifts[k] = -win + (best + off) * step;
    valid[k] = 1;
  }
  // filtrage médian circulaire des décalages valides (robustesse aux reflets)
  const out = [];
  let used = 0;
  const half = 6;
  for (let k = 0; k < n; k++) {
    const vals = [];
    for (let j = -half; j <= half; j++) { const q = (k + j + n) % n; if (valid[q]) vals.push(shifts[q]); }
    let d = 0;
    if (vals.length >= half) { vals.sort((a, b) => a - b); d = vals[vals.length >> 1]; used++; }
    const [px, py] = pts[k];
    let ux = px - centre[0], uy = py - centre[1];
    const r0 = Math.hypot(ux, uy) || 1;
    out.push([px + (ux / r0) * d, py + (uy / r0) * d]);
  }
  return { pts: out, fraction: used / n };
}
