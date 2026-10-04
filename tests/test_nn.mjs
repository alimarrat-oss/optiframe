// Le moteur JS du U-Net (js/nn/unet.js) doit reproduire PyTorch (fixtures écrites par training/export.py).
import { readFileSync } from 'fs';
import { LensUNet } from '../js/nn/unet.js';
const base = process.argv[2] || new URL('../models/lensunet', import.meta.url).pathname;
const man = JSON.parse(readFileSync(base + '.json'));
const wb = readFileSync(base + '.bin');
const net = new LensUNet(man, new Float32Array(wb.buffer, wb.byteOffset, wb.length / 4));
const f32 = (p) => { const b = readFileSync(new URL(p, import.meta.url)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const x = f32('./fixtures/nn_in_3x64x96.bin'), yref = f32('./fixtures/nn_out_64x96.bin');
const y = net.forward(x, 64, 96);
let md = 0; for (let i = 0; i < y.length; i++) md = Math.max(md, Math.abs(y[i] - yref[i]));
console.log('JS vs PyTorch : écart max', md.toExponential(2), md < 1e-4 ? 'OK' : 'ÉCHEC');
// vitesse sur la taille réelle (448 x 320)
const big = new Float32Array(3 * 320 * 448).map(() => Math.random() - 0.5);
const t0 = performance.now(); net.forward(big, 320, 448);
console.log('inférence 448x320 :', Math.round(performance.now() - t0), 'ms');
if (md >= 1e-4) process.exit(1);
