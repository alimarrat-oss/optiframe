// Détection automatique des 4 repères de la feuille de capture OptiFrame.
// Repère = carré noir (~6 mm) avec un point blanc au centre ; les centres forment un
// rectangle de 100 x 70 mm (repère 1 en haut à gauche, 2 en haut à droite, 3 en bas à droite,
// 4 en bas à gauche). La bordure de la grille passe par les centres.

import { downscaleGray, boxMean, open, components, bilinear } from './image.js';
import { computeHomography, applyH, inv3 } from './homography.js';

export const SHEET = { W: 100, H: 70, marker: 6.0 };
const CORNERS = [[0, 0], [SHEET.W, 0], [SHEET.W, SHEET.H], [0, SHEET.H]];

function findCandidates(g, winFrac, openR, relThr) {
  const long = Math.max(g.w, g.h);
  const r = Math.max(5, Math.round((winFrac * long) / 2));
  const mean = boxMean(g, r);
  const n = g.w * g.h;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = g.d[i] < relThr * mean[i] ? 1 : 0;
  if (openR > 0) mask = open(mask, g.w, g.h, openR);
  const minA = 25, maxA = 0.02 * n;
  const { lab, comps } = components(mask, g.w, g.h, minA);
  // intensité moyenne de chaque composante
  const sum = new Map();
  for (const c of comps) if (c.area <= maxA) sum.set(c.id, 0);
  for (let i = 0; i < n; i++) { const l = lab[i]; if (l && sum.has(l)) sum.set(l, sum.get(l) + g.d[i]); }
  const out = [];
  for (const c of comps) {
    if (c.area > maxA) continue;
    const tr = c.cxx + c.cyy, det = c.cxx * c.cyy - c.cxy * c.cxy;
    if (det <= 0) continue;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    const iso = l2 / l1;
    const fill = c.area / (12 * Math.sqrt(det));
    if (iso < 0.4 || fill < 0.6 || fill > 1.15) continue;
    const dark = sum.get(c.id) / c.area;
    const paper = mean[Math.round(c.cy) * g.w + Math.round(c.cx)];
    // le centre doit être clair (point blanc)
    let centre = 0;
    for (const [dx, dy] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) centre += bilinear(g, c.cx + dx, c.cy + dy);
    centre /= 5;
    const lightness = (centre - dark) / Math.max(1, paper - dark);
    if (lightness < 0.25) continue;
    const side = Math.sqrt(12 * Math.sqrt(det));
    out.push({ cx: c.cx, cy: c.cy, area: c.area, side, iso, fill, lightness, cxx: c.cxx, cyy: c.cyy, cxy: c.cxy,
      quality: iso * Math.min(1, lightness * 1.5) * (1 - Math.abs(fill - 0.9)) });
  }
  return out;
}

function orderClockwise(pts) {
  const cx = pts.reduce((s, p) => s + p.cx, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.cy, 0) / pts.length;
  return [...pts].sort((a, b) => Math.atan2(a.cy - cy, a.cx - cx) - Math.atan2(b.cy - cy, b.cx - cx));
}

function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.cx - a.cx) * (c.cy - b.cy) - (b.cy - a.cy) * (c.cx - b.cx);
    if (cr === 0) return false;
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

// Forme d'un repère vue dans le repère de la feuille : taille (mm) et rapport d'aspect.
function markerInSheet(Hi2s, m) {
  const e = 1;
  const [x0, y0] = applyH(Hi2s, m.cx, m.cy);
  const [xa, ya] = applyH(Hi2s, m.cx + e, m.cy), [xb, yb] = applyH(Hi2s, m.cx, m.cy + e);
  const J = [xa - x0, xb - x0, ya - y0, yb - y0]; // d(sheet)/d(img)
  // S = J C J^T
  const C = [m.cxx, m.cxy, m.cxy, m.cyy];
  const JC = [J[0] * C[0] + J[1] * C[2], J[0] * C[1] + J[1] * C[3], J[2] * C[0] + J[3] * C[2], J[2] * C[1] + J[3] * C[3]];
  const S = [JC[0] * J[0] + JC[1] * J[1], JC[0] * J[2] + JC[1] * J[3], JC[2] * J[0] + JC[3] * J[1], JC[2] * J[2] + JC[3] * J[3]];
  const tr = S[0] + S[3], det = S[0] * S[3] - S[1] * S[2];
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
  return { side: Math.sqrt(12 * Math.sqrt(Math.max(det, 1e-12))), aspect: Math.sqrt(l1 / l2) };
}

