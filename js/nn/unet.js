// Moteur d'inférence minimal (JavaScript pur) pour le U-Net OptiFrame.
// Opérations : conv 3x3 (+ biais, BatchNorm déjà fusionnée), ReLU, max-pool 2x2,
// sur-échantillonnage bilinéaire (align_corners=false), concaténation, conv 1x1.
// Format des poids : models/lensunet.json (architecture + décalages) + models/lensunet.bin (float32).
// Vérifié identique à PyTorch / ONNX Runtime (voir training/export.py et tests/test_nn.mjs).

function conv3x3(inp, cin, H, W, w, wOff, b, bOff, cout, relu) {
  // Bloc de 4 canaux de sortie x 1 ligne : chaque ligne d'entrée lue une fois sert 12 MAC.
  const HW = H * W;
  const out = new Float32Array(cout * HW);
  const acc = [new Float32Array(W), new Float32Array(W), new Float32Array(W), new Float32Array(W)];
  const wk = new Float32Array(36);
  for (let co = 0; co < cout; co += 4) {
    const nb = Math.min(4, cout - co);
    for (let y = 0; y < H; y++) {
      for (let k = 0; k < 4; k++) acc[k].fill(k < nb ? b[bOff + co + k] : 0);
      const a0 = acc[0], a1 = acc[1], a2 = acc[2], a3 = acc[3];
      for (let ci = 0; ci < cin; ci++) {
        const cb = ci * HW;
        for (let ky = 0; ky < 3; ky++) {
          const yy = y + ky - 1;
          if (yy < 0 || yy >= H) continue;
          const rb = cb + yy * W;
          for (let k = 0; k < 4; k++) {
            const base = wOff + ((co + (k < nb ? k : 0)) * cin + ci) * 9 + ky * 3;
            const z = k < nb ? 1 : 0;
            wk[k * 3] = w[base] * z; wk[k * 3 + 1] = w[base + 1] * z; wk[k * 3 + 2] = w[base + 2] * z;
          }
          const w00 = wk[0], w01 = wk[1], w02 = wk[2], w10 = wk[3], w11 = wk[4], w12 = wk[5];
          const w20 = wk[6], w21 = wk[7], w22 = wk[8], w30 = wk[9], w31 = wk[10], w32 = wk[11];
          // x = 0
          {
            const bv = inp[rb], cv = W > 1 ? inp[rb + 1] : 0;
            a0[0] += w01 * bv + w02 * cv; a1[0] += w11 * bv + w12 * cv; a2[0] += w21 * bv + w22 * cv; a3[0] += w31 * bv + w32 * cv;
          }
          for (let x = 1; x < W - 1; x++) {
            const av = inp[rb + x - 1], bv = inp[rb + x], cv = inp[rb + x + 1];
            a0[x] += w00 * av + w01 * bv + w02 * cv;
            a1[x] += w10 * av + w11 * bv + w12 * cv;
            a2[x] += w20 * av + w21 * bv + w22 * cv;
            a3[x] += w30 * av + w31 * bv + w32 * cv;
          }
          if (W > 1) {
            const x = W - 1, av = inp[rb + x - 1], bv = inp[rb + x];
            a0[x] += w00 * av + w01 * bv; a1[x] += w10 * av + w11 * bv; a2[x] += w20 * av + w21 * bv; a3[x] += w30 * av + w31 * bv;
          }
        }
      }
      for (let k = 0; k < nb; k++) {
        const o = (co + k) * HW + y * W, a = acc[k];
        if (relu) for (let x = 0; x < W; x++) out[o + x] = a[x] > 0 ? a[x] : 0;
        else out.set(a, o);
      }
    }
  }
  return out;
}

function conv1x1(inp, cin, HW, w, wOff, b, bOff, cout) {
  const out = new Float32Array(cout * HW);
  for (let co = 0; co < cout; co++) {
    const o = out.subarray(co * HW, (co + 1) * HW);
    o.fill(b[bOff + co]);
    for (let ci = 0; ci < cin; ci++) {
      const wv = w[wOff + co * cin + ci];
      const ip = inp.subarray(ci * HW, (ci + 1) * HW);
      for (let i = 0; i < HW; i++) o[i] += wv * ip[i];
    }
  }
  return out;
}

