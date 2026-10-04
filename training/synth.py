"""
OptiFrame - générateur de données synthétiques pour la segmentation de verres.

Chaque échantillon est rendu directement dans le repère redressé de la feuille de
capture (vue de dessus, mm), exactement comme l'image que l'app obtient après
l'homographie : X de -4 à 108 mm, Y de -4 à 76 mm, 0,25 mm/pixel (448 x 320).

Le rendu simule ce qui rend un verre difficile à segmenter :
  * feuille : papier teinté, grille 5 mm (décalage et pointillés variables), repères,
    taches, objets qui dépassent (pied à coulisse, règle) ;
  * verre : formes de type « boxing » (super-ellipses, aviateur, perturbations de Fourier),
    verre clair (réfraction de la grille, grossissement +/-), teinté, coloré ;
  * bord : biseau clair ou sombre, paroi visible d'un côté (parallaxe), ombre portée
    à l'extérieur du verre, reflets spéculaires qui peuvent mordre sur le contour ;
  * éclairage : dégradés, ombre de la main / du téléphone, balance des blancs ;
  * caméra : flou, bruit, compression JPEG, faible déformation résiduelle (feuille non plane).

Le masque cible est la silhouette exacte du verre, anti-crénelée (couverture sous-pixel).

Usage : python synth.py --out data/synth --n 4000 --seed 1
"""
import argparse
import os

import cv2
import numpy as np

RES = 0.25           # mm / pixel du réseau
X0, Y0 = -4.0, -4.0  # coin haut-gauche du repère du réseau (mm)
W, H = 448, 320      # 112 x 80 mm
SS = 2               # sur-échantillonnage du rendu
KINDS = ['clear', 'clear', 'clear', 'light', 'dark', 'dark', 'color']
RES2 = RES / SS
W2, H2 = W * SS, H * SS


def mm2px2(x, y):
    """mm -> pixels de l'image sur-échantillonnée (centres de pixels)."""
    return (np.asarray(x) - X0) / RES2 - 0.5, (np.asarray(y) - Y0) / RES2 - 0.5


def grid_xy():
    xs = X0 + (np.arange(W2) + 0.5) * RES2
    ys = Y0 + (np.arange(H2) + 0.5) * RES2
    return np.meshgrid(xs, ys)


XX2, YY2 = grid_xy()


def smooth_noise(rng, shape, sigma_px, amp):
    n = rng.standard_normal(shape).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), sigma_px)
    n /= (n.std() + 1e-6)
    return n * amp


def draw_lines_aa(canvas, segs, thick_px, value):
    shift = 4
    f = 1 << shift
    for (xa, ya, xb, yb) in segs:
        pa = mm2px2(xa, ya)
        pb = mm2px2(xb, yb)
        cv2.line(canvas, (int(round(pa[0] * f)), int(round(pa[1] * f))),
                 (int(round(pb[0] * f)), int(round(pb[1] * f))), value,
                 max(1, int(round(thick_px))), cv2.LINE_AA, shift)