function chooseQuad(cands) {
  let list = [...cands].sort((a, b) => b.quality - a.quality).slice(0, 12);
  let best = null;
  const k = list.length;
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) for (let c = b + 1; c < k; c++) for (let d = c + 1; d < k; d++) {
    const quad = orderClockwise([list[a], list[b], list[c], list[d]]);
    const areas = quad.map((q) => q.area);
    if (Math.max(...areas) / Math.min(...areas) > 5) continue;
    if (!isConvex(quad)) continue;
    for (let rot = 0; rot < 4; rot++) {
      const q = [0, 1, 2, 3].map((i) => quad[(i + rot) % 4]);
      const H = computeHomography(q.map((p) => [p.cx, p.cy]), CORNERS);
      if (!H) continue;
      let cost = 0;
      const sides = [];
      for (const m of q) {
        const s = markerInSheet(H, m);
        sides.push(s.side);
        cost += Math.abs(Math.log(s.aspect)) * 2 + Math.abs(Math.log(s.side / SHEET.marker));
      }
      cost += (1 - q.reduce((s, m) => s + m.quality, 0) / 4) * 0.5;
      if (!best || cost < best.cost - 1e-9) best = { cost, quad: q, H, sides, rot };
    }
  }
  return best;
}

// Encre dans une bande du repère feuille (pour lever l'ambiguïté de 180°).
function inkInBand(g, Hs2i, x0, x1, y0, y1) {
  let n = 0, ink = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const [u, v] = applyH(Hs2i, x, y);
      if (u < 2 || v < 2 || u > g.w - 3 || v > g.h - 3) continue;
      const val = bilinear(g, u, v);
      // papier local : max sur un petit voisinage
      let paper = 0;
      for (const [du, dv] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, 3]]) paper = Math.max(paper, bilinear(g, u + du, v + dv));
      n++;
      if (val < 0.6 * paper) ink++;
    }
  }
  return { n, ink };
}

function orientationScore(g, Hi2s) {
  const Hs2i = inv3(Hi2s);
  // feuille OptiFrame : texte d'instructions sous la grille (16 à 32 mm sous les repères 4-3),
  // espace blanc au-dessus (sauf les numéros).
  const below = inkInBand(g, Hs2i, 5, 95, 86, 102), above = inkInBand(g, Hs2i, 5, 95, -32, -16);
  if (below.n < 200 || above.n < 200) return null;
  return below.ink / below.n - above.ink / above.n;
}

// Barre d'orientation de la feuille v2 (30 x 2,5 mm, 10 à 12,5 mm sous la grille) :
// assombrissement au centre de la bande par rapport au papier juste au-dessus et au-dessous.
function barEvidence(g, Hs2i, yc, yRefA, yRefB) {
  let s = 0, n = 0;
  for (let x = 38; x <= 62; x += 1) {
    const pts = [yc, yRefA, yRefB].map((y) => applyH(Hs2i, x, y));
    if (pts.some(([u, v]) => u < 2 || v < 2 || u > g.w - 3 || v > g.h - 3)) continue;
    const [c, a, b] = pts.map(([u, v]) => bilinear(g, u, v));
    const paper = Math.max(1, (a + b) / 2);
    s += Math.min(1, Math.max(0, (paper - c) / paper));
    n++;
  }
  return n >= 12 ? s / n : null;
}
function barScore(g, Hi2s) {
  const Hs2i = inv3(Hi2s);
  const below = barEvidence(g, Hs2i, 81.25, 77.5, 85.2), above = barEvidence(g, Hs2i, 70 - 81.25, 70 - 77.5, 70 - 85.2);
  if (below == null || above == null) return null;
  return below - above;
}

// Photo très floue : peu de gradients forts dans toute l'image (échelle de travail ~1600 px).
function isBlurry(g) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = 1; y < g.h - 1; y += 2) for (let x = 1; x < g.w - 1; x += 2) {
    const i = y * g.w + x;
    const gx = g.d[i + 1] - g.d[i - 1], gy = g.d[i + g.w] - g.d[i - g.w];
    hist[Math.min(255, Math.round(Math.hypot(gx, gy)))]++; n++;
  }
  let acc = 0, p99 = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.995 * n) { p99 = v; break; } }
  return p99 < 35; // percentile 99,5 du gradient : ~130 net, ~45 limite de détection, < 35 flou
}

