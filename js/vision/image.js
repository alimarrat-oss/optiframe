// Outils d'image minimalistes (navigateur et Node). Une image couleur est un objet de type
// ImageData : { width, height, data: Uint8ClampedArray RGBA }. Une image en niveaux de gris
// est { w, h, d: Float32Array }.

export function toGray(img) {
  const { width: w, height: h, data } = img;
  const d = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return { w, h, d };
}

// Réduction par moyenne de zone (facteur réel >= 1).
export function downscaleGray(g, factor) {
  if (factor <= 1.0001) return g;
  const w = Math.max(1, Math.round(g.w / factor)), h = Math.max(1, Math.round(g.h / factor));
  const fx = g.w / w, fy = g.h / h;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y * fy, y1 = (y + 1) * fy;
    const iy0 = Math.floor(y0), iy1 = Math.min(g.h, Math.ceil(y1));
    for (let x = 0; x < w; x++) {
      const x0 = x * fx, x1 = (x + 1) * fx;
      const ix0 = Math.floor(x0), ix1 = Math.min(g.w, Math.ceil(x1));
      let s = 0, a = 0;
      for (let yy = iy0; yy < iy1; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        const row = yy * g.w;
        for (let xx = ix0; xx < ix1; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const wgt = wx * wy;
          s += g.d[row + xx] * wgt; a += wgt;
        }
      }
      d[y * w + x] = s / a;
    }
  }
  return { w, h, d };
}

export function integral(g) {
  const W = g.w + 1;
  const I = new Float64Array(W * (g.h + 1));
  for (let y = 0; y < g.h; y++) {
    let row = 0;
    for (let x = 0; x < g.w; x++) {
      row += g.d[y * g.w + x];
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
    }
  }
  return I;
}

// Moyenne locale sur une fenêtre carrée (2r+1), via image intégrale.
export function boxMean(g, r) {
  const I = integral(g), W = g.w + 1;
  const out = new Float32Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(g.h, y + r + 1);
    for (let x = 0; x < g.w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(g.w, x + r + 1);
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      out[y * g.w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

// Érosion / dilatation binaire (carré 2r+1), séparable.
function morph(mask, w, h, r, isErode) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isErode ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const m = xx < 0 || xx >= w ? (isErode ? 0 : 0) : mask[y * w + xx];
        if (isErode ? !m : m) { v = isErode ? 0 : 1; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isErode ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const m = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (isErode ? !m : m) { v = isErode ? 0 : 1; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
export const erode = (m, w, h, r) => morph(m, w, h, r, true);
export const dilate = (m, w, h, r) => morph(m, w, h, r, false);
export const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);

// Composantes connexes (8-connexité) avec moments d'ordre 0 à 2.
export function components(mask, w, h, minArea = 1) {
  const lab = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [];
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || lab[p]) continue;
    n++;
    let sp = 0;
    stack[sp++] = p; lab[p] = n;
    let a = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp) {
      const q = stack[--sp];
      const x = q % w, y = (q / w) | 0;
      a++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const r = yy * w + xx;
          if (mask[r] && !lab[r]) { lab[r] = n; stack[sp++] = r; }
        }
      }
    }
    if (a >= minArea) {
      const cx = sx / a, cy = sy / a;
      comps.push({ id: n, area: a, cx, cy, cxx: sxx / a - cx * cx, cyy: syy / a - cy * cy, cxy: sxy / a - cx * cy, x0, y0, x1, y1 });
    }
  }
  return { lab, comps };
}

export function bilinear(g, x, y) {
  const w = g.w, h = g.h;
  if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
  if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
  const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy;
  const i = iy * w + ix, d = g.d;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + w] * (1 - fx) + d[i + w + 1] * fx) * fy;
}

// Échantillonnage bilinéaire RGB dans une ImageData (renvoie un tableau [r,g,b]).
export function bilinearRGB(img, x, y, out) {
  const w = img.width, h = img.height, d = img.data;
  if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
  if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
  const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy;
  const i = (iy * w + ix) * 4, j = i + w * 4;
  const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, e = fx * fy;
  out[0] = d[i] * a + d[i + 4] * b + d[j] * c + d[j + 4] * e;
  out[1] = d[i + 1] * a + d[i + 5] * b + d[j + 1] * c + d[j + 5] * e;
  out[2] = d[i + 2] * a + d[i + 6] * b + d[j + 2] * c + d[j + 6] * e;
  return out;
}