def render_sheet(rng):
    """Feuille de capture (papier + encre), image float32 RGB [0,1] sur-échantillonnée."""
    paper = np.array([rng.uniform(0.86, 1.0)] * 3, np.float32)
    paper *= np.array([rng.uniform(0.98, 1.02), 1.0, rng.uniform(0.97, 1.03)], np.float32)
    img = np.ones((H2, W2, 3), np.float32) * paper
    # texture du papier
    img *= (1 + smooth_noise(rng, (H2, W2), 1.0, 0.006))[..., None]
    img *= (1 + smooth_noise(rng, (H2, W2), 12.0, 0.01))[..., None]

    ink = np.zeros((H2, W2), np.uint8)
    # grille intérieure : pas ~5 mm, décalage variable (la feuille imprimée de l'équipe est décalée)
    step = rng.uniform(4.95, 5.08)
    offx = rng.choice([0.0, rng.uniform(0, 1.2)])
    offy = rng.choice([0.0, rng.uniform(0, 1.2)])
    w_in = rng.uniform(0.08, 0.2) / RES2
    v_in = int(rng.uniform(70, 190))
    dotted = rng.random() < 0.5
    segs = []
    xk = offx + step
    while xk < 100 - 0.3:
        segs.append((xk, 0, xk, 70)); xk += step
    yk = offy + step
    while yk < 70 - 0.3:
        segs.append((0, yk, 100, yk)); yk += step
    if rng.random() < 0.3:  # ligne pointillée collée aux bords (comme la feuille imprimée)
        segs += [(offx * 0.6 + 0.4, 0, offx * 0.6 + 0.4, 70)]
    if dotted:
        dash = rng.uniform(0.3, 0.9)
        gap = rng.uniform(0.15, 0.5)
        dsegs = []
        for (xa, ya, xb, yb) in segs:
            L = np.hypot(xb - xa, yb - ya)
            t = 0.0
            while t < L:
                t2 = min(L, t + dash)
                dsegs.append((xa + (xb - xa) * t / L, ya + (yb - ya) * t / L,
                              xa + (xb - xa) * t2 / L, ya + (yb - ya) * t2 / L))
                t = t2 + gap
        segs = dsegs
    draw_lines_aa(ink, segs, w_in, v_in)
    # bordure épaisse passant par le centre des repères
    w_b = rng.uniform(0.2, 0.45) / RES2
    v_b = int(rng.uniform(150, 245))
    draw_lines_aa(ink, [(0, 0, 100, 0), (100, 0, 100, 70), (100, 70, 0, 70), (0, 70, 0, 0)], w_b, v_b)
    # repères : carrés de 6 mm avec point blanc
    side = rng.uniform(5.6, 6.4)
    dot = rng.uniform(1.4, 2.2)
    for (mx, my) in [(0, 0), (100, 0), (100, 70), (0, 70)]:
        p0 = mm2px2(mx - side / 2, my - side / 2)
        p1 = mm2px2(mx + side / 2, my + side / 2)
        cv2.rectangle(ink, (int(p0[0]), int(p0[1])), (int(p1[0]), int(p1[1])), 250, -1, cv2.LINE_AA)
        c = mm2px2(mx, my)
        cv2.circle(ink, (int(round(c[0] * 16)), int(round(c[1] * 16))), int(dot / 2 / RES2 * 16), 0, -1, cv2.LINE_AA, 4)
    # numéros des repères
    for k, (mx, my) in enumerate([(-6, -4), (101, -4), (101, 77), (-6, 77)]):
        p = mm2px2(mx, my)
        cv2.putText(ink, str(k + 1), (int(p[0]), int(p[1])), cv2.FONT_HERSHEY_SIMPLEX,
                    0.09 / RES2 * 2, 200, max(1, int(0.25 / RES2)), cv2.LINE_AA)
    inkf = ink.astype(np.float32) / 255.0
    inkf = cv2.GaussianBlur(inkf, (0, 0), 0.6)  # bavure d'impression
    ink_col = np.array([rng.uniform(0.05, 0.2)] * 3, np.float32)
    img = img * (1 - inkf[..., None]) + ink_col * inkf[..., None] * paper

    # taches (café, gras)
    for _ in range(rng.poisson(0.7)):
        cx, cy = rng.uniform(-4, 108), rng.uniform(-4, 76)
        r = rng.uniform(0.5, 4)
        m = np.zeros((H2, W2), np.float32)
        p = mm2px2(cx, cy)
        cv2.ellipse(m, (int(p[0]), int(p[1])), (int(r / RES2), int(r * rng.uniform(0.4, 1) / RES2)),
                    rng.uniform(0, 180), 0, 360, 1.0, -1)
        m = cv2.GaussianBlur(m, (0, 0), r / RES2 * 0.3 + 1)
        col = np.array([rng.uniform(0.7, 0.9), rng.uniform(0.55, 0.8), rng.uniform(0.35, 0.6)], np.float32)
        a = rng.uniform(0.2, 0.7)
        img = img * (1 - a * m[..., None]) + col * img * a * m[..., None]
    return img