// Centre précis d'un repère dans l'image pleine résolution : barycentre du point blanc.
function refineCentre(gray, cx, cy, side) {
  const r = Math.max(4, Math.round(side * 0.75));
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(gray.w - 1, Math.ceil(cx + r)), y1 = Math.min(gray.h - 1, Math.ceil(cy + r));
  const vals = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Math.hypot(x - cx, y - cy) < side * 0.33) vals.push(gray.d[y * gray.w + x]);
  if (vals.length < 9) return { x: cx, y: cy, ok: false };
  vals.sort((a, b) => a - b);
  const dark = vals[Math.floor(vals.length * 0.3)], light = vals[Math.floor(vals.length * 0.99)];
  if (light - dark < 15) return { x: cx, y: cy, ok: false };
  const mid = (dark + light) / 2, half = (light - dark) / 2;
  let mx = cx, my = cy;
  for (let it = 0; it < 4; it++) {
    const rad = it === 0 ? side * 0.33 : side * 0.25;
    let sw = 0, sx = 0, sy = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - mx, y - my) >= rad) continue;
      const w = Math.min(1, Math.max(0, (gray.d[y * gray.w + x] - mid) / half));
      sw += w; sx += w * x; sy += w * y;
    }
    if (sw < 1) return { x: cx, y: cy, ok: false };
    mx = sx / sw; my = sy / sw;
  }
  // netteté : largeur de transition radiale du point (px)
  let blurPx = null;
  {
    const prof = [];
    const R = side * 0.3, step = 0.25;
    for (let t = 0; t <= R; t += step) {
      let s = 0, k = 0;
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * 2 * Math.PI;
        s += bilinear(gray, mx + t * Math.cos(ang), my + t * Math.sin(ang)); k++;
      }
      prof.push(s / k);
    }
    const hi = Math.max(...prof.slice(0, 3)), lo = Math.min(...prof.slice(-4));
    if (hi - lo > 15) {
      const at = (lev) => { for (let i = 1; i < prof.length; i++) if (prof[i] <= lev) return (i - 1 + (prof[i - 1] - lev) / (prof[i - 1] - prof[i] + 1e-9)) * step; return null; };
      const t25 = at(lo + 0.75 * (hi - lo)), t75 = at(lo + 0.25 * (hi - lo));
      if (t25 != null && t75 != null) blurPx = Math.max(0, t75 - t25);
    }
  }
  return { x: mx, y: my, ok: true, blurPx };
}

/**
 * Détecte la feuille. gray : image pleine résolution en niveaux de gris.
 * Renvoie { ok, H (image->feuille), Hs2i, markers:[{x,y}], ... } ou { ok:false, reason }.
 */
export function detectSheet(gray, opts = {}) {
  const target = opts.workSize || 1600;
  const long = Math.max(gray.w, gray.h);
  const factor = Math.max(1, long / target);
  const g = downscaleGray(gray, factor);
  const tries = [[0.06, 1, 0.72], [0.1, 1, 0.72], [0.06, 2, 0.75], [0.035, 1, 0.75], [0.12, 2, 0.8], [0.06, 0, 0.7], [0.16, 3, 0.8]];
  let best = null, nCand = 0;
  for (const [wf, or, thr] of tries) {
    const cands = findCandidates(g, wf, or, thr);
    nCand = Math.max(nCand, cands.length);
    if (cands.length < 4) continue;
    const q = chooseQuad(cands);
    if (q && (!best || q.cost < best.cost)) best = q;
    if (best && best.cost < 1.0) break;
  }
  if (!best) return { ok: false, reason: isBlurry(g) ? 'blurry' : nCand === 0 ? 'no-markers' : 'markers-missing', found: nCand };
  if (best.cost > 3.5) return { ok: false, reason: 'markers-inconsistent', found: nCand };

  // ambiguïté de 180° : 1) barre d'orientation (feuille v2) ; 2) feuille tenue à l'endroit dans la
  // photo (repères 1-2 en haut) ; 3) mise en page (texte sous la grille) si la feuille est tournée de ~90°.
  let quad = best.quad;
  let orientation, flip = false;
  const bar = barScore(g, best.H);
  const mid12 = [(quad[0].cx + quad[1].cx) / 2, (quad[0].cy + quad[1].cy) / 2];
  const mid34 = [(quad[2].cx + quad[3].cx) / 2, (quad[2].cy + quad[3].cy) / 2];
  const dy = mid12[1] - mid34[1], dist = Math.hypot(mid12[0] - mid34[0], dy);
  if (bar != null && Math.abs(bar) > 0.25) { orientation = 'bar'; flip = bar < 0; }
  else if (Math.abs(dy) > 0.5 * dist) { orientation = 'upright'; flip = dy > 0; }
  else {
    const Hflip = computeHomography([2, 3, 0, 1].map((i) => [quad[i].cx, quad[i].cy]), CORNERS);
    const s0 = orientationScore(g, best.H), s1 = orientationScore(g, Hflip);
    orientation = 'layout';
    flip = s0 != null && s1 != null ? s1 > s0 : dy > 0;
  }
  if (flip) quad = [2, 3, 0, 1].map((i) => quad[i]);

  // raffinement pleine résolution
  const markers = quad.map((m) => {
    const r = refineCentre(gray, m.cx * factor, m.cy * factor, m.side * factor);
    return { x: r.x, y: r.y, refined: r.ok, blurPx: r.blurPx, sidePx: m.side * factor };
  });
  const H = computeHomography(markers.map((m) => [m.x, m.y]), CORNERS);
  const Hs2i = inv3(H);
  // taille des repères dans la feuille (contrôle)
  const sides = quad.map((m) => markerInSheet(H, { ...m, cx: m.cx * factor, cy: m.cy * factor, cxx: m.cxx * factor * factor, cyy: m.cyy * factor * factor, cxy: m.cxy * factor * factor }).side);
  return { ok: true, H, Hs2i, markers, cost: best.cost, orientation, flipped: flip, markerSidesMm: sides, workFactor: factor };
}