function maxpool2(inp, c, H, W) {
  const h = H >> 1, w = W >> 1;
  const out = new Float32Array(c * h * w);
  for (let ch = 0; ch < c; ch++) {
    const ib = ch * H * W, ob = ch * h * w;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ib + 2 * y * W + 2 * x;
      out[ob + y * w + x] = Math.max(inp[i], inp[i + 1], inp[i + W], inp[i + W + 1]);
    }
  }
  return { data: out, h, w };
}

// Bilinéaire, align_corners = false (comme torch.nn.functional.interpolate).
function upsample(inp, c, h, w, H, W) {
  const out = new Float32Array(c * H * W);
  const sy = h / H, sx = w / W;
  const xi0 = new Int32Array(W), xi1 = new Int32Array(W), xf = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let s = (x + 0.5) * sx - 0.5; if (s < 0) s = 0;
    const i0 = Math.min(Math.floor(s), w - 1);
    xi0[x] = i0; xi1[x] = Math.min(i0 + 1, w - 1); xf[x] = s - i0;
  }
  for (let y = 0; y < H; y++) {
    let s = (y + 0.5) * sy - 0.5; if (s < 0) s = 0;
    const j0 = Math.min(Math.floor(s), h - 1), j1 = Math.min(j0 + 1, h - 1), fy = s - j0;
    for (let ch = 0; ch < c; ch++) {
      const ib = ch * h * w, ob = ch * H * W + y * W;
      const r0 = ib + j0 * w, r1 = ib + j1 * w;
      for (let x = 0; x < W; x++) {
        const a = inp[r0 + xi0[x]] + (inp[r0 + xi1[x]] - inp[r0 + xi0[x]]) * xf[x];
        const b = inp[r1 + xi0[x]] + (inp[r1 + xi1[x]] - inp[r1 + xi0[x]]) * xf[x];
        out[ob + x] = a + (b - a) * fy;
      }
    }
  }
  return out;
}

function concat(a, ca, b, cb, HW) {
  const out = new Float32Array((ca + cb) * HW);
  out.set(a.subarray(0, ca * HW), 0);
  out.set(b.subarray(0, cb * HW), ca * HW);
  return out;
}

export class LensUNet {
  constructor(manifest, weights) {
    this.m = manifest;
    this.w = weights; // Float32Array
  }

  static async load(baseUrl) {
    const man = await (await fetch(baseUrl + '.json')).json();
    const buf = await (await fetch(baseUrl + '.bin')).arrayBuffer();
    return new LensUNet(man, new Float32Array(buf));
  }

  layer(name) { return this.m.layers[name]; }

  conv(x, cin, H, W, name, relu = true) {
    const L = this.layer(name);
    return conv3x3(x, cin, H, W, this.w, L.w, this.w, L.b, L.cout, relu);
  }

  // x : Float32Array CHW (3 x H x W), valeurs RGB/255 - 0.5. Renvoie les logits (H x W).
  forward(x, H, W, onProgress) {
    const ch = this.m.channels;
    const n = ch.length;
    const skips = [];
    let cur = x, c = 3, h = H, w = W;
    let step = 0;
    const total = 2 * n - 1;
    for (let i = 0; i < n; i++) {
      cur = this.conv(cur, c, h, w, `enc${i}.0`);
      cur = this.conv(cur, ch[i], h, w, `enc${i}.1`);
      c = ch[i];
      if (onProgress) onProgress(++step / total);
      if (i < n - 1) {
        skips.push({ data: cur, c, h, w });
        const p = maxpool2(cur, c, h, w);
        cur = p.data; h = p.h; w = p.w;
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const s = skips.pop();
      const up = upsample(cur, c, h, w, s.h, s.w);
      const cat = concat(up, c, s.data, s.c, s.h * s.w);
      const i = n - 2 - k;
      cur = this.conv(cat, c + s.c, s.h, s.w, `dec${k}.0`);
      cur = this.conv(cur, ch[i], s.h, s.w, `dec${k}.1`);
      c = ch[i]; h = s.h; w = s.w;
      if (onProgress) onProgress(++step / total);
    }
    const L = this.layer('head');
    return conv1x1(cur, c, h * w, this.w, L.w, this.w, L.b, 1);
  }
}
