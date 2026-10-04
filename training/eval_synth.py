"""Évaluation du U-Net sur le jeu synthétique de validation (images jamais vues).

Mesure : IoU, erreur de bord (distance moyenne contour prédit -> contour vrai, mm),
erreur absolue sur A et B (boxing) par type de verre, et comparaison avec le seuillage classique.

python eval_synth.py --ckpt runs/v1/best.pt --val /chemin/synth_val --out results_synth.json
"""
import argparse
import glob
import json
import os

import cv2
import numpy as np
import torch

from model import LensUNet

RES = 0.25


def contour_ab(prob, thr=0.5, up=4):
    p = cv2.resize(prob, None, fx=up, fy=up, interpolation=cv2.INTER_LINEAR)
    m = (p >= thr).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n < 2:
        return None
    k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    mk = (lab == k).astype(np.uint8)
    cs, _ = cv2.findContours(mk, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    c = (c + 0.5) / up - 0.5  # pixels du réseau
    x0, x1 = c[:, 0].min(), c[:, 0].max()
    y0, y1 = c[:, 1].min(), c[:, 1].max()
    # +1 px/up : les bornes de pixels entourent le bord
    return (x1 - x0 + 1 / up) * RES, (y1 - y0 + 1 / up) * RES, c


def classical(img):
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
    cl = cv2.morphologyEx(g, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    paper = cv2.blur(cv2.dilate(cl, np.ones((25, 25), np.uint8)), (25, 25))
    n = cl / np.maximum(paper, 1)
    p = np.clip((0.82 - n) / 0.2, 0, 1)
    m = (p > 0.5).astype(np.uint8)
    # bouchage des trous
    ff = m.copy()
    h, w = m.shape
    mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, mask, (0, 0), 1)
    filled = m | (1 - ff)
    return filled.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--val', required=True)
    ap.add_argument('--out', default='results_synth.json')
    a = ap.parse_args()
    model = LensUNet()
    model.load_state_dict(torch.load(a.ckpt, map_location='cpu'))
    model.eval()
    kinds = {}
    for f in glob.glob(os.path.join(a.val, 'meta_*.csv')):
        for line in open(f):
            i, k = line.strip().split(',')
            kinds[i] = k
    rows = []
    for f in sorted(glob.glob(os.path.join(a.val, '*[0-9].jpg'))):
        sid = os.path.basename(f)[:-4]
        img = cv2.imread(f)[..., ::-1].copy()
        gt = cv2.imread(f.replace('.jpg', '_m.png'), 0).astype(np.float32) / 255
        poly = np.load(f.replace('.jpg', '_poly.npy'))
        A_gt = poly[:, 0].max() - poly[:, 0].min()
        B_gt = poly[:, 1].max() - poly[:, 1].min()
        with torch.no_grad():
            x = torch.from_numpy(img.astype(np.float32).transpose(2, 0, 1) / 255 - 0.5)[None]
            prob = torch.sigmoid(model(x))[0, 0].numpy()
        r = {'id': sid, 'kind': kinds.get(sid, '?'), 'A_gt': float(A_gt), 'B_gt': float(B_gt)}
        for name, pm in (('ai', prob), ('classic', classical(img))):
            res = contour_ab(pm)
            if res is None:
                r[name] = None
                continue
            A, B, c = res
            pb = pm >= 0.5
            gb = gt >= 0.5
            iou = (pb & gb).sum() / max(1, (pb | gb).sum())
            gc, _ = cv2.findContours(gb.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            dt = cv2.distanceTransform(1 - cv2.drawContours(np.zeros(gt.shape, np.uint8), gc, -1, 1, 1), cv2.DIST_L2, 5)
            ci = np.clip(np.round(c).astype(int), 0, [gt.shape[1] - 1, gt.shape[0] - 1])
            berr = float(dt[ci[:, 1], ci[:, 0]].mean() * RES)
            r[name] = {'A': float(A), 'B': float(B), 'eA': float(A - A_gt), 'eB': float(B - B_gt), 'iou': float(iou), 'bord': berr}
        rows.append(r)

    def summary(sel, name):
        v = [r[name] for r in sel if r[name] is not None]
        fail = sum(1 for r in sel if r[name] is None or abs(r[name]['eA']) > 5 or abs(r[name]['eB']) > 5)
        if not v:
            return {'n': len(sel), 'echecs': fail}
        eA = np.array([x['eA'] for x in v]); eB = np.array([x['eB'] for x in v])
        ok = (np.abs(eA) <= 5) & (np.abs(eB) <= 5)
        mae = (np.abs(eA[ok]).mean() + np.abs(eB[ok]).mean()) / 2 if ok.any() else float('nan')
        within1 = float(np.mean((np.abs(eA) + np.abs(eB)) / 2 <= 1.0))
        return {'n': len(sel), 'IoU': float(np.mean([x['iou'] for x in v])), 'bord_mm': float(np.median([x['bord'] for x in v])),
                'MAE_AB_mm': float(mae), 'biais_A': float(np.median(eA)), 'biais_B': float(np.median(eB)),
                'part_erreur_moy_<=1mm': within1, 'echecs_>5mm': int(fail)}

    out = {}
    for name in ('ai', 'classic'):
        out[name] = {'tous': summary(rows, name)}
        for k in sorted(set(r['kind'] for r in rows)):
            out[name][k] = summary([r for r in rows if r['kind'] == k], name)
    json.dump({'summary': out, 'rows': rows}, open(a.out, 'w'), indent=1)
    for name in out:
        print('==', name)
        for k, s in out[name].items():
            print(f'  {k:6s}', {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in s.items()})


if __name__ == '__main__':
    main()
