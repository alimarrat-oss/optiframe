// Homographies, pose de caméra et petites routines d'algèbre linéaire.
// Toutes les matrices 3x3 sont des tableaux plats de 9 nombres (ligne par ligne).

export function solveLinear(A, b) {
  // Élimination de Gauss avec pivot partiel. A : tableau de lignes (n x n), b : n.
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function normalizePts(pts) {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  let d = 0;
  for (const [x, y] of pts) d += Math.hypot(x - cx, y - cy);
  d /= pts.length;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return { T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], pts: pts.map(([x, y]) => [s * (x - cx), s * (y - cy)]) };
}

// Homographie src -> dst (au moins 4 correspondances), DLT normalisée, h33 = 1.
export function computeHomography(src, dst) {
  const ns = normalizePts(src), nd = normalizePts(dst);
  const A = [], b = [];
  for (let i = 0; i < src.length; i++) {
    const [x, y] = ns.pts[i], [u, v] = nd.pts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  let h;
  if (src.length === 4) h = solveLinear(A, b);
  else {
    // moindres carrés : (A^T A) h = A^T b
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
    const Atb = new Array(8).fill(0);
    for (let r = 0; r < A.length; r++) {
      for (let i = 0; i < 8; i++) {
        Atb[i] += A[r][i] * b[r];
        for (let j = 0; j < 8; j++) AtA[i][j] += A[r][i] * A[r][j];
      }
    }
    h = solveLinear(AtA, Atb);
  }
  if (!h) return null;
  const Hn = [...h, 1];
  // H = Td^-1 * Hn * Ts
  const H = mul3(inv3(nd.T), mul3(Hn, ns.T));
  return scale3(H, 1 / H[8]);
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}

export function scale3(A, s) { return A.map((v) => v * s); }

export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

// Jacobien local de H (mm -> px) : facteur d'échelle en px/mm autour d'un point.
export function localScale(H, x, y) {
  const e = 0.5;
  const [x0, y0] = applyH(H, x - e, y), [x1, y1] = applyH(H, x + e, y);
  const [x2, y2] = applyH(H, x, y - e), [x3, y3] = applyH(H, x, y + e);
  return Math.sqrt(Math.hypot(x1 - x0, y1 - y0) * Math.hypot(x3 - x2, y3 - y2)) / (2 * e);
}

// Focale (px) estimée à partir de l'homographie feuille -> image (point principal au centre,
// pixels carrés). Renvoie null si la perspective est trop faible pour conclure.
export function estimateFocal(Hs2i, cx, cy) {
  const T = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const Hc = mul3(T, Hs2i);
  const h1 = [Hc[0], Hc[3], Hc[6]], h2 = [Hc[1], Hc[4], Hc[7]];
  const a = h1[0] * h2[0] + h1[1] * h2[1], b = h1[2] * h2[2];
  const c = h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2, d = h1[2] ** 2 - h2[2] ** 2;
  const out = [];
  if (Math.abs(b) > 1e-12 && -a / b > 0) out.push(Math.sqrt(-a / b));
  if (Math.abs(d) > 1e-12 && -c / d > 0) out.push(Math.sqrt(-c / d));
  return out;
}

// Pose de la caméra par rapport à la feuille. Renvoie le centre optique en mm (X, Y dans le
// repère de la feuille, Z = hauteur au-dessus de la feuille) et l'inclinaison en degrés.
export function cameraPose(Hs2i, f, cx, cy) {
  const Kinv = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
  const M = mul3(Kinv, Hs2i);
  let r1 = [M[0], M[3], M[6]], r2 = [M[1], M[4], M[7]], t = [M[2], M[5], M[8]];
  const n1 = Math.hypot(...r1), n2 = Math.hypot(...r2);
  const lam = 2 / (n1 + n2);
  r1 = r1.map((v) => v * lam); r2 = r2.map((v) => v * lam); t = t.map((v) => v * lam);
  if (t[2] < 0) { r1 = r1.map((v) => -v); r2 = r2.map((v) => -v); t = t.map((v) => -v); }
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  // C = -R^T t
  const C = [
    -(r1[0] * t[0] + r1[1] * t[1] + r1[2] * t[2]),
    -(r2[0] * t[0] + r2[1] * t[1] + r2[2] * t[2]),
    -(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2]),
  ];
  const tilt = (Math.acos(Math.min(1, Math.abs(r3[2]) / Math.hypot(...r3))) * 180) / Math.PI;
  return { X: C[0], Y: C[1], height: Math.abs(C[2]), tilt };
}
