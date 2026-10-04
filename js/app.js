// OptiFrame — contrôleur de l'interface.
import { t, setLang, getLang, applyI18n, fmt } from './i18n.js';
import { readExifFocal35 } from './exif.js';
import { contoursSVG } from './frame/svg.js';
import { FRAME_DEFAULTS } from './frame/frame.js';
import { bbox } from './vision/geom.js';
import { MODEL_FRAME } from './vision/rectify.js';

const VERSION = '1.0.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EYES = ['OD', 'OG'];
const MAX_SIDE = 3000; // px : assez pour ~8 px/mm sur la grille, compatible avec les limites iOS

const S = {
  lenses: { OD: newLens(), OG: newLens() },
  params: { ...FRAME_DEFAULTS },
  settings: { sheetX: 100, sheetY: 70, edgeH: 2.0, gridRef: false },
  frame: null, frameBusy: false, frameDirty: true,
  last: null, modelOk: null,
};
function newLens() { return { shots: [], active: -1, avg: false, mirror: false, rot: false }; }

// ------------------------------------------------------------------ Worker
let worker = null, reqId = 0;
const pending = new Map();
let mainThreadFallback = null;
function startWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') { const p = pending.get(m.id); if (p && p.onProgress) p.onProgress(m.step, m.frac); return; }
      if (m.type === 'init') { onModel(m); return; }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    };
    worker.onerror = (e) => { console.error(e); worker = null; };
    worker.postMessage({ type: 'init', base: new URL('../', import.meta.url).href });
  } catch (e) {
    console.warn('module worker indisponible, traitement sur le fil principal', e);
    worker = null;
    initMainThread();
  }
}
async function initMainThread() {
  const [{ analyzePhoto }, { LensUNet }, fr] = await Promise.all([import('./vision/pipeline.js'), import('./nn/unet.js'), import('./frame/frame.js')]);
  let net = null;
  try { net = await LensUNet.load(new URL('../models/lensunet', import.meta.url).href); } catch (e) { /* repli */ }
  mainThreadFallback = { analyzePhoto, net, fr };
  onModel({ ok: !!net });
}
function call(type, payload, transfer = [], onProgress) {
  if (!worker) return callMain(type, payload, onProgress);
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ type, id, ...payload }, transfer);
  });
}
async function callMain(type, payload, onProgress) {
  while (!mainThreadFallback) await new Promise((r) => setTimeout(r, 100));
  const F = mainThreadFallback;
  if (type === 'analyze') {
    const img = { width: payload.width, height: payload.height, data: new Uint8ClampedArray(payload.buffer) };
    const r = await F.analyzePhoto(img, { ...payload.opts, net: F.net, onProgress });
    if (r.prob) { const p = new Uint8Array(r.prob.length); for (let i = 0; i < p.length; i++) p[i] = Math.round(r.prob[i] * 255); r.prob = p; }
    if (r.rect) r.rect = { ...r.rect.imageData, srcPxPerMm: r.rect.srcPxPerMm };
    return r;
  }
  const wasm = await F.fr.loadManifold(new URL('../lib/manifold/manifold.js', import.meta.url).href);
  const r = F.fr.buildFrame(wasm, payload.od, payload.og, payload.params);
  const np = r.mesh.numProp, V = r.mesh.vertProperties, n = V.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { positions[3 * i] = V[i * np]; positions[3 * i + 1] = V[i * np + 1]; positions[3 * i + 2] = V[i * np + 2]; }
  return { positions, indices: new Uint32Array(r.mesh.triVerts), stl: F.fr.meshToSTL(r.mesh), stats: r.stats, check: r.check, lenses: r.lenses, outline: r.outline, profile: r.profile, params: r.params };
}
function onModel(m) {
  S.modelOk = m.ok;
  if (m.params) S.modelParams = m.params;
  const el = $('#modelStatus');
  if (m.ok == null) { el.textContent = t('modelLoading'); return; }
  el.textContent = m.ok ? `✓ ${t('modelReady')} (U-Net, ${Math.round((S.modelParams || 0) / 1000)} k param.)` : t('err-model');
  el.style.color = m.ok ? '' : 'var(--warn)';
}

