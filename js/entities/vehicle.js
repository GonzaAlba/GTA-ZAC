// Vehículos: física arcade (agarre lateral, derrape con freno de mano) y render instanciado.
import * as THREE from 'three';
import { gradientMap } from '../world/materials.js';
import { coloredMerge } from '../world/cityBuilder.js';
import { resolveCircle } from '../systems/physics.js';
import { clamp, lerp, lerpAngle, damp } from '../util.js';
import { groundY } from '../world/terrain.js';
import { RoundedBoxGeometry } from '../../lib/jsm/geometries/RoundedBoxGeometry.js';

// len, wid: dimensiones; maxV en m/s; acc, brk en m/s²; grip lateral; hp
export const TYPES = {
  compacto: { len: 3.9, wid: 1.8, hgt: 1.5, maxV: 34, acc: 9, brk: 18, grip: 7.5, mass: 1, hp: 90, name: 'Bolita' },
  taxi: { len: 4.5, wid: 1.9, hgt: 1.45, maxV: 38, acc: 10, brk: 19, grip: 8, mass: 1.2, hp: 100, name: 'Taxi Serrano' },
  pickup: { len: 5.2, wid: 2.05, hgt: 1.8, maxV: 33, acc: 8.5, brk: 16, grip: 7, mass: 1.6, hp: 130, name: 'Camioneta' },
  deportivo: { len: 4.4, wid: 1.95, hgt: 1.2, maxV: 50, acc: 15, brk: 24, grip: 9.5, mass: 1.1, hp: 85, name: 'Neblina GT' },
  combi: { len: 5, wid: 2.1, hgt: 2.2, maxV: 27, acc: 7, brk: 14, grip: 6.5, mass: 1.8, hp: 140, name: 'Combi' },
  policia: { len: 4.7, wid: 1.95, hgt: 1.5, maxV: 44, acc: 13, brk: 22, grip: 9, mass: 1.4, hp: 160, name: 'Patrulla' },
  camion: { len: 7.6, wid: 2.5, hgt: 3, maxV: 23, acc: 5, brk: 11, grip: 6, mass: 3.5, hp: 260, name: 'Camión de Sidra' },
};
export const PAINTS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xf5f5f5, 0x212121, 0xff7043, 0x8e24aa, 0x26c6da, 0x9e9e9e, 0xa1887f];

let NEXT_ID = 1;
const res = { nx: 0, nz: 0, impact: 0, hit: false };

