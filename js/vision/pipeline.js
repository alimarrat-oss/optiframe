// Chaîne complète : photo -> repères -> redressement -> segmentation -> contour (mm) -> mesures.
import { toGray } from './image.js';
import { detectSheet } from './markers.js';
import { cameraPose, estimateFocal, localScale } from './homography.js';
import { rectify, MODEL_FRAME, frameCoverage } from './rectify.js';
import { classicalProb, selectLens, polarContour, sigmoidInPlace } from './segment.js';
import { smoothClosed, offsetNormal } from './geom.js';
import { refineEdges } from './refine.js';
import { gridRefine } from './gridrefine.js';
import { parallaxCorrect, applySheetScale, boxing } from './measure.js';

// clearBias : biais mesuré sur la validation synthétique pour les verres clairs (+0,34 mm sur A et B,
// soit 0,17 mm par côté : le réseau englobe un peu d'ombre portée) ; retiré le long des normales.
export const DEFAULTS = { edgeHeight: 2.0, sheetScaleX: 1, sheetScaleY: 1, clearBias: 0.17, gridRefine: false };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function fail(code, extra = {}) { return { ok: false, error: code, ...extra }; }

/**
 * img : ImageData (RGBA). opts : { net, focal35, edgeHeight, sheetScaleX, sheetScaleY, onProgress }.
 * focal35 : focale équivalente 35 mm lue dans l'EXIF (optionnelle).
 */
export async function analyzePhoto(img, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const T = {};
  const tick = async (name, frac) => { if (o.onProgress) { o.onProgress(name, frac); await new Promise((r) => setTimeout(r, 0)); } };
  let t = now();
  await tick('markers', 0.05);
  const gray = toGray(img);
  const sheet = detectSheet(gray);
  T.markers = now() - t;
  if (!sheet.ok) return fail(sheet.reason, { found: sheet.found, timings: T });
  const coverage = frameCoverage(sheet.Hs2i, img.width, img.height);
  if (coverage < 0.98) return fail('sheet-cut', { sheet, timings: T });

  // pose de la caméra (focale EXIF si disponible, sinon auto-calibration, sinon défaut téléphone)
  const diag = Math.hypot(img.width, img.height);
  let f = o.focal35 ? (o.focal35 * diag) / 43.27 : null;
  let focalSource = 'exif';
  if (!f) {
    const est = estimateFocal(sheet.Hs2i, img.width / 2, img.height / 2).filter((v) => v > 0.4 * diag && v < 1.6 * diag);
    if (est.length === 2 && Math.abs(est[0] - est[1]) / ((est[0] + est[1]) / 2) < 0.25) { f = (est[0] + est[1]) / 2; focalSource = 'auto'; }
    else { f = 0.62 * diag; focalSource = 'default'; }
  }
  const pose = cameraPose(sheet.Hs2i, f, img.width / 2, img.height / 2);
  const pxPerMm = localScale(sheet.Hs2i, 50, 35);
  const blurs = sheet.markers.map((m) => m.blurPx).filter((v) => v != null).sort((a, b) => a - b);
  const blurMm = blurs.length ? blurs[Math.floor(blurs.length / 2)] / pxPerMm : null;

  t = now();
  await tick('rectify', 0.15);
  const rect = rectify(img, sheet.Hs2i, MODEL_FRAME);
  T.rectify = now() - t;

  t = now();
  await tick('segment', 0.3);
  let prob, method;
  if (o.net) {
    const logits = o.net.forward(rect.chw, MODEL_FRAME.h, MODEL_FRAME.w);
    prob = sigmoidInPlace(logits);
    method = 'ai';
  } else {
    prob = classicalProb(rect.imageData);
    method = 'classic';
  }
  T.segment = now() - t;

  t = now();
  await tick('contour', 0.85);
  const sel = selectLens(prob, MODEL_FRAME);
  if (!sel || sel.area * MODEL_FRAME.res ** 2 < 150) return fail('no-lens', { sheet, rect, prob, method, pose, timings: T });
  const pc = polarContour(prob, sel, MODEL_FRAME);
  // raffinement sous-pixel sur l'image source là où le bord est franc (verres teintés)
  let edgePts = pc.pts, refined = 0, grid = null;
  if (o.refine !== false) {
    const rf = refineEdges(gray, sheet.Hs2i, pc.pts, pc.centre);
    edgePts = rf.pts; refined = rf.fraction;
    // verre clair (bord peu contrasté), option expérimentale : correction par la continuité des traits
    // de la grille (un trait reste droit dans une ombre portée mais se casse dans le verre).
    if (refined < 0.5 && o.gridRefine) {
      const gr = gridRefine(gray, sheet.Hs2i, edgePts, pc.centre);
      grid = { used: gr.used, points: gr.points.length, meanAbsCorr: gr.meanAbsCorr || 0 };
      if (gr.used) edgePts = gr.pts;
    }
  }
  const lowContrast = refined < 0.5;
  // verre clair : le bord de probabilité ondule un peu (ombre, reflets) -> lissage plus fort (sigma 2°),
  // sans effet mesurable sur A et B (rétrécissement < 0,02 mm pour un rayon de courbure de 10 mm)
  let raw = smoothClosed(edgePts, lowContrast ? 4 : 1.5);
  if (lowContrast && o.net && o.clearBias && !(grid && grid.used)) raw = smoothClosed(offsetNormal(raw, -o.clearBias), 1);
  const par = parallaxCorrect(raw, pose, o.edgeHeight);
  const pts = applySheetScale(par.pts, o.sheetScaleX, o.sheetScaleY);
  const m = boxing(pts);
  T.contour = now() - t;

  const warnings = [];
  const b = m.bbox;
  if (b.x0 < 1 || b.y0 < 1 || b.x1 > 99 || b.y1 > 69) warnings.push('near-border');
  if (sel.touches) return fail('lens-cut', { sheet, rect, prob, method, pose, contour: pts, timings: T });
  if (m.A < 18 || m.B < 12) return fail('lens-small', { sheet, rect, prob, method, pose, contour: pts, measures: m, timings: T });
  if (m.A > 80 || m.B > 66) return fail('lens-big', { sheet, rect, prob, method, pose, contour: pts, measures: m, timings: T });
  if (blurMm != null && blurMm > 0.6) return fail('blurry', { sheet, blurMm, timings: T });
  if (blurMm != null && blurMm > 0.35) warnings.push('soft');
  if (pose.tilt > 35) return fail('tilted', { sheet, pose, timings: T });
  if (pose.tilt > 18) warnings.push('tilted');
  if (Math.abs(m.tiltDeg) > 8) warnings.push('rotated');
  if (pc.miss > 20) warnings.push('uncertain');
  if (method === 'classic') warnings.push('no-ai');
  T.total = Object.values(T).reduce((s, v) => s + v, 0);
  return {
    ok: true, method, contour: pts, rawContour: raw, measures: m, pose: { ...pose, focal: f, focalSource },
    parallaxMax: par.maxShift, blurMm, pxPerMm, sheet, rect, prob, sel, warnings, timings: T, edgeSharpness: pc.sharp,
    refined, grid, lowContrast, aiContour: smoothClosed(pc.pts, 1.5),
  };
}