// ------------------------------------------------------------------ Images
function loadImg(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
// Dessine une source (image, canvas) en limitant la taille ; l'orientation EXIF est appliquée par le navigateur.
function toCanvas(src, maxSide) {
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
async function fileToSource(blob) {
  const buf = await blob.arrayBuffer();
  const exif = readExifFocal35(buf);
  const url = URL.createObjectURL(blob);
  try {
    const im = await loadImg(url);
    return { canvas: toCanvas(im, MAX_SIDE), focal35: exif ? exif.focal35 : null };
  } finally { URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------------ Analyse
let busyStep = null;
function showBusy(on) {
  $('#busy').classList.toggle('open', on);
  $$('#busy .busy-steps li').forEach((li) => li.classList.remove('done', 'now'));
  busyStep = null;
}
function progress(step) {
  const order = ['markers', 'rectify', 'segment', 'contour'];
  const k = order.indexOf(step);
  $$('#busy .busy-steps li').forEach((li, i) => { li.classList.toggle('done', i < k); li.classList.toggle('now', i === k); });
  busyStep = step;
}

async function analyze(eye, src) {
  showBusy(true);
  try {
    const canvas = src.canvas;
    const thumb = toCanvas(canvas, 900);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const opts = {
      focal35: src.focal35 || null, edgeHeight: S.settings.edgeH, gridRefine: !!S.settings.gridRef,
      sheetScaleX: S.settings.sheetX / 100, sheetScaleY: S.settings.sheetY / 70,
    };
    const r = await call('analyze', { width: id.width, height: id.height, buffer: id.data.buffer, opts }, [id.data.buffer], progress);
    const shot = { eye, result: r, thumb, thumbScale: thumb.width / canvas.width, time: new Date(), src: src.label || '' };
    S.last = shot;
    renderSteps();
    const L = S.lenses[eye];
    if (r.ok) {
      L.shots.push(shot);
      L.active = L.shots.length - 1;
      L.error = null;
      S.frameDirty = true;
    } else {
      L.error = r.error;
      L.errorShot = shot;
    }
    renderLens(eye);
    return r;
  } catch (e) {
    console.error(e);
    S.lenses[eye].error = 'generic';
    renderLens(eye);
  } finally {
    showBusy(false);
  }
}

// ------------------------------------------------------------------ Contours effectifs
function polarAround(P, c, n = 720) {
  const r = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const th = (k / n) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
    let best = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const ax = a[0] - c[0], ay = a[1] - c[1], bx = b[0] - c[0], by = b[1] - c[1];
      const dx = bx - ax, dy = by - ay;
      const den = ux * dy - uy * dx;
      if (Math.abs(den) < 1e-12) continue;
      const tt = (ax * dy - ay * dx) / den, s = (ax * uy - ay * ux) / den;
      if (s >= 0 && s <= 1 && tt > best) best = tt;
    }
    r[k] = best;
  }
  return r;
}
function averageContours(list) {
  const n = 720;
  const cs = list.map((P) => { const b = bbox(P); return [b.cx, b.cy]; });
  const c = [cs.reduce((s, v) => s + v[0], 0) / cs.length, cs.reduce((s, v) => s + v[1], 0) / cs.length];
  const acc = new Float64Array(n);
  list.forEach((P, i) => { const r = polarAround(P, cs[i], n); for (let k = 0; k < n; k++) acc[k] += r[k] / list.length; });
  const out = [];
  for (let k = 0; k < n; k++) { const th = (k / n) * 2 * Math.PI; out.push([c[0] + acc[k] * Math.cos(th), c[1] + acc[k] * Math.sin(th)]); }
  return out;
}
function lensContour(eye) {
  const L = S.lenses[eye];
  if (!L.shots.length) return null;
  if (L.avg && L.shots.length > 1) return averageContours(L.shots.map((s) => s.result.contour));
  return L.shots[Math.max(0, L.active)].result.contour;
}
function lensMeasures(eye) {
  const P = lensContour(eye);
  if (!P) return null;
  const b = bbox(P);
  let per = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; per += Math.hypot(c[0] - a[0], c[1] - a[1]); }
  let ed = 0;
  for (const p of P) ed = Math.max(ed, Math.hypot(p[0] - b.cx, p[1] - b.cy));
  return { A: b.w, B: b.h, perimeter: per, ED: 2 * ed };
}

// ------------------------------------------------------------------ Cartes « verre »
function buildCards() {
  const host = $('#lensCards');
  host.innerHTML = '';
  for (const eye of EYES) {
    const el = document.createElement('div');
    el.className = 'lens-card';
    el.id = 'card-' + eye;
    el.innerHTML = `
      <div class="lc-head"><h2><span class="eye-badge">${eye === 'OD' ? t('odShort') : t('ogShort')}</span> <span class="lc-title"></span></h2></div>
      <div class="lc-body">
        <canvas class="lc-preview" width="896" height="640"></canvas>
        <div class="measures">
          <div class="m big"><div class="k">${t('widthA')}</div><div class="v vA">–</div></div>
          <div class="m big"><div class="k">${t('heightB')}</div><div class="v vB">–</div></div>
          <div class="m"><div class="k">${t('perimeter')}</div><div class="v vP">–</div></div>
          <div class="m"><div class="k">${t('ed')}</div><div class="v vE">–</div></div>
        </div>
      </div>
      <div class="lc-msgs"></div>
      <div class="lc-actions">
        <button class="btn primary act-cam"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${t('camera')}</span></button>
        <button class="btn act-imp"><svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4l4 4M4 15v5h16v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>${t('import')}</span></button>
      </div>
      <div class="shots"></div>
      <div class="lc-opts">
        <label class="toggle"><input type="checkbox" class="opt-mirror"> ${t('mirror')}</label>
        <label class="toggle"><input type="checkbox" class="opt-rot"> ${t('rotate180')}</label>
        <button class="link-btn act-svg">${t('svgLens')}</button>
      </div>`;
    host.appendChild(el);
    $('.act-cam', el).onclick = () => openCamera(eye);
    $('.act-imp', el).onclick = () => pickFile(eye);
    $('.act-svg', el).onclick = () => downloadLensSVG(eye);
    $('.opt-mirror', el).onchange = (e) => { S.lenses[eye].mirror = e.target.checked; S.frameDirty = true; renderLens(eye); };
    $('.opt-rot', el).onchange = (e) => { S.lenses[eye].rot = e.target.checked; S.frameDirty = true; renderLens(eye); };
    renderLens(eye);
  }
}

function nasalSign(eye) {
  const L = S.lenses[eye];
  let s = eye === 'OD' ? 1 : -1; // verre vu de face : nasal à droite pour l'OD, à gauche pour l'OG
  if (L.mirror) s = -s;
  if (L.rot) s = -s;
  return s;
}

function renderLens(eye) {
  const el = $('#card-' + eye);
  if (!el) return;
  const L = S.lenses[eye];
  $('.lc-title', el).textContent = t(eye);
  const shot = L.shots[L.active];
  const cv = $('.lc-preview', el);
  const msgs = $('.lc-msgs', el);
  msgs.innerHTML = '';
  if (shot) drawControl(cv, shot.result, { nasal: nasalSign(eye), contour: lensContour(eye) });
  else if (L.error && L.errorShot && L.errorShot.result.rect) drawControl(cv, L.errorShot.result, {});
  else cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  const m = lensMeasures(eye);
  $('.vA', el).innerHTML = m ? `${fmt(m.A)}<small> mm</small>` : '–';
  $('.vB', el).innerHTML = m ? `${fmt(m.B)}<small> mm</small>` : '–';
  $('.vP', el).innerHTML = m ? `${fmt(m.perimeter, 0)}<small> mm</small>` : '–';
  $('.vE', el).innerHTML = m ? `${fmt(m.ED)}<small> mm</small>` : '–';
  if (L.error) msgs.insertAdjacentHTML('beforeend', `<div class="msg err">${t('err-' + L.error)}</div>`);
  if (shot && !L.error) for (const w of shot.result.warnings || []) msgs.insertAdjacentHTML('beforeend', `<div class="msg warn">${t('warn-' + w)}</div>`);
  if (!shot && !L.error) msgs.insertAdjacentHTML('beforeend', `<div class="msg">${t('notMeasured')}</div>`);
  $('.act-cam span', el).textContent = L.shots.length ? t('addShot') : t('camera');
  // tableau des prises (cohérence entre les prises)
  const sh = $('.shots', el);
  if (L.shots.length) {
    const rows = L.shots.map((s, i) => `<tr class="${i === L.active && !L.avg ? 'active' : ''}"><td>${t('shot')} ${i + 1}</td><td>${fmt(s.result.measures.A, 2)}</td><td>${fmt(s.result.measures.B, 2)}</td><td><button class="link-btn" data-use="${i}">${t('useShot')}</button> <button class="link-btn" data-del="${i}">✕</button></td></tr>`).join('');
    let spread = '';
    if (L.shots.length > 1) {
      const As = L.shots.map((s) => s.result.measures.A), Bs = L.shots.map((s) => s.result.measures.B);
      const dA = Math.max(...As) - Math.min(...As), dB = Math.max(...Bs) - Math.min(...Bs);
      spread = `<div class="spread">${t('consistency')} : ΔA ${fmt(dA, 2)} mm · ΔB ${fmt(dB, 2)} mm
        <label class="toggle" style="margin-left:6px"><input type="checkbox" class="opt-avg" ${L.avg ? 'checked' : ''}> ${t('average')}</label></div>`;
    }
    sh.innerHTML = `<table><thead><tr><th>${t('shots')}</th><th>A (mm)</th><th>B (mm)</th><th></th></tr></thead><tbody>${rows}</tbody></table>${spread}`;
    $$('[data-use]', sh).forEach((b) => b.onclick = () => { L.active = +b.dataset.use; L.avg = false; S.frameDirty = true; renderLens(eye); });
    $$('[data-del]', sh).forEach((b) => b.onclick = () => { L.shots.splice(+b.dataset.del, 1); L.active = L.shots.length - 1; S.frameDirty = true; renderLens(eye); });
    const avg = $('.opt-avg', sh);
    if (avg) avg.onchange = (e) => { L.avg = e.target.checked; S.frameDirty = true; renderLens(eye); };
  } else sh.innerHTML = '';
  $('.opt-mirror', el).checked = L.mirror;
  $('.opt-rot', el).checked = L.rot;
  $('.act-svg', el).disabled = !shot;
  updateFrameTab();
}

// Image de contrôle : vue redressée + contour + rectangle boxing + cotes.
function drawControl(cv, r, { nasal = 0, contour = null } = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (!r.rect) return;
  const off = document.createElement('canvas');
  off.width = r.rect.width; off.height = r.rect.height;
  off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.rect.data), r.rect.width, r.rect.height), 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, W, H);
  const sx = W / r.rect.width;
  const X = (x) => ((x - MODEL_FRAME.x0) / MODEL_FRAME.res) * sx, Y = (y) => ((y - MODEL_FRAME.y0) / MODEL_FRAME.res) * sx;
  const P = contour || r.contour;
  if (!P) return;
  const b = bbox(P);
  ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,190,0,.95)';
  ctx.strokeRect(X(b.x0), Y(b.y0), X(b.x1) - X(b.x0), Y(b.y1) - Y(b.y0));
  ctx.setLineDash([]);
  ctx.lineWidth = 3; ctx.strokeStyle = '#ff2d55';
  ctx.beginPath();
  P.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.closePath(); ctx.stroke();
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(10,25,40,.8)';
  const lab = (txt, x, y) => { const w = ctx.measureText(txt).width + 14; ctx.fillStyle = 'rgba(10,25,40,.78)'; ctx.fillRect(x - w / 2, y - 18, w, 30); ctx.fillStyle = '#fff'; ctx.fillText(txt, x - w / 2 + 7, y + 6); };
  lab(`A ${fmt(b.w)} mm`, (X(b.x0) + X(b.x1)) / 2, Math.max(22, Y(b.y0) - 18));
  lab(`B ${fmt(b.h)} mm`, Math.min(W - 80, X(b.x1) + 80), (Y(b.y0) + Y(b.y1)) / 2);
  if (nasal) {
    const xn = nasal > 0 ? X(b.x1) - 60 : X(b.x0) + 60, yn = Y(b.y1) - 30;
    ctx.fillStyle = 'rgba(18,146,125,.9)';
    ctx.font = '700 22px system-ui, sans-serif';
    const txt = nasal > 0 ? `${t('nasal')} →` : `← ${t('nasal')}`;
    const w = ctx.measureText(txt).width + 14;
    ctx.fillRect(xn - w / 2, yn - 17, w, 28);
    ctx.fillStyle = '#fff'; ctx.fillText(txt, xn - w / 2 + 7, yn + 5);
  }
}