def lens_polygon(rng):
    """Contour de verre réaliste (mm, centré sur le centre boxing), 720 points."""
    A = rng.uniform(30, 63)
    ratio = rng.uniform(1.0, 1.7) if rng.random() < 0.9 else rng.uniform(0.9, 1.05)
    B = np.clip(A / ratio, 20, 54)
    n = rng.uniform(1.9, 4.2)
    th = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    a, b = A / 2, B / 2
    r = (np.abs(np.cos(th) / a) ** n + np.abs(np.sin(th) / b) ** n) ** (-1.0 / n)
    pert = np.ones_like(th)
    for k, s in zip(range(1, 7), [0.04, 0.04, 0.022, 0.012, 0.006, 0.003]):
        pert += rng.normal(0, s) * np.cos(k * th + rng.uniform(0, 2 * np.pi))
    r *= pert
    if rng.random() < 0.35:  # forme aviateur / goutte
        d = rng.uniform(0.08, 0.28)
        thd = rng.uniform(0, 2 * np.pi)
        r *= 1 + d * np.clip(np.cos(th - thd), 0, None) ** 2
    if rng.random() < 0.15:  # côté plat (style rectangulaire / nasal)
        thf = rng.uniform(0, 2 * np.pi)
        lim = np.cos(th - thf)
        cut = rng.uniform(0.75, 0.95) * r.max()
        proj = r * lim
        r = np.where(proj > cut, r * cut / np.maximum(proj, 1e-6), r)
    r = np.clip(r, 6, None)
    x, y = r * np.cos(th), r * np.sin(th)
    psi = np.radians(rng.uniform(-12, 12))
    c, s = np.cos(psi), np.sin(psi)
    x, y = c * x - s * y, s * x + c * y
    # lissage léger
    k = np.array([1, 4, 6, 4, 1], np.float64) / 16
    x = np.convolve(np.r_[x[-2:], x, x[:2]], k, 'valid')
    y = np.convolve(np.r_[y[-2:], y, y[:2]], k, 'valid')
    x -= (x.max() + x.min()) / 2
    y -= (y.max() + y.min()) / 2
    return np.stack([x, y], 1)


def place_lens(rng, poly):
    A = poly[:, 0].max() - poly[:, 0].min()
    B = poly[:, 1].max() - poly[:, 1].min()
    mx = max(0.5, (100 - A) / 2 - 1)
    my = max(0.5, (70 - B) / 2 - 1)
    cx = 50 + rng.uniform(-mx, mx)
    cy = 35 + rng.uniform(-my, my)
    return poly + np.array([cx, cy]), np.array([cx, cy])


