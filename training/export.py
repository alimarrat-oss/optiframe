"""Export du U-Net entraîné :
  * models/lensunet.bin + .json : poids float32 (BatchNorm fusionnées) pour le moteur JS de l'app ;
  * models/lensunet.onnx       : même réseau au format ONNX (ONNX Runtime, Netron...).
Vérifie aussi que le graphe fusionné donne les mêmes sorties que le modèle PyTorch.

python export.py --ckpt runs/v1/best.pt --out ../models/lensunet
"""
import argparse
import json

import numpy as np
import torch
import torch.nn as nn

from model import LensUNet


def fuse(conv, bn):
    w = conv.weight.detach().double()
    g = bn.weight.detach().double()
    b = bn.bias.detach().double()
    mu = bn.running_mean.detach().double()
    var = bn.running_var.detach().double()
    s = g / torch.sqrt(var + bn.eps)
    wf = w * s[:, None, None, None]
    bf = b - mu * s
    if conv.bias is not None:
        bf = bf + conv.bias.detach().double() * s
    return wf.float(), bf.float()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--out', default='../models/lensunet')
    args = ap.parse_args()
    model = LensUNet()
    model.load_state_dict(torch.load(args.ckpt, map_location='cpu'))
    model.eval()

    chunks, layers, off = [], {}, 0

    def add(name, w, b):
        nonlocal off
        wn = w.numpy().astype(np.float32).ravel()
        bn = b.numpy().astype(np.float32).ravel()
        layers[name] = {'w': off, 'b': off + wn.size, 'cout': int(b.numel()), 'cin': int(w.shape[1]), 'k': int(w.shape[2])}
        chunks.extend([wn, bn])
        off += wn.size + bn.size

    for i, blk in enumerate(model.enc):
        for j in range(2):
            w, b = fuse(blk[j][0], blk[j][1])
            add(f'enc{i}.{j}', w, b)
    for k, blk in enumerate(model.dec):
        for j in range(2):
            w, b = fuse(blk[j][0], blk[j][1])
            add(f'dec{k}.{j}', w, b)
    add('head', model.head.weight.detach(), model.head.bias.detach())
    flat = np.concatenate(chunks).astype('<f4')
    flat.tofile(args.out + '.bin')
    man = {'name': 'OptiFrame LensUNet', 'channels': list(model.ch), 'input': {'res_mm': 0.25, 'x0': -4, 'y0': -4,
           'width': 448, 'height': 320, 'norm': 'rgb/255 - 0.5'}, 'layers': layers, 'params': int(flat.size)}
    json.dump(man, open(args.out + '.json', 'w'), indent=1)
    print('poids :', flat.size, 'float32 =', round(flat.nbytes / 1e6, 2), 'Mo')

    # ONNX
    dummy = torch.zeros(1, 3, 320, 448)
    torch.onnx.export(model, dummy, args.out + '.onnx', input_names=['image'], output_names=['logits'],
                      dynamic_axes={'image': {2: 'h', 3: 'w'}, 'logits': {2: 'h', 3: 'w'}}, opset_version=17, dynamo=False)
    try:
        import onnxruntime as ort
        x = torch.rand(1, 3, 320, 448) - 0.5
        ref = model(x).detach().numpy()
        sess = ort.InferenceSession(args.out + '.onnx')
        got = sess.run(None, {'image': x.numpy()})[0]
        print('ONNX vs PyTorch : écart max', float(np.abs(ref - got).max()))
        # petit couple entrée/sortie de référence pour tests/test_nn.mjs (le réseau est entièrement convolutif)
        import os
        fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tests', 'fixtures')
        os.makedirs(fx, exist_ok=True)
        torch.manual_seed(0)
        xs = torch.rand(1, 3, 64, 96) - 0.5
        xs.numpy().astype('<f4').tofile(os.path.join(fx, 'nn_in_3x64x96.bin'))
        model(xs).detach().numpy().astype('<f4').tofile(os.path.join(fx, 'nn_out_64x96.bin'))
    except ImportError:
        pass


if __name__ == '__main__':
    main()