// ------------------------------------------------------------------ Pas à pas
function heat(v) { // palette « viridis » simplifiée
  const stops = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const x = Math.min(0.999, Math.max(0, v)) * (stops.length - 1), i = Math.floor(x), f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
}
function renderSteps() {
  const host = $('#stepsBody');
  const s = S.last;
  if (!s) return;
  const r = s.result;
  host.innerHTML = '';
  const add = (title, canvas, extra = '') => {
    const d = document.createElement('div');
    d.className = 'step';
    d.innerHTML = `<h4>${title}</h4>`;
    if (canvas) d.appendChild(canvas);
    if (extra) d.insertAdjacentHTML('beforeend', extra);
    host.appendChild(d);
  };
  // 1. photo + repères
  const c1 = document.createElement('canvas');
  c1.width = s.thumb.width; c1.height = s.thumb.height;
  const g1 = c1.getContext('2d');
  g1.drawImage(s.thumb, 0, 0);
  if (r.sheet) {
    g1.lineWidth = 3; g1.strokeStyle = '#3ddc97'; g1.fillStyle = '#3ddc97';
    g1.beginPath();
    r.sheet.markers.forEach((m, i) => { const x = m.x * s.thumbScale, y = m.y * s.thumbScale; i ? g1.lineTo(x, y) : g1.moveTo(x, y); });
    g1.closePath(); g1.stroke();
    g1.font = '700 18px system-ui';
    r.sheet.markers.forEach((m, i) => { const x = m.x * s.thumbScale, y = m.y * s.thumbScale; g1.beginPath(); g1.arc(x, y, 7, 0, 7); g1.fill(); g1.fillText(String(i + 1), x + 9, y - 9); });
  }
  const info1 = r.sheet ? `<div class="kv small"><b>${t('camTilt')}</b><span>${fmt(r.pose?.tilt, 1)}°</span><b>${t('camHeight')}</b><span>${fmt(r.pose?.height, 0)} mm</span><b>${t('sharpness')}</b><span>${fmt(r.blurMm, 2)} mm</span></div>` : `<div class="msg err">${t('err-' + r.error)}</div>`;
  add(t('s1'), c1, info1);
  if (!r.rect) return;
  // 2. redressée
  const c2 = document.createElement('canvas');
  c2.width = r.rect.width; c2.height = r.rect.height;
  c2.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.rect.data), r.rect.width, r.rect.height), 0, 0);
  add(t('s2'), c2, `<p class="small muted">${fmt(r.rect.srcPxPerMm, 1)} px/mm (source)</p>`);
  // 3. probabilité
  if (r.prob) {
    const c3 = document.createElement('canvas');
    c3.width = r.rect.width; c3.height = r.rect.height;
    const g3 = c3.getContext('2d'), im = g3.createImageData(c3.width, c3.height);
    for (let i = 0; i < r.prob.length; i++) { const [a, b, c] = heat(r.prob[i] / 255); im.data[4 * i] = a; im.data[4 * i + 1] = b; im.data[4 * i + 2] = c; im.data[4 * i + 3] = 255; }
    g3.putImageData(im, 0, 0);
    add(t('s3'), c3, `<p class="small muted">${t('method')} : ${r.method === 'ai' ? t('methodAi') : t('methodClassic')}</p>`);
  }
  // 4. contour + mesures
  if (r.ok) {
    const c4 = document.createElement('canvas');
    c4.width = 896; c4.height = 640;
    drawControl(c4, r, { nasal: nasalSign(s.eye) });
    const m = r.measures, T = r.timings || {};
    add(t('s4'), c4, `<div class="kv small">
      <b>A</b><span>${fmt(m.A, 2)} mm</span><b>B</b><span>${fmt(m.B, 2)} mm</span>
      <b>${t('perimeter')}</b><span>${fmt(m.perimeter, 1)} mm</span><b>${t('ed')}</b><span>${fmt(m.ED, 2)} mm</span>
      <b>${t('parallax')}</b><span>${fmt(r.parallaxMax, 2)} mm</span>
      <b>${t('timings')}</b><span>${Object.entries(T).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(' · ')}</span></div>`);
  }
}

