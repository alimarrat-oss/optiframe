// Génération paramétrique de la face de monture (manifold-3d) à partir de deux contours.
//
// Repère de construction (« vue de face ») : x vers la droite de l'observateur, y vers le haut,
// z = épaisseur (z = 0 : face avant, posée sur le plateau ; z > 0 vers le visage). Le maillage final
// est symétrisé (x -> -x) pour être physiquement correct en position d'impression (voir buildFrame).
// Verre droit (OD) à gauche de l'observateur, verre gauche (OG) à droite, côtés nasaux vers le pont.
//
// Coupe d'un cercle (de l'avant vers l'arrière) :
//   lèvre avant (ouverture = verre - lipFront, butée)  ->  chanfrein 45°  ->
//   rainure (verre + jeu, hauteur = épaisseur du bord + marge)  ->  chanfrein 45°  ->
//   lèvre arrière (ouverture = verre - lipBack : le verre se clipse en forçant légèrement).
// Chanfreins à 45° : imprimable face avant sur le plateau, sans supports.

import { bbox, resample, smoothClosed, area, distToPoly } from '../vision/geom.js';

export const FRAME_DEFAULTS = {
  dbl: 18, rim: 4.0, clearance: 0.2, lipFront: 0.8, lipBack: 0.45, frontT: 0.8, backT: 0.7, edge: 2.2,
  bridgeH: 5.5, bridgeLift: 0.45, tenons: true, tenonDepth: 7, pinD: 1.9,
};

let wasmPromise = null;
export function loadManifold(url) {
  if (!wasmPromise) {
    wasmPromise = import(/* webpackIgnore: true */ url).then(async (mod) => {
      const wasm = await mod.default();
      wasm.setup();
      return wasm;
    });
  }
  return wasmPromise;
}

// Contour de la feuille (mm, y vers le bas) -> repère monture centré sur le centre boxing (y vers le haut).
export function toFrameCoords(contour, { mirror = false, rotate180 = false } = {}) {
  const b = bbox(contour);
  let P = contour.map(([x, y]) => [x - b.cx, -(y - b.cy)]);
  if (mirror) P = P.map(([x, y]) => [-x, y]);
  if (rotate180) P = P.map(([x, y]) => [-x, -y]);
  P = resample(smoothClosed(P, 0.5), 360);
  if (area(P) < 0) P.reverse(); // sens trigonométrique (contours extérieurs pour Clipper)
  return P;
}

function cs(CrossSection, P) {
  const Q = P.map(([x, y]) => [x, y]);
  if (area(Q) < 0) Q.reverse(); // contour extérieur : sens trigonométrique
  return new CrossSection([Q], 'Positive');
}

