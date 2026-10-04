// Raffinement du contour d'un verre CLAIR par la continuité des traits de la grille.
// Hors du verre, un trait de grille est droit. À l'entrée dans le verre (biseau, réfraction), il se
// décale ou disparaît. Dans une ombre portée, il reste droit (seulement plus sombre) : ce critère
// distingue l'ombre du verre, ce que l'intensité seule ne fait pas. Les points obtenus corrigent
// localement le contour de l'IA (interpolation circulaire des écarts).
import { bilinear } from './image.js';
import { solveLinear } from './homography.js';

const STEP = 0.1;     // pas de suivi le long du trait (mm)
const TOL = 0.12;     // écart à la droite qui signale l'entrée dans le verre (mm)

function sampler(gray, Hs2i) {
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = Hs2i;
  return (X, Y) => {
    const w = h6 * X + h7 * Y + h8;
    return bilinear(gray, (h0 * X + h1 * Y + h2) / w, (h3 * X + h4 * Y + h5) / w);
  };
}

// minimum local d'un profil (position sous-pixel et profondeur)
function profileMin(S, axis, fixed, centre, half, step = 0.04, avg = 0.06) {
  const n = Math.round((2 * half) / step) + 1;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = centre - half + i * step;
    v[i] = axis === 'h'
      ? (S(fixed - avg, t) + S(fixed, t) + S(fixed + avg, t)) / 3
      : (S(t, fixed - avg) + S(t, fixed) + S(t, fixed + avg)) / 3;
  }
  // retrait de la tendance linéaire (bord d'ombre qui traverse la fenêtre en biais)
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += v[i]; sxx += i * i; sxy += i * v[i]; }
  const sl = (n * sxy - sx * sy) / (n * sxx - sx * sx), ic = (sy - sl * sx) / n;
  for (let i = 0; i < n; i++) v[i] -= sl * i + ic;
  let k = 0;
  for (let i = 1; i < n; i++) if (v[i] < v[k]) k = i;
  const sorted = Array.from(v).sort((a, b) => a - b);
  const med = sorted[n >> 1];
  let off = 0;
  if (k > 0 && k < n - 1) { const a = v[k - 1], b = v[k], c = v[k + 1]; const den = a - 2 * b + c; if (den > 1e-9) off = (0.5 * (a - c)) / den; }
  return { pos: centre - half + (k + off) * step, depth: med - v[k] };
}

// positions des traits de grille (mm) dans une bande hors du verre
function linePositions(S, axis, lo, hi, from, to) {
  const step = 0.05, n = Math.round((to - from) / step);
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = from + i * step;
    let s = 0, m = 0;
    for (let u = lo; u <= hi; u += 0.5) { s += axis === 'h' ? S(u, t) : S(t, u); m++; }
    p[i] = s / m;
  }
  const r = 30, base = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0, m = 0; for (let j = Math.max(0, i - r); j < Math.min(n, i + r + 1); j++) { s += p[j]; m++; } base[i] = s / m; }
  const d = p.map((v, i) => base[i] - v);
  const out = [];
  for (let i = 6; i < n - 6; i++) {
    let isMax = d[i] > 5;
    for (let j = i - 6; j <= i + 6 && isMax; j++) if (d[j] > d[i]) isMax = false;
    if (isMax) { out.push(from + i * step); i += 40; }
  }
  return out;
}