// ------------------------------------------------------------------ Monture
function frameInputs() {
  let od = lensContour('OD'), og = lensContour('OG');
  if (!od && !og) return null;
  const mirrorX = (P) => { const b = bbox(P); return P.map(([x, y]) => [2 * b.cx - x, y]); };
  if (!od) od = mirrorX(og);
  if (!og) og = mirrorX(od);
  return { od, og };
}
function updateFrameTab() {
  const has = EYES.filter((e) => S.lenses[e].shots.length).length;
  $('#frameMsg').textContent = has === 0 ? t('needTwo') : has === 1 ? t('needOne') : '';
  $('#frameMsg').classList.toggle('hidden', has === 2);
  if ($('#tab-frame').classList.contains('active')) scheduleFrame();
}
let frameTimer = null;
function scheduleFrame() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(generateFrame, 250);
}
let viewer = null;
async function generateFrame() {
  const inp = frameInputs();
  if (!inp) return;
  if (S.frameBusy) { S.frameDirty = true; return; }
  if (!S.frameDirty && S.frame) return;
  S.frameBusy = true; S.frameDirty = false;
  const params = { ...S.params, odMirror: S.lenses.OD.mirror, odRot: S.lenses.OD.rot, ogMirror: S.lenses.OG.mirror, ogRot: S.lenses.OG.rot };
  try {
    $('#viewer3d').style.opacity = 0.6;
    const res = await call('frame', { od: inp.od, og: inp.og, params });
    S.frame = res;
    if (!viewer) {
      const { FrameViewer } = await import('./viewer.js');
      $('#viewer3d').innerHTML = '';
      viewer = new FrameViewer($('#viewer3d'));
    }
    viewer.setFrame(res);
    renderFrameInfo(res);
    ['#dlStl', '#dlSvg', '#dlJson'].forEach((s) => ($(s).disabled = false));
  } catch (e) {
    console.error(e);
    toast(t('err-generic'));
  } finally {
    $('#viewer3d').style.opacity = 1;
    S.frameBusy = false;
    if (S.frameDirty) scheduleFrame();
  }
}
function renderFrameInfo(res) {
  const st = res.stats;
  const ok = st.status === 'NoError';
  $('#frameStats').classList.remove('hidden');
  $('#frameStats').innerHTML = `
    <span>${t('frameOk')}</span><span class="${ok ? 'ok' : ''}">${ok ? '✓' : '✗ ' + st.status}</span>
    <span>${t('triangles')}</span><span>${st.tris.toLocaleString()}</span>
    <span>${t('volume')}</span><span>${fmt(st.volume / 1000, 2)} cm³ (≈ ${fmt(st.volume / 1000 * 1.24, 1)} g PLA)</span>
    <span>${t('thickness')}</span><span>${fmt(st.thickness, 2)} mm</span>
    <span>${t('frameWidth')}</span><span>${fmt(st.width, 1)} mm</span>
    <span style="grid-column:1/-1" class="small muted">${t('printTime')}</span>`;
  // superposition verre / rainure (vue de face)
  $('#fitCard').classList.remove('hidden');
  const all = [...res.outline.flat()];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3, y0 = Math.min(...ys) - 3, y1 = Math.max(...ys) + 3;
  const path = (P) => 'M' + P.map(([x, y]) => `${(x - x0).toFixed(2)},${(y1 - y).toFixed(2)}`).join('L') + 'Z';
  const outline = res.outline.map((P) => `<path d="${path(P)}" fill="#1f6f8b" fill-opacity=".18" stroke="#1f6f8b" stroke-width=".35"/>`).join('');
  const holes = res.check.filter(Boolean).map((c) => `<path d="${path(c.hole)}" fill="none" stroke="#12927d" stroke-width=".35"/>`).join('');
  const lenses = [res.lenses.PL, res.lenses.PR].map((P) => `<path d="${path(P)}" fill="#bfe6ff" fill-opacity=".45" stroke="#ff2d55" stroke-width=".3"/>`).join('');
  $('#fitSvg').innerHTML = `<svg viewBox="0 0 ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}">${outline}${lenses}${holes}</svg>`;
  $('#fitNums').innerHTML = res.check.map((c, i) => c ? `<div><b>${i === 0 ? t('odShort') : t('ogShort')}</b> : ${fmt(c.mean, 2)} mm ${t('mean')} · ${fmt(c.max, 2)} mm ${t('max')}</div>` : '').join('');
}

