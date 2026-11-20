// Personajes caricaturescos: datos + render instanciado (8 draw calls para toda la multitud).
import * as THREE from 'three';
import { gradientMap } from '../world/materials.js';
import { coloredMerge } from '../world/cityBuilder.js';
import { lerp, lerpAngle, clamp } from '../util.js';

export const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd4a373];
export const SHIRTS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xff7043, 0x26c6da, 0xf5f5f5, 0xec407a, 0x6d4c41];
export const PANTS = [0x283593, 0x37474f, 0x5d4037, 0x1b1b1b, 0x546e7a, 0x795548];
export const HAIRS = [0x1b1b1b, 0x3e2723, 0x5d4037, 0x8d6e63, 0xbdbdbd];

export class Character {
  constructor(look, x = 0, z = 0, yaw = 0) {
    this.look = look;
    this.x = this.px = x; this.z = this.pz = z; this.y = this.py = 0; this.vy = 0;
    this.yaw = this.pyaw = yaw;
    this.vx = 0; this.vz = 0;
    this.speed = 0; this.phase = Math.random() * 6;
    this.hp = 100; this.alive = true;
    this.tilt = 0; this.downT = 0; // caída
    this.pose = 'walk'; this.punchT = 0;
    this.visible = true; this.onFoot = true;
    this.vehicle = null;
  }
  savePrev() { this.px = this.x; this.pz = this.z; this.py = this.y; this.pyaw = this.yaw; }
  knock(vx, vz, dmg) {
    this.vx = vx; this.vz = vz; this.vy = Math.min(6, Math.hypot(vx, vz) * 0.35);
    this.hp -= dmg; this.downT = 2.5 + Math.random();
    if (this.hp <= 0) { this.alive = false; this.hp = 0; }
  }
  get isDown() { return this.downT > 0 || !this.alive; }
}

const P = { TORSO: 0, HEAD: 1, ARM_L: 2, ARM_R: 3, LEG_L: 4, LEG_R: 5, HAIR: 6, SOMBRERO: 7, GORRA: 8 };

