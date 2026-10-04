// Aperçu 3D de la monture (three.js). La monture est affichée vue de face (côté observateur).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class FrameViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.6); d1.position.set(-80, 120, -200); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.8); d2.position.set(150, -60, 200); this.scene.add(d2);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    const loop = () => { if (this.controls.update()) this.render(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 220;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  // res : { positions, indices, lenses: {PL, PR}, profile }. Repère d'impression : x -> -x par
  // rapport à la vue de face ; on regarde depuis z < 0 (face avant), y vers le haut.
  setFrame(res, colorHex = 0x1f6f8b) {
    this.group.clear();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    g.setIndex(new THREE.BufferAttribute(res.indices, 1));
    g.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55, metalness: 0.05, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    this.group.add(mesh);
    // verres (aperçu translucide, au milieu de la rainure)
    const z = res.profile ? res.profile.zMid : 2.5;
    for (const P of [res.lenses.PL, res.lenses.PR]) {
      const shape = new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(-x, y)));
      const lg = new THREE.ShapeGeometry(shape, 1);
      const lm = new THREE.Mesh(lg, new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide }));
      lm.position.z = z;
      this.group.add(lm);
    }
    const bb = g.boundingBox;
    const c = new THREE.Vector3(); bb.getCenter(c);
    const size = new THREE.Vector3(); bb.getSize(size);
    this.controls.target.copy(c);
    const dist = (Math.max(size.x / this.camera.aspect, size.y) / 2) / Math.tan((this.camera.fov * Math.PI) / 360) * 1.25 + size.z;
    this.camera.position.set(c.x - dist * 0.12, c.y + dist * 0.18, c.z - dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c);
    this.controls.update();
    this.render();
  }

  render() { this.renderer.render(this.scene, this.camera); }
  snapshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
}
