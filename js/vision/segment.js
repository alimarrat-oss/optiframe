// Segmentation du verre dans l'image redressée + extraction du contour (mm).
import { components, dilate, erode } from './image.js';

const NRAYS = 720;

export function sigmoidInPlace(a) {
  for (let i = 0; i < a.length; i++) a[i] = 1 / (1 + Math.exp(-a[i]));
  return a;
}

// Segmentation « classique » (sans IA) : verre plus sombre que le papier.
// Sert de repli et de point de comparaison dans le README.
export function classicalProb(imageData) {
  const { width: w, height: h, data } = imageData;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // fermeture 3x3 : efface les traits fins de la grille
  const mx = maxFilter(g, w, h, 1), cl = minFilter(mx, w, h, 1);
  // niveau du papier : maximum local large (~6 mm) puis lissage
  const paper = boxBlur(maxFilter(cl, w, h, 12), w, h, 12);
  const p = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const n = cl[i] / Math.max(1, paper[i]);
    p[i] = Math.min(1, Math.max(0, (0.82 - n) / 0.2));
  }
  return p;
}

function maxFilter(a, w, h, r) { return rankFilter(a, w, h, r, true); }
function minFilter(a, w, h, r) { return rankFilter(a, w, h, r, false); }
function rankFilter(a, w, h, r, isMax) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  const f = isMax ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = a[y * w + x];
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) v = f(v, a[y * w + xx]); }
    t[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = t[y * w + x];
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) v = f(v, t[yy * w + x]); }
    o[y * w + x] = v;
  }
  return o;
}
function boxBlur(a, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w && x + r >= 0) { s += a[y * w + x + r]; n++; }
      if (x - r - 1 >= 0 && x - r - 1 < w) { s -= a[y * w + x - r - 1]; n--; }
      if (x >= 0 && x < w) t[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h && y + r >= 0) { s += t[(y + r) * w + x]; n++; }
      if (y - r - 1 >= 0 && y - r - 1 < h) { s -= t[(y - r - 1) * w + x]; n--; }
      if (y >= 0 && y < h) o[y * w + x] = s / n;
    }
  }
  return o;
}

// Choisit la composante « verre » et bouche ses trous (reflets).
export function selectLens(prob, frame) {
  const { w, h, x0, y0, res } = frame;
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = prob[i] >= 0.5 ? 1 : 0;
  // ignorer les coins (repères)
  const toPx = (X, Y) => [(X - x0) / res - 0.5, (Y - y0) / res - 0.5];
  for (const [mx, my] of [[0, 0], [100, 0], [100, 70], [0, 70]]) {
    const [cx, cy] = toPx(mx, my), r = 5 / res;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r); x++) bin[y * w + x] = 0;
  }
  const { lab, comps } = components(bin, w, h, 20);
  if (!comps.length) return null;
  let best = null;
  for (const c of comps) {
    const bw = (c.x1 - c.x0 + 1) * res, bh = (c.y1 - c.y0 + 1) * res;
    const touches = c.x0 <= 0 || c.y0 <= 0 || c.x1 >= w - 1 || c.y1 >= h - 1;
    const score = c.area * (touches ? 0.3 : 1) * (Math.min(bw, bh) < 10 ? 0.1 : 1);
    if (!best || score > best.score) best = { ...c, score, touches, bw, bh };
  }
  // remplissage des trous : tout ce qui n'est pas atteint depuis le bord est « dedans »
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = lab[i] === best.id ? 1 : 0;
  const reach = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (reach[p] || inside[p]) continue;
    reach[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
  }
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (!reach[i]) filled[i] = 1;
  // ouverture (~0,75 mm) : coupe les excroissances fines (ombres, reflets accolés au verre)
  const opened = dilate(erode(filled, w, h, 3), w, h, 3);
  const cc = components(opened, w, h, 20);
  if (cc.comps.length) {
    const big = cc.comps.reduce((m, c) => (c.area > m.area ? c : m));
    if (big.area > 0.5 * cc.comps.reduce((s, c) => s + c.area, 0)) {
      filled = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (cc.lab[i] === big.id) filled[i] = 1;
    }
  }
  let a = 0, sx = 0, sy = 0;
  for (let i = 0; i < w * h; i++) if (filled[i]) { a++; sx += i % w; sy += (i / w) | 0; }
  return { mask: filled, area: a, cx: sx / a, cy: sy / a, touches: best.touches, bw: best.bw, bh: best.bh };
}

// Filtre médian circulaire (supprime les pointes étroites du rayon r(θ)).
function medianCircular(r, half) {
  const n = r.length, out = new Float32Array(n), win = [];
  for (let k = 0; k < n; k++) {
    win.length = 0;
    for (let j = -half; j <= half; j++) win.push(r[(k + j + n) % n]);
    win.sort((a, b) => a - b);
    out[k] = win[half];
  }
  return out;
}

function bil(a, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const ix = Math.min(w - 2, x | 0), iy = Math.min(h - 2, y | 0), fx = x - ix, fy = y - iy;
  const i = iy * w + ix;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + w] * (1 - fx) + a[i + w + 1] * fx) * fy;
}

/**
 * Contour polaire sous-pixel : pour 720 directions depuis le centre du verre, dernier passage
 * de la probabilité sous 0,5. Renvoie { pts: [[X,Y] mm], r, cx, cy (mm), sharp: pente moyenne }.
 */
export function polarContour(prob, sel, frame) {
  const { w, h, x0, y0, res } = frame;
  const near = dilate(sel.mask, w, h, 3);
  const pm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) pm[i] = near[i] ? prob[i] : 0;
  const cx = sel.cx, cy = sel.cy;
  const rmax = Math.hypot(w, h);
  const step = 0.2;
  const r = new Float32Array(NRAYS), slope = new Float32Array(NRAYS);
  let miss = 0;
  for (let k = 0; k < NRAYS; k++) {
    const th = (k / NRAYS) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
    let prev = bil(pm, w, h, cx, cy), last = -1, lastSlope = 0;
    for (let t = step; t < rmax; t += step) {
      const x = cx + t * ux, y = cy + t * uy;
      if (x < 0 || y < 0 || x > w - 1 || y > h - 1) break;
      const v = bil(pm, w, h, x, y);
      if (prev >= 0.5 && v < 0.5) { last = t - step + (step * (prev - 0.5)) / (prev - v + 1e-9); lastSlope = (prev - v) / step; }
      prev = v;
    }
    if (last < 0) { miss++; last = k ? r[k - 1] : 0; }
    r[k] = last; slope[k] = lastSlope;
  }
  const rm = medianCircular(r, 5);
  const pts = [];
  for (let k = 0; k < NRAYS; k++) {
    const th = (k / NRAYS) * 2 * Math.PI;
    const px = cx + rm[k] * Math.cos(th), py = cy + rm[k] * Math.sin(th);
    pts.push([x0 + (px + 0.5) * res, y0 + (py + 0.5) * res]);
  }
  let ms = 0; for (let k = 0; k < NRAYS; k++) ms += slope[k];
  return { pts, centre: [x0 + (cx + 0.5) * res, y0 + (cy + 0.5) * res], sharp: ms / NRAYS / res, miss };
}
