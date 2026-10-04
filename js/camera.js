// Caméra intégrée (getUserMedia) avec guidage en direct : détection des 4 repères sur un aperçu réduit.
import { toGray } from './vision/image.js';
import { detectSheet } from './vision/markers.js';
import { cameraPose, applyH } from './vision/homography.js';
import { t } from './i18n.js';

export class CameraUI {
  constructor(root) {
    this.root = root;
    this.video = root.querySelector('video');
    this.overlay = root.querySelector('canvas.cam-overlay');
    this.status = root.querySelector('.cam-status');
    this.shutter = root.querySelector('.cam-shutter');
    this.stream = null;
    this.timer = null;
    this.small = document.createElement('canvas');
  }

  async open() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('camera');
    const constraints = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    // mise au point continue si disponible
    try {
      const track = this.stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (e) { /* facultatif */ }
    this.root.classList.add('open');
    this.loop();
  }

  loop() {
    clearTimeout(this.timer);
    const v = this.video;
    if (!this.stream) return;
    if (v.videoWidth) {
      const sc = 640 / Math.max(v.videoWidth, v.videoHeight);
      const w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
      this.small.width = w; this.small.height = h;
      const ctx = this.small.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, w, h);
      let r = null;
      try { r = detectSheet(toGray(ctx.getImageData(0, 0, w, h)), { workSize: 640 }); } catch (e) { r = null; }
      this.drawOverlay(r, w, h);
    }
    this.timer = setTimeout(() => this.loop(), 350);
  }

  drawOverlay(r, w, h) {
    const o = this.overlay, rect = this.video.getBoundingClientRect();
    o.width = rect.width * (window.devicePixelRatio || 1);
    o.height = rect.height * (window.devicePixelRatio || 1);
    const ctx = o.getContext('2d');
    ctx.clearRect(0, 0, o.width, o.height);
    // object-fit: cover -> correspondance pixels
    const s = Math.max(o.width / w, o.height / h);
    const ox = (o.width - w * s) / 2, oy = (o.height - h * s) / 2;
    if (r && r.ok) {
      const pose = cameraPose(r.Hs2i, 0.72 * Math.max(w, h), w / 2, h / 2);
      // centrage : le nadir de la caméra doit être proche du centre de la grille (parallaxe minimale)
      const off = Math.hypot(pose.X - 50, pose.Y - 35);
      let arrow = '';
      if (off > 25) {
        const [u1, v1] = applyH(r.Hs2i, 50, 35), [u0, v0] = applyH(r.Hs2i, pose.X, pose.Y);
        const ang = Math.atan2(v1 - v0, u1 - u0);
        arrow = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
      }
      const flat = pose.tilt < 20 && !arrow;
      ctx.lineWidth = 3 * (window.devicePixelRatio || 1);
      ctx.strokeStyle = flat ? '#3ddc97' : '#ffb020';
      ctx.beginPath();
      r.markers.forEach((m, i) => { const x = ox + m.x * s, y = oy + m.y * s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      r.markers.forEach((m, i) => {
        ctx.beginPath(); ctx.arc(ox + m.x * s, oy + m.y * s, 9 * (window.devicePixelRatio || 1), 0, 7); ctx.fill();
        ctx.fillStyle = '#0b2233'; ctx.font = `${12 * (window.devicePixelRatio || 1)}px sans-serif`;
        ctx.fillText(String(i + 1), ox + m.x * s - 4, oy + m.y * s + 4); ctx.fillStyle = ctx.strokeStyle;
      });
      this.status.textContent = flat ? t('camOk') : pose.tilt >= 20 ? t('camFlat') : t('camMove', { arrow });
      this.status.className = 'cam-status ' + (flat ? 'ok' : 'warn');
    } else {
      this.status.textContent = t('camSearching');
      this.status.className = 'cam-status';
    }
  }

  // Image pleine résolution : ImageCapture.takePhoto (Chrome Android) sinon image vidéo.
  async capture() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (track && 'ImageCapture' in window) {
      try {
        const ic = new window.ImageCapture(track);
        const blob = await ic.takePhoto();
        if (blob && blob.size > 50000) return { blob };
      } catch (e) { /* repli sur l'image vidéo */ }
    }
    const v = this.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return { canvas: c };
  }

  close() {
    clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.root.classList.remove('open');
  }
}