// suit un trait depuis l'extérieur ; renvoie la coordonnée d'entrée dans le verre, ou null
function track(S, axis, pos, start, dir, maxLen) {
  const pts = [];
  for (let s = 0; s <= maxLen; s += STEP) {
    const t = start + dir * s;
    const m = axis === 'h' ? profileMin(S, 'h', t, pos, 0.8) : profileMin(S, 'v', t, pos, 0.8);
    pts.push([t, m.pos, m.depth]);
  }
  const n0 = Math.round(2.4 / STEP);
  if (pts.length < n0 + 5) return null;
  // droite ajustée sur la partie extérieure
  let sx = 0, sy = 0, sxx = 0, sxy = 0, d0 = 0;
  for (let i = 0; i < n0; i++) { const [x, y, d] = pts[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; d0 += d; }
  d0 /= n0;
  if (d0 < 4) return null; // trait trop peu contrasté
  const den = n0 * sxx - sx * sx;
  const a = den ? (n0 * sxy - sx * sy) / den : 0, b = (sy - a * sx) / n0;
  let res = 0;
  for (let i = 0; i < n0; i++) res += (pts[i][1] - (a * pts[i][0] + b)) ** 2;
  if (Math.sqrt(res / n0) > 0.06) return null; // trait déjà perturbé : point non fiable
  const bad = pts.map(([x, y, d]) => Math.abs(y - (a * x + b)) > TOL || d < 0.15 * d0);
  for (let i = n0; i < pts.length - 2; i++) {
    if (bad[i] && bad[i + 1] && bad[i + 2]) return { t: pts[i][0] - dir * STEP / 2, p: a * pts[i][0] + b };
  }
  return null;
}

/**
 * pts : contour IA (mm, repère feuille, 720 points), centre : [cx, cy].
 * Renvoie { pts, used, points } ; pts inchangé si les indices de grille sont insuffisants.
 */
export function gridRefine(gray, Hs2i, pts, centre) {
  const S = sampler(gray, Hs2i);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  // bandes de référence hors du verre
  const hl = x0 > 8 ? linePositions(S, 'h', 1.5, Math.min(6.5, x0 - 2), 1, 69) : x1 < 92 ? linePositions(S, 'h', Math.max(93.5, x1 + 2), 98.5, 1, 69) : [];
  const vl = y0 > 8 ? linePositions(S, 'v', 1.5, Math.min(6.5, y0 - 2), 1, 99) : y1 < 62 ? linePositions(S, 'v', Math.max(63.5, y1 + 2), 68.5, 1, 99) : [];
  const found = [];
  const crossings = (axis, v) => {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ca = axis === 'h' ? a[1] : a[0], cb = axis === 'h' ? b[1] : b[0];
      if ((ca - v) * (cb - v) <= 0 && ca !== cb) { const f = (v - ca) / (cb - ca); xs.push(axis === 'h' ? a[0] + f * (b[0] - a[0]) : a[1] + f * (b[1] - a[1])); }
    }
    return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
  };
  for (const y of hl) {
    if (y < y0 + 1.5 || y > y1 - 1.5) continue; // trait presque tangent au verre : peu fiable
    const c = crossings('h', y);
    if (!c) continue;
    const L = track(S, 'h', y, c[0] - 4.0, +1, 6.5); if (L) found.push([L.t, L.p]);
    const R = track(S, 'h', y, c[1] + 4.0, -1, 6.5); if (R) found.push([R.t, R.p]);
  }
  for (const x of vl) {
    if (x < x0 + 1.5 || x > x1 - 1.5) continue;
    const c = crossings('v', x);
    if (!c) continue;
    const T = track(S, 'v', x, c[0] - 4.0, +1, 6.5); if (T) found.push([T.p, T.t]);
    const B = track(S, 'v', x, c[1] + 4.0, -1, 6.5); if (B) found.push([B.p, B.t]);
  }
  // écarts radiaux par rapport au contour IA
  const n = pts.length;
  const angAI = pts.map(([x, y]) => Math.atan2(y - centre[1], x - centre[0]));
  const rAI = pts.map(([x, y]) => Math.hypot(x - centre[0], y - centre[1]));
  const rAt = (th) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(((angAI[i] - th + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < bd) { bd = d; best = i; } }
    return rAI[best];
  };
  let P = found.map(([x, y]) => { const th = Math.atan2(y - centre[1], x - centre[0]); return { th, dev: Math.hypot(x - centre[0], y - centre[1]) - rAt(th), x, y }; });
  // rejet des aberrants (cohérence avec les voisins angulaires) et des écarts excessifs
  P = P.filter((p) => Math.abs(p.dev) < 2.0);
  const keep = P.filter((p) => {
    const nb = P.filter((q) => q !== p).map((q) => ({ q, d: Math.abs(((q.th - p.th + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) })).sort((a, b) => a.d - b.d).slice(0, 4).map((o) => o.q.dev).sort((a, b) => a - b);
    if (nb.length < 3) return false;
    const med = nb[nb.length >> 1];
    return Math.abs(p.dev - med) < 0.6;
  });
  const quads = new Set(keep.map((p) => Math.floor(((p.th + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2))));
  if (keep.length < 12 || quads.size < 4) return { pts, used: false, points: keep };
  // modèle d'écart à basse fréquence (constante + harmoniques 1 et 2), ajusté de façon robuste (IRLS) :
  // corrige un débordement global ou d'un côté (ombre incluse) sans créer de pointe locale.
  const basis = (th) => [1, Math.cos(th), Math.sin(th), Math.cos(2 * th), Math.sin(2 * th)];
  let coef = [0, 0, 0, 0, 0];
  const wts = keep.map(() => 1);
  for (let it = 0; it < 6; it++) {
    const A = Array.from({ length: 5 }, () => new Array(5).fill(0)), b = new Array(5).fill(0);
    keep.forEach((p, k) => {
      const f = basis(p.th), w = wts[k];
      for (let i = 0; i < 5; i++) { b[i] += w * f[i] * p.dev; for (let j = 0; j < 5; j++) A[i][j] += w * f[i] * f[j]; }
    });
    for (let i = 0; i < 5; i++) A[i][i] += 1e-3; // régularisation légère
    const sol = solveLinear(A, b);
    if (!sol) return { pts, used: false, points: keep };
    coef = sol;
    keep.forEach((p, k) => { const r = p.dev - basis(p.th).reduce((s2, f, i) => s2 + f * coef[i], 0); wts[k] = Math.abs(r) < 0.25 ? 1 : 0.25 / Math.abs(r); });
  }
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) sm[i] = Math.max(-1.0, Math.min(1.0, basis(angAI[i]).reduce((s2, f, j) => s2 + f * coef[j], 0)));
  const out = pts.map(([x, y], i) => {
    const r = rAI[i] + sm[i];
    return [centre[0] + r * Math.cos(angAI[i]), centre[1] + r * Math.sin(angAI[i])];
  });
  return { pts: out, used: true, points: keep, meanAbsCorr: sm.reduce((s, v) => s + Math.abs(v), 0) / n };
}
