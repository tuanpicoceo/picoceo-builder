// three.js viewport: assembly (posable), exploded view, section plane, print plates, simulation.
// Content is modelled Z-up in mm; the root group turns it into three's Y-up world.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Assembly, MeshData } from '../cad/types';
import { layoutPlates } from '../export/files';

export type ViewMode = 'assembly' | 'print';

function geometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root = new THREE.Group();          // Z-up content
  private links = new Map<string, THREE.Group>();
  private partMeshes = new Map<string, THREE.Mesh>();
  private explodeDir = new Map<THREE.Object3D, THREE.Vector3>();
  private printGroup = new THREE.Group();
  private obstacleGroup = new THREE.Group();
  private ramp: THREE.Mesh | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private grid: THREE.GridHelper;
  private raf = 0;
  private ro: ResizeObserver;
  private assembly: Assembly | null = null;
  private ledMaterials: THREE.MeshStandardMaterial[] = [];
  onPick?: (partId: string | null) => void;
  follow = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    this.camera.position.set(220, 180, 260);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.background = new THREE.Color('#0f1218');

    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.root.add(this.printGroup, this.obstacleGroup);

    const hemi = new THREE.HemisphereLight('#dfe8ff', '#20242c', 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(300, 500, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -400, right: 400, top: 400, bottom: -400, near: 10, far: 2000 });
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#9fb4ff', 0.6);
    fill.position.set(-300, 200, -200);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(2000, 200, '#3a4150', '#232833');
    this.grid.rotation.x = Math.PI / 2;
    this.grid.visible = false;
    this.root.add(this.grid);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.35 }));
    ground.receiveShadow = true;
    ground.position.z = -0.05;
    this.root.add(ground);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  private down = { x: 0, y: 0 };
  private pointerDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private pointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4 || !this.onPick) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects([...this.partMeshes.values()].filter(m => m.visible), false)[0];
    this.onPick(hit ? (hit.object.userData.partId as string) : null);
  };

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearAssembly() {
    this.assembly = null;
    for (const g of this.links.values()) { this.root.remove(g); disposeTree(g); }
    this.links.clear();
    this.partMeshes.clear();
    this.explodeDir.clear();
    this.ledMaterials = [];
    disposeTree(this.printGroup);
    this.printGroup.clear();
    this.clearObstacles();
    this.grid.visible = false;
  }

  setAssembly(a: Assembly, keepCamera = false) {
    this.assembly = a;
    this.grid.visible = true;
    for (const g of this.links.values()) { this.root.remove(g); disposeTree(g); }
    this.links.clear(); this.partMeshes.clear(); this.explodeDir.clear(); this.ledMaterials = [];
    const center = new THREE.Vector3();
    const all = new THREE.Box3();
    for (const p of a.parts) all.union(new THREE.Box3(new THREE.Vector3(...p.bbox.min), new THREE.Vector3(...p.bbox.max)));
    all.getCenter(center);

    for (const l of a.links) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.userData.linkId = l.id;
      this.links.set(l.id, g);
      this.root.add(g);
    }
    for (const p of a.parts) {
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: p.material === 'TPU 95A' ? 0.95 : 0.55, metalness: 0.05, clippingPlanes: [this.clip], clipShadows: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry(p.mesh), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.partId = p.id;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 35), new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, clippingPlanes: [this.clip] }));
      mesh.add(edges);
      this.links.get(p.link)!.add(mesh);
      this.partMeshes.set(p.id, mesh);
      const c = new THREE.Vector3((p.bbox.min[0] + p.bbox.max[0]) / 2, (p.bbox.min[1] + p.bbox.max[1]) / 2, (p.bbox.min[2] + p.bbox.max[2]) / 2);
      this.explodeDir.set(mesh, c.sub(center));
    }
    for (const c of a.components) {
      const led = c.catalogId === 'B-KB003';
      const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.4, metalness: c.catalogId === 'horn' ? 0 : 0.2, clippingPlanes: [this.clip], emissive: new THREE.Color("#000000") });
      if (led) this.ledMaterials.push(mat);
      const mesh = new THREE.Mesh(geometry(c.mesh), mat);
      mesh.castShadow = true;
      mesh.userData.component = c.key;
      this.links.get(c.link)?.add(mesh);
      this.explodeDir.set(mesh, new THREE.Vector3(...c.center).sub(center));
    }
    this.buildPrintPlates(a);
    this.setPose(new Map());
    if (!keepCamera) this.frame(all);
  }

  private buildPrintPlates(a: Assembly) {
    disposeTree(this.printGroup);
    this.printGroup.clear();
    const placed = layoutPlates(a.parts);
    const plates = Math.max(...placed.map(p => p.plate)) + 1;
    for (let i = 0; i < plates; i++) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(256, 256, 2), new THREE.MeshStandardMaterial({ color: '#2b3140', roughness: 0.9 }));
      plate.position.set(i * 300 + 128, 128, -1);
      plate.receiveShadow = true;
      this.printGroup.add(plate);
    }
    for (const pl of placed) {
      const mesh = new THREE.Mesh(geometry(pl.p.printMesh), new THREE.MeshStandardMaterial({ color: pl.p.color, roughness: 0.6 }));
      mesh.position.set(pl.x + pl.plate * 300, pl.y, 0);
      mesh.castShadow = true;
      mesh.userData.partId = pl.p.id;
      this.printGroup.add(mesh);
    }
    this.printGroup.visible = false;
  }

  setMode(mode: ViewMode) {
    const print = mode === 'print';
    this.printGroup.visible = print;
    for (const g of this.links.values()) g.visible = !print;
    if (print) {
      const b = new THREE.Box3().setFromObject(this.printGroup);
      this.frame(b, true);
    } else if (this.assembly) {
      const all = new THREE.Box3();
      for (const p of this.assembly.parts) all.union(new THREE.Box3(new THREE.Vector3(...p.bbox.min), new THREE.Vector3(...p.bbox.max)));
      this.frame(all);
    }
  }

  /** Fit the camera to a Z-up box (or an already-world box when `world`). */
  frame(box: THREE.Box3, world = false) {
    const b = world ? box : box.clone().applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(0.75, 0.6, 0.95).normalize();
    this.camera.position.copy(c).addScaledVector(dir, Math.max(180, s * 1.7));
    this.camera.near = Math.max(0.5, s / 200);
    this.camera.updateProjectionMatrix();
  }

  setPose(poses: Map<string, THREE.Matrix4>) {
    for (const [id, g] of this.links) {
      g.matrix.copy(poses.get(id) ?? new THREE.Matrix4());
      g.matrixWorldNeedsUpdate = true;
    }
    if (this.follow && this.assembly) {
      const root = this.assembly.links.find(l => !l.parent)!;
      const m = poses.get(root.id);
      if (m) {
        const p = new THREE.Vector3(...root.com).applyMatrix4(m).applyMatrix4(this.root.matrixWorld);
        const d = p.clone().sub(this.controls.target);
        this.controls.target.add(d); this.camera.position.add(d);
      }
    }
  }

  setExplode(f: number) {
    for (const [obj, d] of this.explodeDir) obj.position.copy(d).multiplyScalar(f * 0.9);
  }

  setSection(on: boolean, x = 0) {
    this.clip.constant = on ? x : 1e6;
    this.clip.normal.set(-1, 0, 0);
  }

  setLedColor(rgb: [number, number, number]) {
    const c = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    for (const m of this.ledMaterials) { m.emissive.copy(c); m.emissiveIntensity = 1.6; }
  }

  highlight(partId: string | null) {
    for (const [id, m] of this.partMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const dim = partId && id !== partId;
      mat.transparent = !!dim; mat.opacity = dim ? 0.18 : 1; mat.depthWrite = !dim;
      mat.emissive.set(partId === id ? '#1c3a6b' : '#000000');
    }
  }

  setObstacles(list: { pos: [number, number, number]; quat: [number, number, number, number]; size: [number, number, number] }[], ramp: boolean) {
    while (this.obstacleGroup.children.length < list.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#c9783a', roughness: 0.8 }));
      m.castShadow = m.receiveShadow = true;
      this.obstacleGroup.add(m);
    }
    this.obstacleGroup.children.forEach((m, i) => {
      const o = list[i];
      m.visible = !!o;
      if (!o) return;
      m.position.set(...o.pos); m.quaternion.set(...o.quat); m.scale.set(...o.size);
    });
    if (ramp && !this.ramp) {
      this.ramp = new THREE.Mesh(new THREE.BoxGeometry(300, 500, 20), new THREE.MeshStandardMaterial({ color: '#5a6b8c', roughness: 0.9 }));
      this.ramp.receiveShadow = true;
      this.ramp.position.set(0, 550, 40); this.ramp.rotation.x = (12 * Math.PI) / 180;
      this.root.add(this.ramp);
    }
    if (this.ramp) this.ramp.visible = ramp;
  }

  clearObstacles() { this.setObstacles([], false); }

  screenshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse(x => {
    const m = x as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(z => z.dispose()); else mat?.dispose();
  });
}