export class Vehicle {
  constructor(type, x, z, yaw, paint) {
    this.id = NEXT_ID++;
    this.type = type; this.spec = TYPES[type];
    this.x = this.px = x; this.z = this.pz = z; this.yaw = this.pyaw = yaw;
    this.vx = 0; this.vz = 0; this.steer = 0; this.vf = 0;
    this.paint = paint ?? (type === 'policia' ? 0xffffff : type === 'taxi' ? 0x2e7d32 : PAINTS[Math.floor(Math.random() * PAINTS.length)]);
    this.hp = this.spec.hp; this.burn = -1; this.dead = false;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.driver = null; // Character o null
    this.ai = null; // controlador de IA
    this.wheelRot = 0; this.roll = 0; this.pitch = 0; this.pRoll = 0; this.pPitch = 0;
    this.siren = type === 'policia'; this.sirenOn = false;
    this.mission = false; this.locked = false;
    this.r = this.spec.wid * 0.5; this.off = Math.max(0, this.spec.len / 2 - this.r);
    this.onFoot = false;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  fwdX() { return Math.sin(this.yaw); } fwdZ() { return Math.cos(this.yaw); }
  savePrev() { this.px = this.x; this.pz = this.z; this.pyaw = this.yaw; this.pRoll = this.roll; this.pPitch = this.pitch; }

  step(dt, world, onImpact) {
    const S = this.spec, inp = this.input;
    if (this.dead) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -fz, rz = fx;
    let vf = this.vx * fx + this.vz * fz, vr = this.vx * rx + this.vz * rz;
    this.steer = damp(this.steer, inp.steer, 9, dt);
    const sp = Math.abs(vf);
    const steerMax = lerp(0.62, 0.2, clamp(sp / S.maxV, 0, 1));
    const wheelbase = S.len * 0.62;
    let yawRate = (vf / wheelbase) * Math.tan(this.steer * steerMax);
    if (inp.handbrake) yawRate *= 1.4;
    this.yaw -= yawRate * dt;

    let acc = 0;
    if (inp.throttle > 0) acc += inp.throttle * S.acc * (vf < 0 ? 2 : clamp(1 - vf / S.maxV, 0, 1));
    if (inp.brake > 0) {
      if (vf > 0.6) acc -= inp.brake * S.brk;
      else acc -= inp.brake * S.acc * 0.7 * clamp(1 + vf / (S.maxV * 0.35), 0, 1);
    }
    if (!inp.throttle && !inp.brake) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 1.2 + sp * 0.05);
    acc -= vf * Math.abs(vf) * 0.0025;
    // Pendiente real: la gravedad frena cuesta arriba y empuja cuesta abajo
    const slope = (groundY(this.x + fx * 1.5, this.z + fz * 1.5) - groundY(this.x - fx * 1.5, this.z - fz * 1.5)) / 3;
    acc -= 9.8 * slope * 0.7;
    this.slope = slope;
    vf += acc * dt;
    if (inp.handbrake) vf *= Math.exp(-1.6 * dt);
    const grip = inp.handbrake ? 1.4 : S.grip * (this.dead ? 0.5 : 1);
    const vrOld = vr;
    vr *= Math.exp(-grip * dt);
    this.vx = fx * vf + rx * vr; this.vz = fz * vf + rz * vr;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.vf = vf;

    // Inclinación visual de la carrocería
    this.roll = damp(this.roll, clamp(-yawRate * vf * 0.012 + (vrOld - vr) * 0.05, -0.12, 0.12), 8, dt);
    this.pitch = damp(this.pitch, clamp(-acc * 0.006, -0.06, 0.06), 6, dt);
    this.wheelRot += (vf * dt) / 0.36;

    // Colisión con edificios: dos círculos a lo largo del eje
    let worst = 0;
    for (const s of [this.off, -this.off]) {
      const cx = this.x + fx * s, cz = this.z + fz * s;
      const probe = this._probe || (this._probe = { x: 0, z: 0, vx: 0, vz: 0 });
      probe.x = cx; probe.z = cz; probe.vx = this.vx; probe.vz = this.vz;
      resolveCircle(world, probe, this.r, 0.5, res);
      if (res.hit) {
        this.x += probe.x - cx; this.z += probe.z - cz;
        const vn = this.vx * res.nx + this.vz * res.nz;
        const nl = Math.hypot(res.nx, res.nz) || 1;
        if (vn < 0) {
          const nx = res.nx / nl, nz = res.nz / nl, v = vn / nl;
          this.vx -= 1.25 * v * nx; this.vz -= 1.25 * v * nz;
          worst = Math.max(worst, -v);
          // Pequeño giro al rozar paredes
          this.yaw += (fx * nz - fz * nx) * 0.02 * Math.sign(s || 1);
        }
      }
    }
    // La IA recibe menos daño contra paredes (en el género los NPC rara vez se autodestruyen)
    if (worst > 3) this.damage((worst - 3) * 3.2 * (this.ai && !this.driver?.isPlayer ? 0.3 : 1), onImpact, worst);

    if (this.hp <= 25 && this.burn < 0 && !this.dead) this.burn = 5;
    if (this.burn > 0) { this.burn -= dt; if (this.burn <= 0) this.burn = 0; }
  }

  damage(amount, onImpact, impact = 0) {
    if (this.dead) return;
    this.hp -= amount;
    if (onImpact) onImpact(this, impact, amount);
  }

