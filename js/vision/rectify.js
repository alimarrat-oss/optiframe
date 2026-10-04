// Redressement : image source -> vue de dessus dans le repère de la feuille (mm).
import { applyH, localScale } from './homography.js';
import { bilinearRGB } from './image.js';

// Repère du réseau : X de -4 à 108 mm, Y de -4 à 76 mm, 0,25 mm/px (448 x 320).
export const MODEL_FRAME = { x0: -4, y0: -4, res: 0.25, w: 448, h: 320 };

/**
 * Échantillonne l'image source sur une grille régulière du repère feuille.
 * frame : { x0, y0, res, w, h } ; Hs2i : homographie feuille (mm) -> image (px).
 * Sur-échantillonnage automatique (k x k) quand la source est plus fine que la grille.
 * Renvoie { imageData (RGBA), chw (Float32Array 3xHxW, RGB/255 - 0.5) }.
 */
export function rectify(img, Hs2i, frame = MODEL_FRAME, opts = {}) {
  const { x0, y0, res, w, h } = frame;
  const scale = localScale(Hs2i, x0 + (w * res) / 2, y0 + (h * res) / 2); // px source / mm
  const k = Math.max(1, Math.min(opts.maxSS || 4, Math.round(scale * res)));
  const out = new Uint8ClampedArray(w * h * 4);
  const chw = opts.chw === false ? null : new Float32Array(3 * w * h);
  const rgb = [0, 0, 0];
  const offs = [];
  for (let a = 0; a < k; a++) offs.push(((a + 0.5) / k - 0.5) * res);
  const inv = 1 / (k * k);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = Hs2i;
  for (let i = 0; i < h; i++) {
    const Yc = y0 + (i + 0.5) * res;
    for (let j = 0; j < w; j++) {
      const Xc = x0 + (j + 0.5) * res;
      let r = 0, g = 0, b = 0;
      for (let a = 0; a < k; a++) {
        const Y = Yc + offs[a];
        for (let c = 0; c < k; c++) {
          const X = Xc + offs[c];
          const W_ = h6 * X + h7 * Y + h8;
          bilinearRGB(img, (h0 * X + h1 * Y + h2) / W_, (h3 * X + h4 * Y + h5) / W_, rgb);
          r += rgb[0]; g += rgb[1]; b += rgb[2];
        }
      }
      const p = i * w + j;
      out[p * 4] = r * inv; out[p * 4 + 1] = g * inv; out[p * 4 + 2] = b * inv; out[p * 4 + 3] = 255;
      if (chw) {
        chw[p] = (r * inv) / 255 - 0.5;
        chw[w * h + p] = (g * inv) / 255 - 0.5;
        chw[2 * w * h + p] = (b * inv) / 255 - 0.5;
      }
    }
  }
  return { imageData: { width: w, height: h, data: out }, chw, ss: k, srcPxPerMm: scale };
}

// Vérifie que toute la zone utile de la feuille est dans la photo.
export function frameCoverage(Hs2i, imgW, imgH, x0 = -2, y0 = -2, x1 = 102, y1 = 72) {
  let n = 0, ok = 0;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    const [u, v] = applyH(Hs2i, x, y);
    n++;
    if (u >= 0 && v >= 0 && u < imgW && v < imgH) ok++;
  }
  return ok / n;
}