def raster_mask(poly, k=4):
    """Couverture exacte : remplissage binaire à 4x la résolution de rendu puis moyenne de zone
    (pas d'anti-crénelage de cv2, qui élargit le masque d'environ un demi-pixel)."""
    m = np.zeros((H2 * k, W2 * k), np.uint8)
    px, py = mm2px2(poly[:, 0], poly[:, 1])
    pts = np.stack([(px + 0.5) * k - 0.5, (py + 0.5) * k - 0.5], 1)
    cv2.fillPoly(m, [np.round(pts * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    return cv2.resize(m.astype(np.float32), (W2, H2), interpolation=cv2.INTER_AREA)


def signed_distance_mm(mask_soft):
    binm = (mask_soft > 0.5).astype(np.uint8)
    din = cv2.distanceTransform(binm, cv2.DIST_L2, 5)
    dout = cv2.distanceTransform(1 - binm, cv2.DIST_L2, 5)
    return (din - dout) * RES2  # >0 dedans


def render_lens(rng, sheet):
    poly = lens_polygon(rng)
    poly, c = place_lens(rng, poly)
    mask = raster_mask(poly)
    sd = signed_distance_mm(mask)
    ang = np.arctan2(YY2 - c[1], XX2 - c[0])
    R = np.max(np.hypot(poly[:, 0] - c[0], poly[:, 1] - c[1]))

    kind = rng.choice(KINDS)
    # --- intérieur : la feuille vue à travers le verre (réfraction)
    if kind == 'clear':
        # verre posé sur la feuille : grossissement réel très faible (|P| d ~ 1 %), parfois plus fort
        m = rng.uniform(0.985, 1.015) if rng.random() < 0.75 else rng.uniform(0.95, 1.05)
        T = np.array([rng.uniform(0.86, 0.98)] * 3, np.float32) * np.array([rng.uniform(0.97, 1.0), 1, rng.uniform(0.97, 1.03)], np.float32)
        haze = rng.uniform(0.0, 0.08)
    elif kind == 'light':
        m = rng.uniform(0.98, 1.02)
        T = np.array([rng.uniform(0.45, 0.85)] * 3, np.float32) * np.array([rng.uniform(0.85, 1.1), 1, rng.uniform(0.8, 1.05)], np.float32)
        haze = rng.uniform(0.0, 0.05)
    elif kind == 'dark':
        m = rng.uniform(0.985, 1.015)
        T = np.array([rng.uniform(0.04, 0.35)] * 3, np.float32) * np.array([rng.uniform(0.9, 1.15), 1, rng.uniform(0.8, 1.1)], np.float32)
        haze = rng.uniform(0.0, 0.04)
    else:
        m = rng.uniform(0.98, 1.02)
        base = rng.choice([[0.55, 0.38, 0.22], [0.3, 0.45, 0.3], [0.3, 0.35, 0.55], [0.4, 0.4, 0.4], [0.6, 0.3, 0.4]])
        T = np.array(base, np.float32) * rng.uniform(0.5, 1.3)
        haze = rng.uniform(0.0, 0.05)
    dx = XX2 - c[0]
    dy = YY2 - c[1]
    rr = np.hypot(dx, dy) / R
    prism = rng.uniform(-0.012, 0.012)
    scale = m + prism * rr ** 2
    # zone du biseau : le fond vu à travers le bord incliné est fortement décalé (grille « cassée »)
    wz = rng.uniform(0.3, 1.1)
    zone = np.clip(1 - sd / wz, 0, 1) * (sd > 0)
    az = rng.uniform(-0.9, 0.9) * (0.5 + 0.5 * np.cos(ang * rng.integers(1, 3) + rng.uniform(0, 6.28)))
    rn = np.hypot(dx, dy) + 1e-6
    sx = c[0] + dx / scale - dx / rn * az * zone
    sy = c[1] + dy / scale - dy / rn * az * zone
    mapx, mapy = mm2px2(sx, sy)
    seen = cv2.remap(sheet, mapx.astype(np.float32), mapy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    if rng.random() < 0.5:
        seen = cv2.GaussianBlur(seen, (0, 0), rng.uniform(0.3, 1.2))
    zb = cv2.GaussianBlur(seen, (0, 0), rng.uniform(0.8, 2.0))
    seen = seen * (1 - zone[..., None]) + zb * zone[..., None]
    view = seen * T + haze * (1 + smooth_noise(rng, (H2, W2), 30, 0.5))[..., None].clip(0, 2)

    # --- biseau : anneau intérieur clair ou sombre, variable le long du contour
    wb = rng.uniform(0.15, 0.9)
    ring = np.clip(1 - np.abs(sd - wb / 2) / (wb / 2 + 1e-6), 0, 1) * (sd > 0)
    mod = 0.5 + 0.5 * np.cos(ang * rng.integers(1, 4) + rng.uniform(0, 6.28))
    if kind == 'clear':
        bright = rng.uniform(-0.35, 0.45)
    else:
        bright = rng.uniform(-0.1, 0.6)
    view = view * (1 + bright * ring * mod)[..., None] if bright < 0 else view + (bright * ring * mod)[..., None] * (0.9 - view).clip(0, 1)

    # --- paroi du bord visible d'un côté (parallaxe), à l'intérieur de la silhouette
    phi_c = rng.uniform(-np.pi, np.pi)
    wp0 = rng.uniform(0, 2.2) if rng.random() < 0.7 else 0
    wp = wp0 * np.clip(np.cos(ang - phi_c), 0, None) ** 1.5
    band = ((sd > 0) & (sd < wp)).astype(np.float32)
    band = cv2.GaussianBlur(band, (0, 0), 1.2)
    wall_val = rng.uniform(0.45, 0.9)
    if kind in ('dark', 'color'):
        wall_val = rng.uniform(0.8, 1.6)
    view = view * (1 + (wall_val - 1) * band)[..., None]

    # --- ombre portée à l'extérieur
    phi_l = rng.uniform(-np.pi, np.pi)
    ws0 = rng.uniform(0, 2.6) if rng.random() < 0.8 else 0
    halo = rng.uniform(0.1, 1.1) if rng.random() < 0.6 else rng.uniform(0, 0.3)
    ws = ws0 * np.clip(np.cos(ang - phi_l), 0, None) ** rng.uniform(0.6, 2) + halo
    ds = rng.uniform(0.08, 0.45) if kind == 'clear' else rng.uniform(0.05, 0.35)
    prof = np.clip(1 + sd / np.maximum(ws, 1e-3), 0, 1) * (sd <= 0)  # 1 au bord -> 0 à ws
    prof = prof ** rng.uniform(0.6, 1.8)
    prof = cv2.GaussianBlur(prof.astype(np.float32), (0, 0), rng.uniform(0.6, 3))
    outside = sheet * (1 - ds * prof)[..., None]
    if rng.random() < 0.3:  # caustique claire au-delà de l'ombre
        cw = rng.uniform(0.15, 0.5)
        caus = np.clip(1 - np.abs(-sd - ws - cw) / cw, 0, 1) * (sd < 0)
        outside = outside + (rng.uniform(0.05, 0.25) * caus * np.clip(np.cos(ang - phi_l), 0, None))[..., None]

    img = outside * (1 - mask[..., None]) + view * mask[..., None]

    # --- reflets spéculaires sur le verre
    for _ in range(rng.poisson(1.0 if kind != 'clear' else 0.6)):
        th = rng.uniform(-np.pi, np.pi)
        rad = R * rng.uniform(0.2, 1.0)
        hx, hy = c[0] + rad * np.cos(th) * 0.9, c[1] + rad * np.sin(th) * 0.8
        hl = np.zeros((H2, W2), np.float32)
        p = mm2px2(hx, hy)
        ax = rng.uniform(1, 10) / RES2
        ay = ax * rng.uniform(0.05, 0.5)
        cv2.ellipse(hl, (int(p[0]), int(p[1])), (int(ax), max(1, int(ay))), rng.uniform(0, 180), 0, 360, 1.0, -1)
        hl = cv2.GaussianBlur(hl, (0, 0), rng.uniform(0.5, 4) / RES2 * 0.2 + 0.5)
        hl *= np.clip(mask + (rng.random() < 0.25) * 0.6, 0, 1)
        a = rng.uniform(0.3, 1.2)
        img = img + (a * hl)[..., None] * (1.0 - img).clip(0, 1)
    # poussières / rayures
    for _ in range(rng.poisson(2)):
        p = mm2px2(c[0] + rng.uniform(-R, R), c[1] + rng.uniform(-R, R))
        cv2.circle(img, (int(p[0]), int(p[1])), int(rng.uniform(0.5, 2)), (0.95, 0.95, 0.95), -1)
    return img, mask, poly, kind


def lighting(rng, img):
    h, w = img.shape[:2]
    gx = rng.uniform(-0.25, 0.25)
    gy = rng.uniform(-0.25, 0.25)
    xs = np.linspace(-1, 1, w, dtype=np.float32)[None, :]
    ys = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
    illum = 1 + gx * xs + gy * ys + smooth_noise(rng, (h, w), 60, 0.04)
    illum *= rng.uniform(0.75, 1.1)
    # ombres de la main / du téléphone
    for _ in range(rng.choice([0, 0, 1, 1, 2])):
        m = np.zeros((h, w), np.float32)
        pts = []
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        for k in range(rng.integers(3, 7)):
            a = rng.uniform(0, 2 * np.pi)
            rr = rng.uniform(0.2, 1.0) * w
            pts.append((cx + rr * np.cos(a), cy + rr * np.sin(a)))
        cv2.fillPoly(m, [np.array(pts, np.int32)], 1.0)
        m = cv2.GaussianBlur(m, (0, 0), rng.uniform(4, 40))
        illum *= 1 - rng.uniform(0.15, 0.55) * m
    wb = np.array([rng.uniform(0.94, 1.06), 1.0, rng.uniform(0.92, 1.08)], np.float32)
    return img * illum[..., None] * wb


def intruders(rng, img, lens_mask):
    """Objets qui dépassent dans le cadre (pied à coulisse, règle, doigt)."""
    if rng.random() > 0.15:
        return img
    h, w = img.shape[:2]
    m = np.zeros((h, w), np.float32)
    side = rng.integers(4)
    t = rng.uniform(0.05, 0.95)
    L = rng.uniform(0.05, 0.25)
    wd = rng.uniform(0.02, 0.08)
    if side == 0:
        p0 = (t * w, 0); p1 = (t * w + rng.uniform(-0.05, 0.05) * w, L * h)
    elif side == 1:
        p0 = (t * w, h); p1 = (t * w, h - L * h)
    elif side == 2:
        p0 = (0, t * h); p1 = (L * w, t * h)
    else:
        p0 = (w, t * h); p1 = (w - L * w, t * h)
    cv2.line(m, (int(p0[0]), int(p0[1])), (int(p1[0]), int(p1[1])), 1.0, max(2, int(wd * w)))
    m *= (lens_mask < 0.01)
    col = np.array([rng.uniform(0.2, 0.75)] * 3, np.float32)
    shade = (1 + smooth_noise(rng, (h, w), 3, 0.15))[..., None]
    return img * (1 - m[..., None]) + col * shade * m[..., None]


def camera(rng, img, mask):
    # déformation résiduelle douce (feuille non plane, homographie imparfaite)
    amp = rng.uniform(0, 0.35) / RES  # px
    fx = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 40)
    fy = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 40)
    fx *= amp / (np.abs(fx).max() + 1e-6)
    fy *= amp / (np.abs(fy).max() + 1e-6)
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    img = cv2.remap(img, gx + fx, gy + fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    mask = cv2.remap(mask, gx + fx, gy + fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    # résolution source plus faible
    if rng.random() < 0.35:
        f = rng.uniform(0.45, 0.8)
        small = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        img = cv2.resize(small, (W, H), interpolation=cv2.INTER_LINEAR)
    # flou de mise au point / de bougé
    if rng.random() < 0.6:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.2, 1.1))
    if rng.random() < 0.15:
        k = int(rng.integers(3, 7))
        ker = np.zeros((k, k), np.float32); ker[k // 2, :] = 1.0 / k
        M = cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), rng.uniform(0, 180), 1)
        ker = cv2.warpAffine(ker, M, (k, k)); ker /= ker.sum()
        img = cv2.filter2D(img, -1, ker)
    # gamma / exposition
    img = np.clip(img, 0, 1) ** rng.uniform(0.8, 1.25)
    # bruit
    sig = rng.uniform(0.002, 0.025)
    img = img + rng.normal(0, sig, img.shape).astype(np.float32)
    img = np.clip(img * 255, 0, 255).astype(np.uint8)
    q = int(rng.uniform(35, 95))
    ok, enc = cv2.imencode('.jpg', img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, q])
    img = cv2.imdecode(enc, cv2.IMREAD_COLOR)[..., ::-1]
    return img, mask