  // Colisión vehículo-vehículo (círculos), con intercambio de momento según masa.
  static collide(a, b, onImpact) {
    for (const sa of [a.off, -a.off]) for (const sb of [b.off, -b.off]) {
      const ax = a.x + Math.sin(a.yaw) * sa, az = a.z + Math.cos(a.yaw) * sa;
      const bx = b.x + Math.sin(b.yaw) * sb, bz = b.z + Math.cos(b.yaw) * sb;
      const dx = bx - ax, dz = bz - az, R = a.r + b.r, d2 = dx * dx + dz * dz;
      if (d2 >= R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = R - d;
      const ma = a.spec.mass, mb = b.spec.mass, tot = ma + mb;
      a.x -= nx * pen * (mb / tot); a.z -= nz * pen * (mb / tot);
      b.x += nx * pen * (ma / tot); b.z += nz * pen * (ma / tot);
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const j = (-(1.3) * rv) / (1 / ma + 1 / mb);
        a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz;
        b.vx += (j / mb) * nx; b.vz += (j / mb) * nz;
        const imp = -rv;
        if (imp > 3) { a.damage((imp - 3) * 2.5 * (mb / ma) ** 0.5, onImpact, imp); b.damage((imp - 3) * 2.5 * (ma / mb) ** 0.5, onImpact, imp); }
      }
    }
  }
}

// ---------------- Render instanciado ----------------
function bodyGeometry(type) {
  const S = TYPES[type], L = S.len, W = S.wid;
  const P = 0xffffff, GL = 0x22303c, BLK = 0x1f1f22, HL = 0xfff6cf, TL = 0xd32f2f, CH = 0xd0d0d0;
  const parts = [];
  // Piezas grandes con aristas redondeadas (carrocería creíble); detalles pequeños como cajas
  const box = (w, h, d, x, y, z, c) => parts.push([(w > 0.8 && h > 0.3 && d > 0.8 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.14, h * 0.3)) : new THREE.BoxGeometry(w, h, d)).translate(x, y + h / 2, z), c]);
  const cabin = (w, h, d, x, y, z, c, taper = 0.78) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > h * 0.5) { p.setX(i, p.getX(i) * 0.9); p.setZ(i, p.getZ(i) * taper); }
    g.translate(x, y, z); parts.push([g, c]);
  };
  if (type === 'compacto') {
    box(W, 0.6, L, 0, 0.3, 0, P);
    cabin(W * 0.92, 0.75, L * 0.55, 0, 0.9, -0.15, P, 0.7);
    box(W * 0.94, 0.5, L * 0.42, 0, 0.98, -0.15, GL);
    parts.push([new THREE.SphereGeometry(W * 0.48, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1.1).translate(0, 0.9, L * 0.28), P]);
  } else if (type === 'pickup') {
    box(W, 0.75, L, 0, 0.35, 0, P);
    cabin(W * 0.95, 0.85, L * 0.36, 0, 1.1, L * 0.08, P, 0.8);
    box(W * 0.97, 0.5, L * 0.3, 0, 1.2, L * 0.08, GL);
    box(W, 0.45, 0.15, 0, 1.1, -L / 2 + 0.08, P); box(0.12, 0.45, L * 0.42, W / 2 - 0.06, 1.1, -L * 0.27, P); box(0.12, 0.45, L * 0.42, -W / 2 + 0.06, 1.1, -L * 0.27, P);
    box(1.2, 0.6, 1.0, 0, 1.1, -L * 0.28, 0x8a6a4a); box(0.9, 0.18, 0.7, 0, 1.7, -L * 0.28, 0xd32f2f);
  } else if (type === 'deportivo') {
    box(W, 0.5, L, 0, 0.3, 0, P);
    cabin(W * 0.85, 0.45, L * 0.42, 0, 0.8, -0.2, GL, 0.6);
    box(W, 0.1, 0.4, 0, 0.95, -L / 2 + 0.25, BLK); box(0.1, 0.25, 0.1, 0.6, 0.8, -L / 2 + 0.25, BLK); box(0.1, 0.25, 0.1, -0.6, 0.8, -L / 2 + 0.25, BLK);
  } else if (type === 'combi') {
    box(W, 1.9, L, 0, 0.3, 0, P);
    box(W * 1.01, 0.55, L * 0.85, 0, 1.25, -0.2, GL);
    box(W * 1.01, 0.7, 0.05, 0, 1.15, L / 2, GL);
    box(W * 1.02, 0.25, L * 1.0, 0, 0.75, 0, 0xf5f5f5);
  } else if (type === 'camion') {
    box(W, 2.2, 2.0, 0, 0.5, L / 2 - 1.0, 0xd32f2f);
    box(W * 1.01, 0.8, 0.05, 0, 1.6, L / 2, GL);
    box(W, 2.6, L - 2.3, 0, 0.6, -1.1, P);
    box(W * 1.02, 0.8, L * 0.5, 0, 1.6, -1.1, 0xd32f2f); // franja "sidra"
    box(W * 1.03, 0.4, L * 0.3, 0, 1.8, -1.1, 0x43a047);
  } else { // taxi / policia / sedán
    box(W, 0.62, L, 0, 0.32, 0, P);
    cabin(W * 0.94, 0.68, L * 0.48, 0, 0.94, -0.1, P, 0.72);
    box(W * 0.96, 0.46, L * 0.38, 0, 1.0, -0.1, GL);
    if (type === 'taxi') { box(W * 1.005, 0.2, L * 0.98, 0, 0.62, 0, 0xffffff); box(0.7, 0.25, 0.3, 0, 1.62, -0.1, 0xfdd835); }
    if (type === 'policia') { box(W * 1.005, 0.62, L * 0.4, 0, 0.32, 0, 0x1c2240); box(W * 0.96, 0.03, 1.6, 0, 1.62, -0.1, 0x1c2240); }
  }
  box(W * 0.98, 0.18, 0.12, 0, 0.3, L / 2, BLK); box(W * 0.98, 0.18, 0.12, 0, 0.3, -L / 2, BLK);
  box(0.36, 0.2, 0.06, W / 2 - 0.3, 0.65, L / 2 + 0.01, HL); box(0.36, 0.2, 0.06, -W / 2 + 0.3, 0.65, L / 2 + 0.01, HL);
  box(0.32, 0.18, 0.06, W / 2 - 0.3, 0.65, -L / 2 - 0.01, TL); box(0.32, 0.18, 0.06, -W / 2 + 0.3, 0.65, -L / 2 - 0.01, TL);
  // Espejos, parrilla y placas
  box(0.08, 0.12, 0.16, W / 2 + 0.05, 0.95, L * 0.12, BLK); box(0.08, 0.12, 0.16, -W / 2 - 0.05, 0.95, L * 0.12, BLK);
  box(W * 0.5, 0.22, 0.05, 0, 0.55, L / 2 + 0.02, 0x2b2b2e); box(0.5, 0.16, 0.04, 0, 0.32, L / 2 + 0.07, 0xf5f5f5); box(0.5, 0.16, 0.04, 0, 0.5, -L / 2 - 0.07, 0xf5f5f5);
  box(W * 1.01, 0.06, L * 0.7, 0, 0.62, 0, CH);
  return coloredMerge(parts);
}

