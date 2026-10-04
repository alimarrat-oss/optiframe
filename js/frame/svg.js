// Export SVG à l'échelle 1:1 (unités en mm) : contour du verre tel qu'il a été posé sur la feuille,
// rectangle boxing, centre, cotes et barre de contrôle de 50 mm pour vérifier l'impression.
import { bbox } from '../vision/geom.js';

const f2 = (v) => (Math.round(v * 1000) / 1000).toString();

function pathD(P, ox, oy) {
  return 'M' + P.map(([x, y]) => `${f2(x + ox)},${f2(y + oy)}`).join('L') + 'Z';
}

/**
 * items : [{ label, contour (mm, repère feuille), A, B }]. Renvoie le texte SVG.
 */
export function contoursSVG(items, title = 'OptiFrame') {
  const margin = 12, gap = 10;
  let x = margin;
  const placed = items.map((it) => {
    const b = bbox(it.contour);
    const ox = x - b.x0, oy = margin + 10 - b.y0;
    x += b.w + gap;
    return { ...it, b, ox, oy };
  });
  const W = Math.max(x - gap + margin, 50 + 2 * margin);
  const Hmax = Math.max(...placed.map((p) => p.b.h));
  const H = margin + 10 + Hmax + 26 + margin;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}mm" height="${f2(H)}mm" viewBox="0 0 ${f2(W)} ${f2(H)}">`);
  out.push(`<title>${title}</title>`);
  out.push(`<desc>Echelle 1:1 (1 unite = 1 mm). Imprimer a 100 %, sans ajustement a la page. Verifier la barre de 50 mm.</desc>`);
  out.push('<g font-family="Arial, Helvetica, sans-serif" fill="#000">');
  out.push(`<text x="${margin}" y="${margin + 2}" font-size="4">${title}</text>`);
  for (const p of placed) {
    const { b, ox, oy } = p;
    out.push(`<rect x="${f2(b.x0 + ox)}" y="${f2(b.y0 + oy)}" width="${f2(b.w)}" height="${f2(b.h)}" fill="none" stroke="#888" stroke-width="0.15" stroke-dasharray="1.5 1"/>`);
    out.push(`<path d="${pathD(p.contour, ox, oy)}" fill="none" stroke="#000" stroke-width="0.2"/>`);
    const cx = b.cx + ox, cy = b.cy + oy;
    out.push(`<path d="M${f2(cx - 2)},${f2(cy)}H${f2(cx + 2)}M${f2(cx)},${f2(cy - 2)}V${f2(cy + 2)}" stroke="#000" stroke-width="0.15"/>`);
    out.push(`<text x="${f2(b.x0 + ox)}" y="${f2(b.y1 + oy + 6)}" font-size="3.2">${p.label}  A ${p.A.toFixed(1)} mm  B ${p.B.toFixed(1)} mm</text>`);
    if (p.nasal) {
      const nx = p.nasal > 0 ? b.x1 + ox - 6 : b.x0 + ox + 1;
      out.push(`<text x="${f2(nx)}" y="${f2(b.y0 + oy - 1.5)}" font-size="2.6" fill="#555">${p.nasal > 0 ? 'nasal →' : '← nasal'}</text>`);
    }
  }
  const yb = H - margin;
  out.push(`<path d="M${margin},${f2(yb)}H${margin + 50}M${margin},${f2(yb - 2)}V${f2(yb + 2)}M${margin + 50},${f2(yb - 2)}V${f2(yb + 2)}" stroke="#000" stroke-width="0.25"/>`);
  out.push(`<text x="${margin + 52}" y="${f2(yb + 1.2)}" font-size="3">50 mm (controle d'impression)</text>`);
  out.push('</g></svg>');
  return out.join('\n');
}