def sample(rng):
    sheet = render_sheet(rng)
    img, mask2, poly, kind = render_lens(rng, sheet)
    img = lighting(rng, img)
    img = intruders(rng, img, mask2)
    img = cv2.resize(np.clip(img, 0, 1.5), (W, H), interpolation=cv2.INTER_AREA)
    mask = cv2.resize(mask2, (W, H), interpolation=cv2.INTER_AREA)
    img, mask = camera(rng, img, mask)
    return img, mask, poly, kind


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='data/synth')
    ap.add_argument('--n', type=int, default=4000)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--clear', type=float, default=0.43, help='proportion de verres clairs')
    args = ap.parse_args()
    global KINDS
    nc = int(round(args.clear * 20))
    others = ['dark', 'light', 'color', 'dark', 'dark', 'light', 'color', 'dark', 'light', 'color', 'dark']
    KINDS = ['clear'] * nc + [others[i % len(others)] for i in range(20 - nc)]
    os.makedirs(args.out, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    meta = []
    for i in range(args.start, args.start + args.n):
        img, mask, poly, kind = sample(rng)
        cv2.imwrite(os.path.join(args.out, f'{i:05d}.jpg'), img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(args.out, f'{i:05d}_m.png'), np.clip(mask * 255 + 0.5, 0, 255).astype(np.uint8))
        np.save(os.path.join(args.out, f'{i:05d}_poly.npy'), poly.astype(np.float32))
        meta.append(f'{i:05d},{kind}')
        if (i + 1) % 200 == 0:
            print(i + 1, flush=True)
    with open(os.path.join(args.out, f'meta_{args.start}.csv'), 'w') as f:
        f.write('\n'.join(meta))


if __name__ == '__main__':
    main()
