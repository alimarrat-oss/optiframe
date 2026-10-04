"""Entraînement du U-Net OptiFrame sur les données synthétiques (CPU suffisant).

python train.py --data /chemin/synth --val /chemin/synth_val --epochs 12 --out runs/v1
"""
import argparse
import glob
import math
import os
import time

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from model import LensUNet, count_params

torch.set_num_threads(max(1, os.cpu_count() or 1))


def load_pair(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)[..., ::-1]
    m = cv2.imread(path.replace('.jpg', '_m.png'), cv2.IMREAD_GRAYSCALE)
    return img, m


class SynthSet(Dataset):
    def __init__(self, files, crop=256, train=True, seed=0):
        self.files = files
        self.crop = crop
        self.train = train
        self.rng = np.random.default_rng(seed)

    def __len__(self):
        return len(self.files)

    def aug(self, img, m):
        r = self.rng
        h, w = m.shape
        if self.crop and (h > self.crop or w > self.crop):
            # recadrage aléatoire, biaisé vers le verre une fois sur deux
            if r.random() < 0.5 and m.max() > 127:
                ys, xs = np.nonzero(m > 127)
                k = r.integers(len(xs))
                cy, cx = ys[k], xs[k]
                y0 = int(np.clip(cy - r.integers(self.crop), 0, h - self.crop))
                x0 = int(np.clip(cx - r.integers(self.crop), 0, w - self.crop))
            else:
                y0 = int(r.integers(0, h - self.crop + 1))
                x0 = int(r.integers(0, w - self.crop + 1))
            img = img[y0:y0 + self.crop, x0:x0 + self.crop]
            m = m[y0:y0 + self.crop, x0:x0 + self.crop]
        if r.random() < 0.5:
            img, m = img[:, ::-1], m[:, ::-1]
        if r.random() < 0.5:
            img, m = img[::-1], m[::-1]
        img = img.astype(np.float32) / 255.0
        # couleur : luminosité, contraste, saturation, gamma
        img = img * r.uniform(0.75, 1.2) + r.uniform(-0.06, 0.06)
        g = img.mean(2, keepdims=True)
        img = g + (img - g) * r.uniform(0.6, 1.3)
        if r.random() < 0.1:
            img = np.repeat(img.mean(2, keepdims=True), 3, 2)
        img = np.clip(img, 0, 1) ** r.uniform(0.85, 1.2)
        if r.random() < 0.3:
            img = img + r.normal(0, r.uniform(0.005, 0.02), img.shape).astype(np.float32)
        return np.ascontiguousarray(img), np.ascontiguousarray(m)

    def __getitem__(self, i):
        img, m = load_pair(self.files[i])
        if self.train:
            img, m = self.aug(img, m)
        else:
            img = img.astype(np.float32) / 255.0
        x = torch.from_numpy(img.transpose(2, 0, 1).copy()) - 0.5
        y = torch.from_numpy(m.astype(np.float32)[None] / 255.0)
        return x, y


def loss_fn(logits, target):
    # poids plus forts près du bord : c'est là que se joue le millimètre
    edge = F.max_pool2d(target, 5, 1, 2) - (-F.max_pool2d(-target, 5, 1, 2))
    wgt = 1.0 + 4.0 * (edge > 0.02).float()
    bce = F.binary_cross_entropy_with_logits(logits, target, weight=wgt)
    p = torch.sigmoid(logits)
    inter = (p * target).sum((1, 2, 3))
    dice = 1 - (2 * inter + 1) / (p.sum((1, 2, 3)) + target.sum((1, 2, 3)) + 1)
    return bce + 0.5 * dice.mean()


@torch.no_grad()
def evaluate(model, loader):
    model.eval()
    ious, berrs = [], []
    for x, y in loader:
        p = torch.sigmoid(model(x))
        for k in range(x.shape[0]):
            pk = p[k, 0].numpy()
            yk = y[k, 0].numpy()
            a = pk > 0.5
            b = yk > 0.5
            inter = (a & b).sum()
            uni = (a | b).sum()
            ious.append(inter / max(uni, 1))
            # erreur de bord : distance moyenne entre les deux contours (mm, 0,25 mm/px)
            ca, _ = cv2.findContours(a.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            cb, _ = cv2.findContours(b.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if ca and cb:
                ca = max(ca, key=cv2.contourArea)
                cb = max(cb, key=cv2.contourArea)
                dt = cv2.distanceTransform((1 - cv2.drawContours(np.zeros_like(yk, np.uint8), [cb], -1, 1, 1)).astype(np.uint8), cv2.DIST_L2, 5)
                pts = ca[:, 0, :]
                berrs.append(dt[pts[:, 1], pts[:, 0]].mean() * 0.25)
    model.train()
    return float(np.mean(ious)), float(np.mean(berrs)) if berrs else float('nan')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--val', required=True)
    ap.add_argument('--epochs', type=int, default=12)
    ap.add_argument('--bs', type=int, default=12)
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--crop', type=int, default=256)
    ap.add_argument('--out', default='runs/v1')
    ap.add_argument('--resume', default='')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    tr_files = sorted(glob.glob(os.path.join(args.data, '*[0-9].jpg')))
    va_files = sorted(glob.glob(os.path.join(args.val, '*[0-9].jpg')))
    print('train', len(tr_files), 'val', len(va_files), flush=True)
    tr = DataLoader(SynthSet(tr_files, args.crop, True), batch_size=args.bs, shuffle=True, num_workers=1,
                    drop_last=True, persistent_workers=True)
    va = DataLoader(SynthSet(va_files, 0, False), batch_size=8, shuffle=False, num_workers=0)
    model = LensUNet()
    if args.resume:
        model.load_state_dict(torch.load(args.resume))
    print('params', count_params(model), flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    total = args.epochs * len(tr)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=total, pct_start=0.08)
    step = 0
    best = -1
    log = open(os.path.join(args.out, 'log.csv'), 'a')
    for ep in range(args.epochs):
        t0 = time.time()
        run = 0.0
        for x, y in tr:
            logits = model(x)
            loss = loss_fn(logits, y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            step += 1
            run = 0.98 * run + 0.02 * loss.item() if step > 1 else loss.item()
            if step % 50 == 0:
                print(f'ep {ep} step {step}/{total} loss {run:.4f} {time.time() - t0:.0f}s', flush=True)
        iou, berr = evaluate(model, va)
        print(f'== epoch {ep} val IoU {iou:.4f} bord {berr:.3f} mm ({time.time() - t0:.0f}s)', flush=True)
        log.write(f'{ep},{run:.5f},{iou:.5f},{berr:.4f}\n')
        log.flush()
        torch.save(model.state_dict(), os.path.join(args.out, 'last.pt'))
        if iou > best:
            best = iou
            torch.save(model.state_dict(), os.path.join(args.out, 'best.pt'))


if __name__ == '__main__':
    main()