function roundedRect(x0, y0, x1, y1, r, n = 6) {
  const pts = [];
  const corners = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180], [x1 - r, y0 + r, 270]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= n; i++) {
    const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// Ouverture à la cote z (offset du contour du verre, mm) : profil de la rainure.
export function grooveProfile(p) {
  const c1 = p.lipFront + p.clearance, c2 = p.clearance + p.lipBack;
  const G = p.edge + 0.3;
  const z1 = p.frontT, z2 = z1 + c1, z3 = z2 + G, z4 = z3 + c2, T = z4 + p.backT;
  return { T, zMid: (z2 + z3) / 2, z: [z1, z2, z3, z4], G };
}

function lensCavity(wasm, P, p, prof) {
  const { CrossSection, Manifold } = wasm;
  const base = cs(CrossSection, P);
  const b = bbox(P);
  const front = base.offset(-p.lipFront, 'Round');
  const groove = base.offset(p.clearance, 'Round');
  const back = base.offset(-p.lipBack, 'Round');
  const [z1, z2, z3, z4] = prof.z;
  const parts = [];
  parts.push(front.extrude(z1 + 1).translate([0, 0, -1]));
  // chanfrein avant : homothétie (sx, sy) de l'ouverture avant vers la rainure
  const sx1 = (b.w + 2 * p.clearance) / (b.w - 2 * p.lipFront), sy1 = (b.h + 2 * p.clearance) / (b.h - 2 * p.lipFront);
  parts.push(front.translate([-b.cx, -b.cy]).extrude(z2 - z1, 0, 0, [sx1, sy1]).translate([b.cx, b.cy, z1]));
  parts.push(groove.extrude(z3 - z2).translate([0, 0, z2]));
  const sx2 = (b.w - 2 * p.lipBack) / (b.w + 2 * p.clearance), sy2 = (b.h - 2 * p.lipBack) / (b.h + 2 * p.clearance);
  parts.push(groove.translate([-b.cx, -b.cy]).extrude(z4 - z3, 0, 0, [sx2, sy2]).translate([b.cx, b.cy, z3]));
  parts.push(back.extrude(prof.T - z4 + 1).translate([0, 0, z4]));
  return Manifold.union(parts);
}

/**
 * od, og : contours (feuille, mm). opts : paramètres (FRAME_DEFAULTS) + options par verre
 * { odMirror, odRot, ogMirror, ogRot }. Renvoie la monture et les informations de contrôle.
 */
export function buildFrame(wasm, od, og, opts = {}) {
  const p = { ...FRAME_DEFAULTS, ...opts };
  const { CrossSection, Manifold } = wasm;
  const prof = grooveProfile(p);
  const T = prof.T;
  const L = toFrameCoords(od, { mirror: p.odMirror, rotate180: p.odRot });
  const R = toFrameCoords(og, { mirror: p.ogMirror, rotate180: p.ogRot });
  const bL = bbox(L), bR = bbox(R);
  const offL = -(bL.w / 2 + p.dbl / 2), offR = bR.w / 2 + p.dbl / 2;
  const PL = L.map(([x, y]) => [x + offL, y]);
  const PR = R.map(([x, y]) => [x + offR, y]);
  const bl = bbox(PL), br = bbox(PR);

  // --- contour extérieur de la face (2D)
  const rimOut = p.clearance + p.rim;
  const rims = [cs(CrossSection, PL).offset(rimOut, 'Round'), cs(CrossSection, PR).offset(rimOut, 'Round')];
  // pont : bande arquée entre les côtés nasaux
  const halfB = Math.min(bl.h, br.h) / 2;
  const yb = p.bridgeLift * halfB;
  const xN = p.dbl / 2 + rimOut + 2.5;
  const bridgePts = [];
  const nB = 24;
  for (let i = 0; i <= nB; i++) {
    const x = -xN + (2 * xN * i) / nB, t = x / xN;
    bridgePts.push([x, yb + p.bridgeH / 2 + 1.2 * (1 - t * t)]);
  }
  for (let i = nB; i >= 0; i--) {
    const x = -xN + (2 * xN * i) / nB, t = x / xN;
    bridgePts.push([x, yb - p.bridgeH / 2 + 2.2 * (1 - t * t)]);
  }
  const shapes = [...rims, cs(CrossSection, bridgePts)];
  // tenons : pattes côté temporal, en haut
  const tenonInfo = [];
  if (p.tenons) {
    const yT = Math.min(bl.y1, br.y1);
    for (const [side, bb] of [[-1, bl], [1, br]]) {
      const xEdge = side < 0 ? bb.x0 - rimOut : bb.x1 + rimOut;
      const xa = side < 0 ? xEdge - 3.5 : xEdge - 2.5, xb = side < 0 ? xEdge + 2.5 : xEdge + 3.5;
      const ya = yT - 9.5, yb2 = yT - 1.5;
      shapes.push(cs(CrossSection, roundedRect(xa, ya, xb, yb2, 1.2)));
      tenonInfo.push({ side, xEdge, xa, xb, ya, yb: yb2 });
    }
  }
  let outline = CrossSection.union(shapes);
  outline = outline.offset(1.2, 'Round').offset(-1.2, 'Round'); // congés dans les angles rentrants
  let frame = outline.extrude(T);

  // --- tenons 3D (à l'arrière) : deux charnières avec trou d'axe (fil de 1,75 mm)
  if (p.tenons) {
    for (const t of tenonInfo) {
      const kx0 = t.side < 0 ? t.xa + 0.3 : t.xb - 3.5, kx1 = kx0 + 3.2;
      const ky0 = t.ya + 0.5, ky1 = t.yb - 0.5;
      const h = ky1 - ky0;
      const block = Manifold.cube([kx1 - kx0, h, p.tenonDepth]).translate([kx0, ky0, T - 0.01]);
      const slot = Manifold.cube([kx1 - kx0 + 2, h / 3 + 0.4, p.tenonDepth + 1]).translate([kx0 - 1, ky0 + h / 3 - 0.2, T + 1.2]);
      const pin = Manifold.cylinder(h + 2, p.pinD / 2, p.pinD / 2, 24).rotate([-90, 0, 0]).translate([(kx0 + kx1) / 2, ky0 - 1, T + p.tenonDepth - 2.6]);
      frame = Manifold.union(frame, block.subtract(slot).subtract(pin));
    }
  }

  // --- cavités des verres (rainure de clipsage)
  frame = frame.subtract(lensCavity(wasm, PL, p, prof)).subtract(lensCavity(wasm, PR, p, prof));
  // contrôle : coupe au milieu de la rainure et écart au contour du verre (repère « vue de face »)
  const check = sliceCheck(frame, prof.zMid, PL, PR);
  // Repère d'impression : face avant sur le plateau (z = 0), tenons vers le haut. Vu depuis le
  // porteur (au-dessus du plateau), +x est à sa droite : on applique x -> -x au repère « vue de face »
  // (où +x est la droite de l'observateur) pour obtenir un objet physiquement correct (non miroir).
  frame = frame.mirror([1, 0, 0]);
  // suppression des triangles quasi dégénérés (écart de surface < 5 µm) : STL propre pour tous les logiciels
  frame = frame.simplify(0.005);
  const mesh = frame.getMesh();
  const stats = {
    status: frame.status(), genus: frame.genus(), volume: frame.volume(), area: frame.surfaceArea(), tris: frame.numTri(),
    thickness: T, width: bbox([...PL, ...PR]).w + 2 * rimOut + (p.tenons ? 7 : 0),
  };
  return { frame, mesh, stats, lenses: { PL, PR }, outline: outline.toPolygons(), params: p, profile: prof, check };
}

// Coupe la monture au milieu de la rainure, retrouve les deux ouvertures et mesure l'écart
// (distance de chaque point du verre au bord de l'ouverture). Bonus « cohérence contour/monture ».
export function sliceCheck(frame, z, PL, PR) {
  const polys = frame.slice(z).toPolygons();
  const holes = polys.filter((q) => Math.abs(area(q)) > 100); // contour extérieur + ouvertures des verres
  const res = [];
  for (const P of [PL, PR]) {
    const b = bbox(P);
    // trou dont la boîte contient le centre du verre
    let best = null;
    for (const q of holes) {
      const qb = bbox(q);
      if (qb.x0 < b.cx && qb.x1 > b.cx && qb.y0 < b.cy && qb.y1 > b.cy && (qb.w < b.w + 3)) {
        if (!best || Math.abs(area(q)) < Math.abs(area(best))) best = q;
      }
    }
    if (!best) { res.push(null); continue; }
    let s = 0, mx = 0, mn = Infinity;
    for (const pt of P) { const d = distToPoly(pt, best); s += d; mx = Math.max(mx, d); mn = Math.min(mn, d); }
    res.push({ mean: s / P.length, max: mx, min: mn, hole: best });
  }
  return res;
}

// STL binaire (mm).
export function meshToSTL(mesh) {
  const np = mesh.numProp, V = mesh.vertProperties, I = mesh.triVerts;
  const nt = I.length / 3;
  const buf = new ArrayBuffer(84 + 50 * nt);
  const dv = new DataView(buf);
  const head = 'OptiFrame monture.stl - mm - genere par OptiFrame (SN-SF CodeML)';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) & 0x7f : 32);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t] * np, b = I[3 * t + 1] * np, c = I[3 * t + 2] * np;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}
