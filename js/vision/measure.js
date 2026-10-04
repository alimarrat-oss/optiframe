// Mesures « boxing » (ISO 8624) et corrections géométriques.
import { area, perimeter, bbox, centroid, normals, smoothClosed, minAreaRectAngle } from './geom.js';

/**
 * Correction de parallaxe du bord du verre.
 * Le redressement est exact pour le plan de la feuille. Le bord supérieur du verre est à une
 * hauteur h au-dessus : du côté opposé à la caméra, il se projette vers l'extérieur de
 * h * d / H (d = distance au nadir de la caméra, H = hauteur de la caméra). Le côté proche de
 * la caméra montre le bord posé sur la feuille (exact). On recule donc chaque point du contour
 * le long de sa normale de (h / H) * max(0, n . (p - C)).
 */
export function parallaxCorrect(P, pose, edgeHeight) {
  if (!pose || !(pose.height > 20) || !(edgeHeight > 0)) return { pts: P, maxShift: 0 };
  const N = normals(P);
  const k = edgeHeight / pose.height;
  let maxShift = 0;
  const out = P.map((p, i) => {
    const s = N[i][0] * (p[0] - pose.X) + N[i][1] * (p[1] - pose.Y);
    const d = s > 0 ? k * s : 0;
    if (d > maxShift) maxShift = d;
    return [p[0] - N[i][0] * d, p[1] - N[i][1] * d];
  });
  return { pts: smoothClosed(out, 1), maxShift };
}

// Facteurs d'échelle si la feuille n'a pas été imprimée à 100 % (mesure à la règle).
export function applySheetScale(P, sx = 1, sy = 1) {
  if (sx === 1 && sy === 1) return P;
  return P.map(([x, y]) => [x * sx, y * sy]);
}

export function boxing(P) {
  const b = bbox(P);
  const c = [b.cx, b.cy];
  let ed = 0;
  for (const p of P) ed = Math.max(ed, Math.hypot(p[0] - c[0], p[1] - c[1]));
  const rect = minAreaRectAngle(P);
  const gain = 1 - rect.a / (b.w * b.h); // aire gagnée par le rectangle minimal tourné
  return {
    A: b.w, B: b.h, perimeter: perimeter(P), area: Math.abs(area(P)),
    ED: 2 * ed, boxCentre: c, centroid: centroid(P), bbox: b,
    tiltDeg: Math.abs(rect.ang) > 0.3 && gain > 0.05 ? rect.ang : 0, minRect: { angle: rect.ang, w: rect.w, h: rect.h, gain },
  };
}