export class CrowdRenderer {
  constructor(scene, capacity = 80) {
    const mat = new THREE.MeshToonMaterial({ gradientMap, color: 0xffffff });
    const matVC = new THREE.MeshToonMaterial({ gradientMap, color: 0xffffff, vertexColors: true });
    const geos = [];
    geos[P.TORSO] = new THREE.BoxGeometry(0.56, 0.66, 0.32).translate(0, 0.33, 0);
    geos[P.HEAD] = new THREE.IcosahedronGeometry(0.27, 1);
    geos[P.ARM_L] = geos[P.ARM_R] = new THREE.BoxGeometry(0.16, 0.62, 0.18).translate(0, -0.3, 0);
    geos[P.LEG_L] = geos[P.LEG_R] = new THREE.BoxGeometry(0.21, 0.86, 0.24).translate(0, -0.43, 0);
    geos[P.HAIR] = new THREE.SphereGeometry(0.29, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    geos[P.SOMBRERO] = coloredMerge([[new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14), 0xffffff], [new THREE.CylinderGeometry(0.16, 0.24, 0.32, 10).translate(0, 0.17, 0), 0xffffff], [new THREE.CylinderGeometry(0.245, 0.245, 0.06, 10).translate(0, 0.05, 0), 0x8d3b2a]]);
    geos[P.GORRA] = coloredMerge([[new THREE.CylinderGeometry(0.27, 0.29, 0.16, 10).translate(0, 0.08, 0), 0xffffff], [new THREE.BoxGeometry(0.32, 0.04, 0.22).translate(0, 0.02, 0.28), 0x111111]]);
    // Ojos: dos puntos oscuros fusionados en la cabeza
    geos[P.HEAD] = coloredMerge([[geos[P.HEAD], 0xffffff], [new THREE.SphereGeometry(0.045, 6, 4).translate(-0.1, 0.04, 0.24), 0x111111], [new THREE.SphereGeometry(0.045, 6, 4).translate(0.1, 0.04, 0.24), 0x111111]]);
    // Vertex colors en blanco se multiplican por el color de instancia
    this.meshes = geos.map((g, i) => {
      const useVC = !!g.attributes.color;
      const m = new THREE.InstancedMesh(g, useVC ? matVC : mat, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.castShadow = true; m.count = 0;
      m.setColorAt(0, new THREE.Color());
      scene.add(m);
      return m;
    });
    this.cap = capacity;
    this.B = new THREE.Matrix4(); this.L = new THREE.Matrix4(); this.M = new THREE.Matrix4();
    this.q = new THREE.Quaternion(); this.qt = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
    this.c = new THREE.Color();
    this.ax = new THREE.Vector3(1, 0, 0); this.ay = new THREE.Vector3(0, 1, 0);
  }

  put(part, matrix, color) {
    const m = this.meshes[part];
    if (m.count >= this.cap) return;
    m.setMatrixAt(m.count, matrix); m.setColorAt(m.count, this.c.set(color)); m.count++;
  }
  part(part, px, py, pz, rx, color) {
    this.L.makeRotationX(rx).setPosition(px, py, pz);
    this.M.multiplyMatrices(this.B, this.L);
    this.put(part, this.M, color);
  }

  render(lists, alpha, camX, camZ, maxDist = 140) {
    for (const m of this.meshes) m.count = 0;
    const md2 = maxDist * maxDist;
    for (const list of lists) for (const ch of list) {
      if (!ch.visible || !ch.onFoot) continue;
      const x = lerp(ch.px, ch.x, alpha), z = lerp(ch.pz, ch.z, alpha), y = lerp(ch.py, ch.y, alpha);
      if ((x - camX) ** 2 + (z - camZ) ** 2 > md2) continue;
      const yaw = lerpAngle(ch.pyaw, ch.yaw, alpha);
      this.q.setFromAxisAngle(this.ay, yaw);
      this.qt.setFromAxisAngle(this.ax, -ch.tilt);
      this.q.multiply(this.qt);
      const sc = ch.look.scale || 1;
      this.B.compose(this.v.set(x, y + (ch.tilt ? 0.18 * (ch.tilt / 1.57) : 0), z), this.q, this.one.setScalar(sc));
      const L = ch.look;
      const sw = Math.sin(ch.phase) * clamp(ch.speed / 3.5, 0, 1) * 0.85;
      let armR = -sw * 0.9, armL = sw * 0.9;
      if (ch.pose === 'aim') { armR = -1.5; armL = -1.25; }
      else if (ch.pose === 'punch') { armR = -1.55 * Math.sin(clamp(ch.punchT / 0.25, 0, 1) * Math.PI); }
      else if (ch.pose === 'hands') { armR = armL = -2.9; }
      this.part(P.TORSO, 0, 0.85, 0, 0, L.shirt);
      this.part(P.HEAD, 0, 1.8, 0, 0, L.skin);
      this.part(P.ARM_L, -0.37, 1.45, 0, armL, L.shirt);
      this.part(P.ARM_R, 0.37, 1.45, 0, armR, L.shirt);
      this.part(P.LEG_L, -0.14, 0.86, 0, sw, L.pants);
      this.part(P.LEG_R, 0.14, 0.86, 0, -sw, L.pants);
      if (L.hat === 1) this.part(P.SOMBRERO, 0, 1.98, 0, 0, L.hatColor || 0xe8d29a);
      else if (L.hat === 2) this.part(P.GORRA, 0, 1.96, 0, 0, L.hatColor || 0x1a237e);
      else this.part(P.HAIR, 0, 1.83, 0, 0, L.hair);
    }
    for (const m of this.meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}

// Física y animación comunes de personajes a pie.
export function stepCharacterBody(ch, dt) {
  ch.y += ch.vy * dt;
  if (ch.y > 0) ch.vy -= 22 * dt; else { ch.y = 0; ch.vy = 0; }
  if (ch.downT > 0 || !ch.alive) {
    ch.tilt = Math.min(1.57, ch.tilt + dt * 6);
    const f = Math.exp(-3.5 * dt); ch.vx *= f; ch.vz *= f;
    ch.x += ch.vx * dt; ch.z += ch.vz * dt;
    if (ch.alive) { ch.downT -= dt; if (ch.downT <= 0) ch.downT = 0; }
    ch.speed = 0;
    return false;
  }
  ch.tilt = Math.max(0, ch.tilt - dt * 5);
  if (ch.punchT > 0) { ch.punchT -= dt; if (ch.punchT <= 0 && ch.pose === 'punch') ch.pose = 'walk'; }
  ch.phase += ch.speed * dt * 2.6;
  return true;
}

export function randomLook(r, kind = 'ped') {
  const pick = (a) => a[Math.floor(r() * a.length)];
  if (kind === 'cop') return { skin: pick(SKINS), shirt: 0x2b3a8c, pants: 0x1c2240, hair: 0x111111, hat: 2, hatColor: 0x1c2240, scale: 1.02 };
  if (kind === 'thug') return { skin: pick(SKINS), shirt: pick([0x212121, 0x4e342e, 0x880e4f]), pants: 0x1b1b1b, hair: 0x111111, hat: r() < 0.5 ? 2 : 0, hatColor: 0x111111, scale: 1.05 };
  const hat = r() < 0.18 ? 1 : r() < 0.1 ? 2 : 0;
  return { skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS), hat, hatColor: hat === 2 ? pick(SHIRTS) : 0xe8d29a, scale: 0.92 + r() * 0.14 };
}
