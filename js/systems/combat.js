// Disparo hitscan, trazadoras, explosiones y efectos (todo con buffers preasignados).
import * as THREE from 'three';
import { clamp } from '../util.js';

export const WEAPONS = [
  { id: 'punos', name: 'Puños', icon: '👊', melee: true },
  { id: 'pistola', name: 'Pistola', icon: '🔫', rate: 0.28, dmg: 34, spread: 0.018, range: 75, start: 60 },
  { id: 'subfusil', name: 'Subfusil', icon: '💥', rate: 0.09, dmg: 17, spread: 0.045, range: 60, start: 0 },
];

const MAX_TRACERS = 48, MAX_FX = 64;

export class Combat {
  constructor(game) {
    this.g = game;
    const pos = new Float32Array(MAX_TRACERS * 6), col = new Float32Array(MAX_TRACERS * 6);
    this.tGeo = new THREE.BufferGeometry();
    this.tGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(this.tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false }));
    this.tracers.frustumCulled = false;
    game.scene.add(this.tracers);
    this.tLife = new Float32Array(MAX_TRACERS); this.tNext = 0;
    // Efectos: esferas que crecen y se desvanecen (destellos, humo, explosiones)
    this.fx = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }), MAX_FX);
    this.fx.frustumCulled = false; this.fx.count = 0; this.fx.setColorAt(0, new THREE.Color());
    game.scene.add(this.fx);
    this.fxs = Array.from({ length: MAX_FX }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, s0: 1, s1: 1, c0: new THREE.Color(), c1: new THREE.Color(), vy: 0 }));
    this.m = new THREE.Matrix4(); this.c = new THREE.Color(); this.v = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3();
    this.hit = { type: null, target: null, t: 0, x: 0, y: 0, z: 0 };
    this.shake = 0;
  }

  tracer(ax, ay, az, bx, by, bz, color = 0xffe082) {
    const i = this.tNext; this.tNext = (this.tNext + 1) % MAX_TRACERS;
    const p = this.tGeo.attributes.position.array, c = this.tGeo.attributes.color.array, col = this.c.set(color);
    p.set([ax, ay, az, bx, by, bz], i * 6);
    c.set([col.r, col.g, col.b, col.r * 0.3, col.g * 0.3, col.b * 0.3], i * 6);
    this.tLife[i] = 0.08;
  }

  effect(x, y, z, life, s0, s1, c0, c1, vy = 0) {
    const f = this.fxs.find((f) => f.life <= 0);
    if (!f) return;
    f.x = x; f.y = y; f.z = z; f.life = f.max = life; f.s0 = s0; f.s1 = s1; f.c0.set(c0); f.c1.set(c1); f.vy = vy;
  }

  // Rayo contra personajes, vehículos y edificios. Devuelve this.hit.
  raycast(ox, oy, oz, dx, dy, dz, range, ignoreChar, ignoreVeh) {
    const h = this.hit; h.type = null; h.target = null; h.t = range;
    const g = this.g;
    for (const list of g.charLists) for (const c of list) {
      if (c === ignoreChar || !c.onFoot || !c.visible) continue;
      const cy = c.isDown ? 0.35 : 1.15, rad = c.isDown ? 0.6 : 0.55;
      const lx = c.x - ox, ly = cy - oy, lz = c.z - oz;
      const tca = lx * dx + ly * dy + lz * dz; if (tca < 0 || tca > h.t) continue;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      if (d2 > rad * rad) continue;
      const t = tca - Math.sqrt(rad * rad - d2);
      if (t < h.t) { h.t = t; h.type = 'char'; h.target = c; }
    }
    for (const v of g.vehicles) {
      if (v === ignoreVeh) continue;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const rx = ox - v.x, rz = oz - v.z;
      const lo = [rx * -fz + rz * fx, rx * fx + rz * fz], ld = [dx * -fz + dz * fx, dx * fx + dz * fz];
      const ext = [v.spec.wid / 2, v.spec.len / 2];
      let t0 = 0, t1 = h.t, ok = true;
      for (let k = 0; k < 2; k++) {
        if (Math.abs(ld[k]) < 1e-6) { if (Math.abs(lo[k]) > ext[k]) { ok = false; break; } continue; }
        let a = (-ext[k] - lo[k]) / ld[k], b = (ext[k] - lo[k]) / ld[k]; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
      }
      if (!ok) continue;
      const y = oy + dy * t0;
      if (y < 0 || y > v.spec.hgt + 0.2) continue;
      if (t0 < h.t) { h.t = t0; h.type = 'veh'; h.target = v; }
    }
    const bx = ox + dx * h.t, bz = oz + dz * h.t;
    const out = this._o || (this._o = { t: 1 });
    if (g.world.segmentBlocked(ox, oz, bx, bz, oy + dy * h.t * 0.5, out)) { h.t *= out.t; h.type = 'wall'; h.target = null; }
    h.x = ox + dx * h.t; h.y = oy + dy * h.t; h.z = oz + dz * h.t;
    return h;
  }

  // Disparo genérico. shooter: Character; byPlayer para reportar delitos.
  fire(shooter, weapon, ox, oy, oz, dx, dy, dz, byPlayer, ignoreVeh = null) {
    const s = weapon.spread;
    dx += (Math.random() - 0.5) * s * 2; dy += (Math.random() - 0.5) * s; dz += (Math.random() - 0.5) * s * 2;
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    const h = this.raycast(ox, oy, oz, dx, dy, dz, weapon.range, shooter, ignoreVeh);
    this.tracer(ox, oy, oz, h.x, h.y, h.z, byPlayer ? 0xfff59d : 0xffab91);
    this.effect(ox + dx * 0.4, oy, oz + dz * 0.4, 0.06, 0.18, 0.35, 0xfff176, 0xff9800);
    const g = this.g, pp = g.player.pos();
    g.audio.shot(Math.hypot(ox - pp.x, oz - pp.z));
    g.peds.panic(ox, oz, 45);
    if (byPlayer) g.wanted.report('shoot', ox, oz);
    if (h.type === 'char') {
      const c = h.target;
      this.effect(h.x, h.y, h.z, 0.25, 0.15, 0.4, 0xd32f2f, 0x7f0000);
      this.damageChar(c, weapon.dmg, dx * 3, dz * 3, byPlayer, shooter);
    } else if (h.type === 'veh') {
      if (byPlayer) h.target.playerHit = true;
      h.target.damage(weapon.dmg * 0.35);
      this.effect(h.x, h.y, h.z, 0.15, 0.1, 0.3, 0xffffff, 0xffc107);
      if (byPlayer && h.target.owner === 'police') g.wanted.report('shootCop', h.x, h.z);
    } else if (h.type === 'wall') {
      this.effect(h.x, h.y, h.z, 0.3, 0.1, 0.35, 0xd7ccc8, 0x8d6e63);
    }
    return h;
  }

  damageChar(c, dmg, kx, kz, byPlayer, attacker) {
    const g = this.g;
    if (c.isPlayer) { g.player.hurt(dmg); return; }
    const wasAlive = c.alive;
    c.hp -= dmg;
    if (c.hp <= 0) { c.alive = false; c.hp = 0; c.downT = 1; c.vx = kx; c.vz = kz; }
    else if (dmg >= 30) c.knock(kx, kz, 0);
    if (c.kind === 'ped') { c.flee = 8; c.threat = { x: attacker ? attacker.x : c.x, z: attacker ? attacker.z : c.z }; }
    if (byPlayer) {
      const cop = c.kind === 'cop';
      g.wanted.report(cop ? (wasAlive && !c.alive ? 'killCop' : 'shootCop') : wasAlive && !c.alive ? 'killPed' : 'hurtPed', c.x, c.z);
      if (wasAlive && !c.alive && c.kind === 'ped' && Math.random() < 0.6) g.pickups.drop(c.x, c.z, 'cash', 10 + Math.floor(Math.random() * 60));
    }
    if (g.missions) g.missions.onCharDamaged(c, byPlayer);
  }

  explode(x, z, cause) {
    const g = this.g, pp = g.player.pos();
    const d = Math.hypot(x - pp.x, z - pp.z);
    g.audio.explosion(d);
    this.shake = Math.max(this.shake, clamp(1.4 - d / 60, 0, 1.4));
    g.input.rumble(clamp(1 - d / 50, 0, 1), 0.8, 500);
    for (let i = 0; i < 6; i++) this.effect(x + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, z + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 0.6, 1, 4 + Math.random() * 2, i % 2 ? 0xffeb3b : 0xff7043, 0x424242, 3);
    for (const list of g.charLists) for (const c of list) {
      if (!c.onFoot) continue;
      const dd = Math.hypot(c.x - x, c.z - z);
      if (dd < 9) {
        const k = (9 - dd) * 1.6;
        if (c.isPlayer) { g.player.hurt((9 - dd) * 12); c.knock((c.x - x) / (dd + 0.1) * k, (c.z - z) / (dd + 0.1) * k, 0); }
        else { c.knock((c.x - x) / (dd + 0.1) * k, (c.z - z) / (dd + 0.1) * k, (9 - dd) * 25); }
      }
    }
    for (const v of g.vehicles) {
      const dd = Math.hypot(v.x - x, v.z - z);
      if (dd < 10 && dd > 0.1) { v.vx += ((v.x - x) / dd) * (10 - dd) * 1.2; v.vz += ((v.z - z) / dd) * (10 - dd) * 1.2; v.damage((10 - dd) * 8); }
    }
    g.peds.panic(x, z, 80, 10);
    if (cause === 'player') g.wanted.report('explosion', x, z);
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < MAX_TRACERS; i++) if (this.tLife[i] > 0) {
      this.tLife[i] -= dt; any = true;
      if (this.tLife[i] <= 0) this.tGeo.attributes.position.array.fill(0, i * 6, i * 6 + 6);
    }
    if (any) this.tGeo.attributes.position.needsUpdate = this.tGeo.attributes.color.needsUpdate = true;
    let n = 0;
    for (const f of this.fxs) {
      if (f.life <= 0) continue;
      f.life -= dt; if (f.life <= 0) continue;
      const t = 1 - f.life / f.max;
      f.y += f.vy * dt;
      this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.s.setScalar(f.s0 + (f.s1 - f.s0) * t));
      this.fx.setMatrixAt(n, this.m);
      this.fx.setColorAt(n, this.c.copy(f.c0).lerp(f.c1, t));
      n++;
    }
    this.fx.count = n;
    this.fx.instanceMatrix.needsUpdate = true; if (this.fx.instanceColor) this.fx.instanceColor.needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
