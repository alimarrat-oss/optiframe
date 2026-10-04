// Géométrie des contours fermés (listes de points [x, y] en mm).

export function area(P) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function perimeter(P) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

export function bbox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function centroid(P) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    const c = x1 * y2 - x2 * y1;
    a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// Lissage gaussien circulaire (sigma en nombre de points).
export function smoothClosed(P, sigma) {
  if (sigma <= 0) return P.map((p) => [...p]);
  const n = P.length, r = Math.ceil(3 * sigma);
  const k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp((-i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  const out = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = -r; j <= r; j++) { const p = P[(i + j + n) % n], w = k[j + r]; x += p[0] * w; y += p[1] * w; }
    out.push([x / s, y / s]);
  }
  return out;
}

// Rééchantillonnage à pas constant le long du contour.
export function resample(P, n) {
  const L = perimeter(P), step = L / n;
  const out = [];
  let i = 0, acc = 0;
  const m = P.length;
  let segStart = P[0], segEnd = P[1 % m], segLen = Math.hypot(segEnd[0] - segStart[0], segEnd[1] - segStart[1]);
  let pos = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (acc + segLen < target && i < m) {
      acc += segLen; i++;
      segStart = P[i % m]; segEnd = P[(i + 1) % m];
      segLen = Math.hypot(segEnd[0] - segStart[0], segEnd[1] - segStart[1]);
    }
    const t = segLen > 0 ? (target - acc) / segLen : 0;
    out.push([segStart[0] + (segEnd[0] - segStart[0]) * t, segStart[1] + (segEnd[1] - segStart[1]) * t]);
    pos = target;
  }
  return out;
}

// Normales sortantes (unitaires) d'un contour fermé.
export function normals(P) {
  const ccw = area(P) > 0; // repère y vers le bas : aire > 0 => sens horaire à l'écran
  const n = P.length;
  return P.map((_, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    // normale à droite de la tangente ; orientée vers l'extérieur selon le sens du contour
    return ccw ? [ty, -tx] : [-ty, tx];
  });
}

export function offsetNormal(P, d) {
  const N = normals(P);
  return P.map((p, i) => [p[0] + N[i][0] * d, p[1] + N[i][1] * d]);
}

// Distance d'un point à un polygone fermé.
export function distToPoly(q, P) {
  let best = Infinity;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    if (d < best) best = d;
  }
  return best;
}

export function pointInPoly(q, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Rectangle d'aire minimale (angle en degrés) : sert à signaler un verre posé de travers.
export function minAreaRectAngle(P) {
  let best = { a: Infinity, ang: 0, w: 0, h: 0 };
  for (let deg = -45; deg < 45; deg += 0.25) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of P) {
      const u = c * x + s * y, v = -s * x + c * y;
      if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
    }
    const a = (x1 - x0) * (y1 - y0);
    if (a < best.a) best = { a, ang: deg, w: x1 - x0, h: y1 - y0 };
  }
  return best;
}

export function rotate(P, deg, cx = 0, cy = 0) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return P.map(([x, y]) => [cx + c * (x - cx) - s * (y - cy), cy + s * (x - cx) + c * (y - cy)]);
}