function bindFrameControls() {
  const bind = (id, key, outId, d = 1) => {
    const inp = $('#' + id), out = $('#' + outId);
    const upd = () => { S.params[key] = +inp.value; out.textContent = `${fmt(+inp.value, d)} mm`; };
    inp.value = S.params[key];
    upd();
    inp.oninput = () => { upd(); S.frameDirty = true; scheduleFrame(); };
  };
  bind('dbl', 'dbl', 'dblOut');
  bind('rim', 'rim', 'rimOut');
  bind('edge', 'edge', 'edgeOut');
  bind('clr', 'clearance', 'clrOut', 2);
  bind('lipB', 'lipBack', 'lipBOut', 2);
  bind('lipF', 'lipFront', 'lipFOut');
  $('#tenons').onchange = (e) => { S.params.tenons = e.target.checked; S.frameDirty = true; scheduleFrame(); };
  $('#dlStl').onclick = () => S.frame && download(new Blob([S.frame.stl], { type: 'model/stl' }), 'monture.stl');
  $('#dlSvg').onclick = () => downloadAllSVG();
  $('#dlJson').onclick = () => downloadJSON();
}

// ------------------------------------------------------------------ Exports
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function svgItems(eyes) {
  return eyes.filter((e) => S.lenses[e].shots.length).map((e) => {
    const P = lensContour(e), b = bbox(P);
    return { label: e === 'OD' ? 'OD (verre droit)' : 'OG (verre gauche)', contour: P, A: b.w, B: b.h, nasal: nasalSign(e) };
  });
}
function downloadLensSVG(eye) {
  const items = svgItems([eye]);
  if (!items.length) return;
  download(new Blob([contoursSVG(items, `OptiFrame - contour ${eye} - echelle 1:1`)], { type: 'image/svg+xml' }), `contour_${eye}.svg`);
}
function downloadAllSVG() {
  const items = svgItems(EYES);
  if (!items.length) return;
  download(new Blob([contoursSVG(items, 'OptiFrame - contours OD / OG - echelle 1:1')], { type: 'image/svg+xml' }), 'contours_OD_OG.svg');
}
function downloadJSON() {
  const data = { app: 'OptiFrame', version: VERSION, date: new Date().toISOString(), units: 'mm', convention: 'verre face avant vers le haut, vu de face ; X vers le repère 2, Y vers le repère 4', lenses: {}, frame: null };
  for (const e of EYES) {
    const L = S.lenses[e];
    if (!L.shots.length) continue;
    const m = lensMeasures(e);
    data.lenses[e] = {
      A: +m.A.toFixed(3), B: +m.B.toFixed(3), perimeter: +m.perimeter.toFixed(2), ED: +m.ED.toFixed(3), averaged: L.avg && L.shots.length > 1,
      shots: L.shots.map((s) => ({ A: +s.result.measures.A.toFixed(3), B: +s.result.measures.B.toFixed(3), method: s.result.method, tilt: s.result.pose && +s.result.pose.tilt.toFixed(1), parallaxMax: +(s.result.parallaxMax || 0).toFixed(3) })),
      contour: lensContour(e).filter((_, i) => i % 2 === 0).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]),
    };
  }
  if (S.frame) data.frame = { params: S.frame.params, stats: S.frame.stats, fit: S.frame.check.map((c) => c && { mean: +c.mean.toFixed(3), max: +c.max.toFixed(3) }) };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'optiframe_mesures.json');
}