export class VehicleRenderer {
  constructor(scene, capacity = 48) {
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.35, vertexColors: true });
    this.meshes = {};
    for (const t of Object.keys(TYPES)) {
      const m = new THREE.InstancedMesh(bodyGeometry(t), this.mat, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = true; m.count = 0;
      m.setColorAt(0, new THREE.Color());
      scene.add(m); this.meshes[t] = m;
    }
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12).rotateZ(Math.PI / 2);
    const wcol = coloredMerge([[wg, 0x1d1d1f], [new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8).rotateZ(Math.PI / 2), 0xbdbdbd]]);
    this.wheels = new THREE.InstancedMesh(wcol, this.mat, capacity * 6);
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.wheels.frustumCulled = false; this.wheels.castShadow = true;
    scene.add(this.wheels);
    // Torretas de patrulla (rojo/azul) y humo/fuego
    this.lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.32), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), capacity * 2);
    this.lights.frustumCulled = false; this.lights.setColorAt(0, new THREE.Color()); scene.add(this.lights);
    this.fire = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), capacity * 3);
    this.fire.frustumCulled = false; this.fire.setColorAt(0, new THREE.Color()); scene.add(this.fire);
    this.B = new THREE.Matrix4(); this.M = new THREE.Matrix4(); this.L = new THREE.Matrix4();
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
    this.c = new THREE.Color(); this.burnt = new THREE.Color(0x2a2a2a);
    this.t = 0;
  }

  render(vehicles, alpha, camX, camZ, dt, maxDist = 330) {
    this.t += dt;
    for (const k in this.meshes) this.meshes[k].count = 0;
    let wn = 0, ln = 0, fn = 0;
    const md2 = maxDist * maxDist;
    for (const v of vehicles) {
      const x = lerp(v.px, v.x, alpha), z = lerp(v.pz, v.z, alpha);
      if ((x - camX) ** 2 + (z - camZ) ** 2 > md2) continue;
      const yaw = lerpAngle(v.pyaw, v.yaw, alpha);
      // Inclinación según el terreno (cabeceo y alabeo) + dinámica de la carrocería
      const fx = Math.sin(yaw), fz = Math.cos(yaw), gy = groundY(x, z);
      const gp = -Math.atan((groundY(x + fx * 1.5, z + fz * 1.5) - groundY(x - fx * 1.5, z - fz * 1.5)) / 3);
      const gr = Math.atan((groundY(x + fz, z - fx) - groundY(x - fz, z + fx)) / 2);
      this.e.set(lerp(v.pPitch, v.pitch, alpha) + gp, yaw, lerp(v.pRoll, v.roll, alpha) + gr);
      this.q.setFromEuler(this.e);
      this.B.compose(this.v.set(x, gy + 0.02, z), this.q, this.s.set(1, 1, 1));
      const m = this.meshes[v.type];
      m.setMatrixAt(m.count, this.B);
      m.setColorAt(m.count, v.dead ? this.burnt : this.c.set(v.paint));
      m.count++;
      const S = v.spec, wx = S.wid / 2 - 0.12, wz = S.len / 2 - 0.75;
      const axles = v.type === 'camion' ? [wz, -wz + 1.2, -wz] : [wz, -wz];
      for (let ai = 0; ai < axles.length; ai++) for (const sx of [-1, 1]) {
        const steer = ai === 0 ? -v.steer * 0.5 : 0;
        this.e.set(v.wheelRot, steer, 0); this.q.setFromEuler(this.e);
        this.L.compose(this.v.set(sx * wx, 0.36, axles[ai]), this.q, this.s.set(1, 1, 1));
        this.M.multiplyMatrices(this.B, this.L);
        this.wheels.setMatrixAt(wn++, this.M);
      }
      if (v.type === 'policia') {
        const ph = Math.floor(this.t * 8) % 2;
        for (const sx of [-1, 1]) {
          this.L.makeTranslation(sx * 0.32, 1.73, -0.1);
          this.M.multiplyMatrices(this.B, this.L);
          this.lights.setMatrixAt(ln, this.M);
          const on = v.sirenOn ? (ph === (sx > 0 ? 1 : 0)) : false;
          this.lights.setColorAt(ln++, this.c.set(sx > 0 ? (on ? 0xff2020 : 0x551111) : (on ? 0x2a6bff : 0x111a55)));
        }
      }
      if (v.burn >= 0 || v.dead) {
        for (let i = 0; i < 3; i++) {
          const ph = (this.t * 1.3 + i / 3 + v.id * 0.17) % 1;
          const s = v.dead ? 0.6 + ph * 1.6 : 0.4 + ph;
          this.L.compose(this.v.set(Math.sin(i * 2.1 + v.id) * 0.3, 1.0 + ph * 3, S.len * 0.32), this.q.identity(), this.s.setScalar(s));
          this.M.multiplyMatrices(this.B, this.L);
          this.fire.setMatrixAt(fn, this.M);
          this.fire.setColorAt(fn++, this.c.set(v.dead || ph > 0.5 ? 0x555555 : ph > 0.25 ? 0xff9800 : 0xffd54f));
        }
      }
    }
    this.wheels.count = wn; this.lights.count = ln; this.fire.count = fn;
    for (const k in this.meshes) { const m = this.meshes[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.wheels.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true; if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
    this.fire.instanceMatrix.needsUpdate = true; if (this.fire.instanceColor) this.fire.instanceColor.needsUpdate = true;
  }
}
