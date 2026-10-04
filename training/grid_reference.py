"""Vérité terrain photographique d'un verre CLAIR par continuité de la grille.

Hors du verre, chaque trait de la grille est droit. Là où il entre dans le verre (biseau, réfraction),
il se décale, se casse ou disparaît. On suit chaque trait depuis l'extérieur et on note le premier point
où il s'écarte de sa droite : ce sont des points du bord de la silhouette du verre, indépendants de l'IA
et insensibles à l'ombre portée (dans l'ombre, le trait reste droit, il est juste plus sombre).

python grid_reference.py --photo ../assets/demo/verre_clair_OD.jpg --contours /tmp/optiframe-contours.json --name clear
"""
import argparse
import json

import cv2
import numpy as np

PPM = 25  # px/mm du redressement d'analyse


def detect_H(gray):
    """Homographie image -> feuille avec les mêmes repères que l'app (version Python compacte)."""
    s = 1600.0 / max(gray.shape)
    gs = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA).astype(np.float32)
    mean = cv2.blur(gs, (97, 97))
    dark = (gs < 0.72 * mean).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, cents = cv2.connectedComponentsWithStats(dark, 8)
    cands = []
    for i in range(1, n):
        a = st[i, cv2.CC_STAT_AREA]
        if a < 25 or a > 0.02 * gs.size:
            continue
        ys, xs = np.nonzero(lab == i)
        cov = np.cov(np.vstack([xs, ys]))
        ev = np.linalg.eigvalsh(cov)
        if ev[0] / ev[1] < 0.4 or not (0.6 < a / (12 * np.sqrt(ev[0] * ev[1])) < 1.15):
            continue
        cx, cy = xs.mean(), ys.mean()
        if gs[int(round(cy)), int(round(cx))] < gs[lab == i].mean() + 0.25 * (mean[int(cy), int(cx)] - gs[lab == i].mean()):
            continue
        cands.append((cx / s, cy / s, np.sqrt(12 * np.sqrt(ev[0] * ev[1])) / s))
    assert len(cands) >= 4, cands
    cands = sorted(cands, key=lambda c: -c[2])[:4]
    pts = []
    g = gray.astype(np.float64)
    for cx, cy, side in cands:  # barycentre du point blanc
        r = int(side * 0.75)
        x0, y0 = int(cx - r), int(cy - r)
        crop = g[y0:y0 + 2 * r, x0:x0 + 2 * r]
        yy, xx = np.mgrid[0:2 * r, 0:2 * r]
        inner = np.hypot(xx - (cx - x0), yy - (cy - y0)) < side * 0.33
        lo, hi = np.percentile(crop[inner], 30), np.percentile(crop[inner], 99)
        w = np.clip((crop - (lo + hi) / 2) / ((hi - lo) / 2), 0, 1) * inner
        mx, my = (w * xx).sum() / w.sum(), (w * yy).sum() / w.sum()
        for _ in range(3):
            inner = np.hypot(xx - mx, yy - my) < side * 0.25
            w = np.clip((crop - (lo + hi) / 2) / ((hi - lo) / 2), 0, 1) * inner
            mx, my = (w * xx).sum() / w.sum(), (w * yy).sum() / w.sum()
        pts.append((x0 + mx, y0 + my))
    pts = np.array(pts)
    c = pts.mean(0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    pts = np.roll(pts, -np.argmin(pts.sum(1)), 0)
    H, _ = cv2.findHomography(pts, np.array([[0, 0], [100, 0], [100, 70], [0, 70]], np.float64))
    return H


def rectify(gray, H, x0, y0, x1, y1):
    T = np.array([[PPM, 0, -x0 * PPM], [0, PPM, -y0 * PPM], [0, 0, 1]])
    return cv2.warpPerspective(gray.astype(np.float32), T @ H, (int((x1 - x0) * PPM), int((y1 - y0) * PPM)), flags=cv2.INTER_CUBIC)


def line_positions(R, axis, lo, hi, x0, y0):
    """Positions (mm) des traits de grille, profil moyen sur la bande [lo, hi] (mm) de l'autre axe."""
    if axis == 'h':  # traits horizontaux : profil le long de y, moyenné sur x in [lo, hi]
        prof = R[:, int((lo - x0) * PPM):int((hi - x0) * PPM)].mean(1); org = y0
    else:
        prof = R[int((lo - y0) * PPM):int((hi - y0) * PPM), :].mean(0); org = x0
    bg = cv2.GaussianBlur(prof.reshape(-1, 1), (1, 0), 30).ravel() if False else np.convolve(prof, np.ones(61) / 61, 'same')
    d = bg - prof
    out = []
    i = 5
    while i < len(d) - 5:
        if d[i] > 6 and d[i] == d[i - 5:i + 6].max():
            w = np.clip(d[i - 4:i + 5], 0, None)
            out.append(org + (i - 4 + (w * np.arange(9)).sum() / w.sum()) / PPM)
            i += 40
        else:
            i += 1
    return np.array(out)


def track(R, axis, pos, start, stop, step, x0, y0, tol=0.12):
    """Suit un trait (axe 'h' : y≈pos, on avance en x de start vers stop). Renvoie le premier
    point où le trait quitte sa droite (ajustée sur les 4 premiers mm), ou None."""
    ts = np.arange(start, stop, step)
    found, ref, depth0 = [], [], None
    for t in ts:
        if axis == 'h':
            c = int((t - x0) * PPM)
            col = R[:, max(0, c - 2):c + 3].mean(1)
            lo, hi = int((pos - 0.9 - y0) * PPM), int((pos + 0.9 - y0) * PPM)
            seg = col[lo:hi]; org = y0 + lo / PPM
        else:
            r = int((t - y0) * PPM)
            row = R[max(0, r - 2):r + 3, :].mean(0)
            lo, hi = int((pos - 0.9 - x0) * PPM), int((pos + 0.9 - x0) * PPM)
            seg = row[lo:hi]; org = x0 + lo / PPM
        if len(seg) < 10:
            return None
        ii = np.arange(len(seg))
        seg = seg - np.polyval(np.polyfit(ii, seg, 1), ii)  # retrait du gradient d'ombre
        k = int(np.argmin(seg))
        depth = np.median(seg) - seg[k]
        if 0 < k < len(seg) - 1:
            a, b, c2 = seg[k - 1], seg[k], seg[k + 1]
            off = 0.5 * (a - c2) / (a - 2 * b + c2 + 1e-9)
        else:
            off = 0
        found.append((t, org + (k + off) / PPM, depth))
    found = np.array(found)
    n0 = int(4.0 / abs(step))
    fit = np.polyfit(found[:n0, 0], found[:n0, 1], 1)
    d0 = np.median(found[:n0, 2])
    bad = (np.abs(found[:, 1] - np.polyval(fit, found[:, 0])) > tol) | (found[:, 2] < 0.15 * d0)
    for i in range(n0, len(found) - 3):
        if bad[i] and bad[i + 1] and bad[i + 2]:
            return found[i, 0] - step / 2, np.polyval(fit, found[i, 0])
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo', required=True)
    ap.add_argument('--contours', required=True)
    ap.add_argument('--name', default='clear')
    ap.add_argument('--out', default='grid_reference.json')
    ap.add_argument('--viz', default='')
    a = ap.parse_args()
    img = cv2.imread(a.photo)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    H = detect_H(gray)
    D = json.load(open(a.contours))[a.name]
    raw = np.array(D['raw'])  # contour IA avant correction de parallaxe (silhouette)
    bx0, by0 = raw.min(0) - 6
    bx1, by1 = raw.max(0) + 6
    bx0, by0, bx1, by1 = max(bx0, 1), max(by0, 1), min(bx1, 99), min(by1, 69)
    R = rectify(gray, H, bx0, by0, bx1, by1)
    # traits horizontaux (mesurés à gauche et à droite du verre), verticaux (au-dessus et au-dessous)
    hl = line_positions(R, 'h', bx0 + 0.5, raw[:, 0].min() - 2.5, bx0, by0)
    vl = line_positions(R, 'v', by0 + 0.5, raw[:, 1].min() - 2.5, bx0, by0)
    pts = []
    for y in hl:
        xs_in = raw[np.abs(raw[:, 1] - y) < 0.6, 0]
        if len(xs_in) < 2:
            continue
        for start, stop, step in ((bx0 + 0.3, xs_in.max(), 0.1), (bx1 - 0.3, xs_in.min(), -0.1)):
            r = track(R, 'h', y, start, stop, step, bx0, by0)
            if r:
                pts.append((r[0], r[1], 'h'))
    for x in vl:
        ys_in = raw[np.abs(raw[:, 0] - x) < 0.6, 1]
        if len(ys_in) < 2:
            continue
        for start, stop, step in ((by0 + 0.3, ys_in.max(), 0.1), (by1 - 0.3, ys_in.min(), -0.1)):
            r = track(R, 'v', x, start, stop, step, bx0, by0)
            if r:
                pts.append((r[1], r[0], 'v'))
    P = np.array([[p[0], p[1]] for p in pts])
    # écart signé (mm) entre ces points et le contour IA, le long de la direction radiale
    c = raw.mean(0)
    ang_raw = np.arctan2(raw[:, 1] - c[1], raw[:, 0] - c[0])
    r_raw = np.hypot(raw[:, 0] - c[0], raw[:, 1] - c[1])
    order = np.argsort(ang_raw)
    devs = []
    for p in P:
        an = np.arctan2(p[1] - c[1], p[0] - c[0])
        rr = np.interp(an, ang_raw[order], r_raw[order], period=2 * np.pi)
        devs.append(np.hypot(p[0] - c[0], p[1] - c[1]) - rr)
    devs = np.array(devs)
    # rejet des points aberrants : écart trop différent de celui des voisins angulaires
    an_all = np.array([np.arctan2(p[1] - c[1], p[0] - c[0]) for p in P])
    keep = np.ones(len(P), bool)
    for i in range(len(P)):
        dang = np.abs((an_all - an_all[i] + np.pi) % (2 * np.pi) - np.pi)
        nb = np.argsort(dang)[1:5]
        if abs(devs[i] - np.median(devs[nb])) > 0.6:
            keep[i] = False
    print(f'points rejetés : {int((~keep).sum())}')
    P, devs = P[keep], devs[keep]
    print(f'{len(P)} points de bord par continuité de grille ; écart IA - grille : médiane {np.median(-devs):+.2f} mm, '
          f'moyenne |écart| {np.mean(np.abs(devs)):.2f} mm')
    # contour de référence : contour IA corrigé radialement (interpolation circulaire des écarts)
    an_p = np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0])
    o = np.argsort(an_p)
    corr = np.interp(ang_raw, an_p[o], devs[o], period=2 * np.pi)
    ref = np.stack([c[0] + (r_raw + corr) * np.cos(ang_raw), c[1] + (r_raw + corr) * np.sin(ang_raw)], 1)
    A_ref, B_ref = np.ptp(ref[:, 0]), np.ptp(ref[:, 1])
    A_ai, B_ai = np.ptp(raw[:, 0]), np.ptp(raw[:, 1])
    print(f'silhouette IA : A {A_ai:.2f}  B {B_ai:.2f} | référence grille : A {A_ref:.2f}  B {B_ref:.2f}')
    json.dump({'points': P.tolist(), 'dev': devs.tolist(), 'A_ref_silhouette': A_ref, 'B_ref_silhouette': B_ref,
               'A_ai_silhouette': A_ai, 'B_ai_silhouette': B_ai, 'ref': ref.tolist()}, open(a.out, 'w'))
    if a.viz:
        V = cv2.cvtColor(np.clip(R, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        q = lambda Q: ((np.asarray(Q) - [bx0, by0]) * PPM).astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(V, [q(raw)], True, (0, 0, 255), 1, cv2.LINE_AA)
        cv2.polylines(V, [q(ref)], True, (0, 180, 0), 1, cv2.LINE_AA)
        for p in P:
            cv2.circle(V, tuple(q([p])[0, 0]), 5, (255, 0, 0), 2)
        cv2.imwrite(a.viz, V)


if __name__ == '__main__':
    main()
