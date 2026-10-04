// Web Worker : analyse des photos (vision + IA) et génération de la monture, hors du fil d'affichage.
import { analyzePhoto } from './vision/pipeline.js';
import { LensUNet } from './nn/unet.js';
import { loadManifold, buildFrame, meshToSTL } from './frame/frame.js';

let net = null, netError = null, netPromise = null;
let base = '';

function loadNet() {
  if (!netPromise) {
    netPromise = LensUNet.load(base + 'models/lensunet').then((n) => { net = n; return n; })
      .catch((e) => { netError = String(e); return null; });
  }
  return netPromise;
}

function pack(r) {
  const out = {
    ok: r.ok, error: r.error, method: r.method, contour: r.contour, rawContour: r.rawContour, measures: r.measures,
    pose: r.pose, parallaxMax: r.parallaxMax, blurMm: r.blurMm, pxPerMm: r.pxPerMm, warnings: r.warnings,
    timings: r.timings, found: r.found, edgeSharpness: r.edgeSharpness,
  };
  const transfer = [];
  if (r.sheet && r.sheet.ok) {
    out.sheet = { H: r.sheet.H, Hs2i: r.sheet.Hs2i, markers: r.sheet.markers, orientation: r.sheet.orientation, markerSidesMm: r.sheet.markerSidesMm };
  }
  if (r.rect) {
    const d = r.rect.imageData;
    const buf = new Uint8ClampedArray(d.data);
    out.rect = { width: d.width, height: d.height, data: buf, srcPxPerMm: r.rect.srcPxPerMm, ss: r.rect.ss };
    transfer.push(buf.buffer);
  }
  if (r.prob) {
    const p = new Uint8Array(r.prob.length);
    for (let i = 0; i < p.length; i++) p[i] = Math.round(r.prob[i] * 255);
    out.prob = p;
    transfer.push(p.buffer);
  }
  return { out, transfer };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      base = msg.base || '';
      await loadNet();
      self.postMessage({ type: 'init', ok: !!net, error: netError, params: net ? net.m.params : 0 });
    } else if (msg.type === 'analyze') {
      await loadNet();
      const img = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) };
      const r = await analyzePhoto(img, {
        ...msg.opts, net: msg.opts.useAI === false ? null : net,
        onProgress: (step, frac) => self.postMessage({ type: 'progress', id: msg.id, step, frac }),
      });
      const { out, transfer } = pack(r);
      self.postMessage({ type: 'analyze', id: msg.id, result: out }, transfer);
    } else if (msg.type === 'frame') {
      const wasm = await loadManifold(base + 'lib/manifold/manifold.js');
      const t0 = performance.now();
      const r = buildFrame(wasm, msg.od, msg.og, msg.params);
      const stl = meshToSTL(r.mesh);
      const np = r.mesh.numProp;
      const V = r.mesh.vertProperties, n = V.length / np;
      const positions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { positions[3 * i] = V[i * np]; positions[3 * i + 1] = V[i * np + 1]; positions[3 * i + 2] = V[i * np + 2]; }
      const indices = new Uint32Array(r.mesh.triVerts);
      const check = r.check.map((c) => c && { mean: c.mean, max: c.max, min: c.min, hole: c.hole });
      const res = {
        positions, indices, stl, stats: r.stats, check, lenses: r.lenses, outline: r.outline, profile: r.profile,
        params: r.params, ms: performance.now() - t0,
      };
      r.frame.delete();
      self.postMessage({ type: 'frame', id: msg.id, result: res }, [positions.buffer, indices.buffer, stl]);
    }
  } catch (e) {
    self.postMessage({ type: msg.type, id: msg.id, error: String(e && e.stack || e) });
  }
};