// ------------------------------------------------------------------ Caméra / fichiers
let camUI = null, camEye = 'OD';
async function openCamera(eye) {
  camEye = eye;
  try {
    if (!camUI) { const { CameraUI } = await import('./camera.js'); camUI = new CameraUI($('#camera')); }
    $('#camera .cam-eye').textContent = t(eye);
    await camUI.open();
  } catch (e) {
    console.warn(e);
    toast(t('err-camera'));
    pickFile(eye);
  }
}
function bindCamera() {
  const root = $('#camera');
  $('.cam-cancel', root).onclick = () => camUI && camUI.close();
  $('.cam-import', root).onclick = () => { camUI && camUI.close(); pickFile(camEye); };
  $('.cam-shutter', root).onclick = async () => {
    if (!camUI) return;
    const shot = await camUI.capture();
    camUI.close();
    let src;
    if (shot.blob) src = await fileToSource(shot.blob);
    else src = { canvas: toCanvas(shot.canvas, MAX_SIDE), focal35: null };
    src.label = 'camera';
    await analyze(camEye, src);
  };
}
let fileEye = 'OD';
function pickFile(eye) { fileEye = eye; $('#fileInput').value = ''; $('#fileInput').click(); }
function bindFile() {
  $('#fileInput').onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    let src;
    try { src = await fileToSource(f); } catch (err) { S.lenses[fileEye].error = 'decode'; renderLens(fileEye); return; }
    src.label = f.name;
    await analyze(fileEye, src);
  };
}
async function runDemo() {
  for (const [eye, file] of [['OD', 'assets/demo/verre_clair_OD.jpg'], ['OG', 'assets/demo/verre_teinte_OG.jpg']]) {
    const blob = await (await fetch(file)).blob();
    const src = await fileToSource(blob);
    src.label = file;
    await analyze(eye, src);
  }
  toast('✓ ' + t('demo'));
}

// ------------------------------------------------------------------ Divers
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}
function switchTab(name) {
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  $$('nav.bottom button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  window.scrollTo({ top: 0 });
  if (name === 'frame') { scheduleFrame(); if (viewer) setTimeout(() => viewer.resize(), 50); }
}
async function showShare() {
  const { default: qrcode } = await import('../lib/qrcode/qrcode.mjs');
  const url = location.origin + location.pathname.replace(/index\.html$/, '');
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  $('#shareUrl').textContent = url;
  $('#shareModal').classList.add('open');
}
function loadSettings() {
  try { Object.assign(S.settings, JSON.parse(localStorage.getItem('optiframe-settings') || '{}')); } catch (e) { /* ignore */ }
  const gr = $('#gridRef');
  gr.checked = !!S.settings.gridRef;
  gr.onchange = () => { S.settings.gridRef = gr.checked; try { localStorage.setItem('optiframe-settings', JSON.stringify(S.settings)); } catch (e) { /* ignore */ } };
  for (const k of ['sheetX', 'sheetY', 'edgeH']) {
    const inp = $('#' + k);
    inp.value = S.settings[k];
    inp.onchange = () => {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (isFinite(v)) S.settings[k] = v;
      try { localStorage.setItem('optiframe-settings', JSON.stringify(S.settings)); } catch (e) { /* ignore */ }
    };
  }
}
function refreshTexts() {
  applyI18n();
  $('#langBtn').textContent = getLang() === 'fr' ? 'EN' : 'FR';
  buildCards();
  renderSteps();
  if (S.frame) renderFrameInfo(S.frame);
  onModel({ ok: S.modelOk });
  $('#versionInfo').textContent = `v${VERSION}`;
}

function init() {
  document.documentElement.lang = getLang();
  refreshTexts();
  $('#langBtn').onclick = () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); refreshTexts(); };
  $$('nav.bottom button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
  $('#demoBtn').onclick = runDemo;
  $('#shareBtn').onclick = showShare;
  $$('[data-close]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.remove('open')));
  $('#shareModal').onclick = (e) => { if (e.target.id === 'shareModal') e.target.classList.remove('open'); };
  bindFrameControls();
  bindCamera();
  bindFile();
  loadSettings();
  startWorker();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (location.hash === '#demo') runDemo();
}
init();
