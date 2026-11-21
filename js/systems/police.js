// Nivel de búsqueda (1-5 estrellas) y respuesta policial: patrullas, agentes a pie y helicóptero.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { Character, randomLook, stepCharacterBody } from '../entities/characters.js';
import { DriverAI } from './traffic.js';
import { resolveCircle } from './physics.js';
import { gradientMap } from '../world/materials.js';
import { coloredMerge } from '../world/cityBuilder.js';
import { clamp, rng, dampAngle, damp } from '../util.js';
import { groundY } from '../world/terrain.js';

const r = rng(1312);
const res = { nx: 0, nz: 0, impact: 0, hit: false };
const CRIMES = { hitPed: 1, carjack: 1, punch: 1, shoot: 1, hurtPed: 2, killPed: 2, shootCop: 3, killCop: 4, explosion: 3, steal: 1 };
const COP_WEAPON = { rate: 1.1, dmg: 6, spread: 0.06, range: 60 };

export class Wanted {
  constructor(game) { this.g = game; this.level = 0; this.lastX = 0; this.lastZ = 0; this.unseen = 0; this.seen = false; this.checkT = 0; this.cooldown = 0; }
  get searchR() { return 70 + this.level * 40; }

  report(crime, x, z) {
    const lv = CRIMES[crime] || 1, g = this.g;
    const copNear = g.police.nearestCop(x, z) < 70;
    if (this.level > 0 && copNear) { this.lastX = x; this.lastZ = z; this.unseen = 0; }
    if (lv <= this.level) return;
    const reported = copNear || lv >= 2 || (this.cooldown <= 0 && r() < 0.35);
    this.cooldown = 4;
    if (reported) this.set(Math.max(this.level, lv), x, z);
  }
  set(level, x, z) {
    const p = this.g.player.pos();
    const prev = this.level;
    this.level = clamp(level, 0, 5);
    this.lastX = x ?? p.x; this.lastZ = z ?? p.z; this.unseen = 0;
    if (this.level > prev) this.g.hud.flashStars();
  }
  clear() { if (this.level) { this.level = 0; this.g.hud.notify('Perdiste a la policía'); } }

  update(dt) {
    this.cooldown -= dt;
    if (!this.level) return;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.25;
      this.seen = this.g.police.anySees();
      if (this.seen) { const p = this.g.player.pos(); this.lastX = p.x; this.lastZ = p.z; }
    }
    if (this.seen) { this.unseen = 0; return; }
    this.unseen += dt;
    const p = this.g.player.pos();
    const out = Math.hypot(p.x - this.lastX, p.z - this.lastZ) > this.searchR;
    if (out && this.unseen > 5 + this.level * 2) this.clear();
  }
}

export class Police {
  constructor(game) {
    this.g = game; this.units = []; this.cops = []; this.spawnT = 0;
    // Helicóptero (un solo objeto)
    const body = coloredMerge([
      [new THREE.SphereGeometry(1.6, 10, 8).scale(1, 0.9, 1.5), 0x1c2240],
      [new THREE.SphereGeometry(1.2, 10, 8, 0, Math.PI * 2, 0, 1.2).scale(1, 0.8, 1.2).translate(0, 0.3, 0.9), 0x9fe3ff],
      [new THREE.BoxGeometry(0.4, 0.4, 5).translate(0, 0.3, -3.6), 0x1c2240],
      [new THREE.BoxGeometry(0.15, 1.4, 0.8).translate(0, 0.9, -6), 0xffffff],
      [new THREE.BoxGeometry(0.1, 0.1, 3).translate(-0.9, -1.4, 0), 0x333333],
      [new THREE.BoxGeometry(0.1, 0.1, 3).translate(0.9, -1.4, 0), 0x333333],
    ]);
    this.heli = new THREE.Group();
    const hb = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, vertexColors: true }));
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.35), new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, color: 0x222222 }));
    this.rotor.position.y = 1.6;
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(7, 46, 16, 1, true).translate(0, -23, 0), new THREE.MeshBasicMaterial({ color: 0xfff8e1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    this.heli.add(hb, this.rotor, this.beam);
    this.heli.visible = false; this.heli.position.set(0, 60, 0);
    this.heliActive = false; this.heliShootT = 0;
    game.scene.add(this.heli);
  }

  nearestCop(x, z) {
    let d = Infinity;
    for (const u of this.units) if (!u.veh.dead) d = Math.min(d, Math.hypot(u.veh.x - x, u.veh.z - z));
    for (const c of this.cops) if (c.alive) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    // Patrullas civiles en tráfico también cuentan como testigos
    for (const v of this.g.vehicles) if (v.type === 'policia' && v.driver) d = Math.min(d, Math.hypot(v.x - x, v.z - z));
    return d;
  }

  anySees() {
    const p = this.g.player.pos(), W = this.g.world, lv = this.g.wanted.level;
    const R = 55 + lv * 15;
    const sees = (x, z) => { const d = Math.hypot(x - p.x, z - p.z); return d < R && !W.segmentBlocked(x, z, p.x, p.z, 1.5); };
    if (this.heliActive && Math.hypot(this.heli.position.x - p.x, this.heli.position.z - p.z) < 60) return true;
    for (const u of this.units) if (!u.veh.dead && u.veh.driver && sees(u.veh.x, u.veh.z)) return true;
    for (const c of this.cops) if (c.alive && !c.isDown && sees(c.x, c.z)) return true;
    return false;
  }

  spawnUnit() {
    const sp = this.g.traffic.spawnPoint(90, 230);
    if (!sp) return;
    const v = new Vehicle('policia', 0, 0, 0);
    v.owner = 'police'; v.sirenOn = true;
    const lv = this.g.wanted.level;
    const crew = [];
    for (let i = 0; i < (lv >= 2 ? 2 : 1); i++) { const c = new Character(randomLook(r, 'cop')); c.kind = 'cop'; c.hp = 100; c.onFoot = false; c.vehicle = v; c.shootT = 1 + r(); c.arrestT = 0; crew.push(c); }
    v.driver = crew[0];
    v.ai = new DriverAI(this.g, v, 'cruise');
    v.ai.place(sp[0], sp[1], 0.3);
    v.ai.aggr = lv >= 2 ? 1 : 0.6;
    this.g.addVehicle(v);
    this.units.push({ veh: v, crew, repath: 0, dismounted: false });
  }

  dismount(u) {
    u.dismounted = true;
    const v = u.veh, rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
    u.crew.forEach((c, i) => {
      const s = i === 0 ? -1 : 1;
      c.onFoot = true; c.vehicle = null;
      c.x = c.px = v.x + rx * s * 1.8; c.z = c.pz = v.z + rz * s * 1.8; c.yaw = c.pyaw = v.yaw;
      if (!this.cops.includes(c)) this.cops.push(c);
    });
    v.driver = null; v.input.throttle = 0; v.input.brake = 1;
  }

  update(dt) {
    const g = this.g, lv = g.wanted.level, P = g.player, p = P.pos();
    // Gestión de unidades
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i], v = u.veh;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (!g.vehicles.includes(v)) { this.units.splice(i, 1); continue; }
      if (lv === 0) {
        v.sirenOn = false;
        if (!u.dismounted && v.driver) { if (v.ai.mode !== 'cruise') { v.ai.mode = 'cruise'; v.ai.target = null; v.ai.aggr = 0; v.ai.attach(); } v.ai.update(dt); }
        if (d > 200 && !g.inView(v.x, v.z)) { g.removeVehicle(v); this.units.splice(i, 1); u.crew.forEach((c) => { const k = this.cops.indexOf(c); if (k >= 0) this.cops.splice(k, 1); }); }
        continue;
      }
      if (v.dead || !v.driver) continue;
      if (u.dismounted) continue;
      v.sirenOn = true;
      u.repath -= dt;
      const los = d < 70 && !g.world.segmentBlocked(v.x, v.z, p.x, p.z, 1);
      if (los) {
        v.ai.mode = 'direct'; v.ai.target = p;
        v.ai.aggr = P.inVehicle && lv >= 2 ? 1 : 0;
        if (!P.inVehicle && d < 16 && v.speed < 3) this.dismount(u);
      } else if (u.repath <= 0) {
        u.repath = 1.5;
        v.ai.aggr = lv >= 2 ? 1 : 0.6;
        const G = g.world.graph;
        v.ai.mode = 'cruise'; v.ai.attach();
        const ne = G.nearestEdge(p.x, p.z);
        const goal = ne ? (ne.t < 0.5 ? ne.a : ne.b) : G.nearest(p.x, p.z, true);
        if (v.ai.a >= 0 && goal >= 0) {
          // Si la ruta desde el nodo de enfrente regresa por el de atrás, se planea desde atrás (vuelta en U)
          const fromB = v.ai.b >= 0 ? G.path(v.ai.b, goal, true, []) : null;
          if (fromB && fromB.length && fromB[1] !== v.ai.a) { fromB.unshift(v.ai.a); v.ai.setPath(fromB, p); }
          else { const fromA = G.path(v.ai.a, goal, true, []); if (fromA && fromA.length > 1) v.ai.setPath(fromA, p); else { v.ai.mode = 'direct'; v.ai.target = p; } }
        }
      }
      v.ai.update(dt);
      // Patrulla volcada o atascada lejos: reciclar
      if (d > 320) { g.removeVehicle(v); this.units.splice(i, 1); }
    }
    // Agentes a pie
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      if (!c.onFoot) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if ((!c.alive && d > 80) || d > 200) { this.cops.splice(i, 1); continue; }
      if (!stepCharacterBody(c, dt)) continue;
      if (lv === 0) { c.speed = 0; c.pose = 'walk'; continue; }
      const dx = p.x - c.x, dz = p.z - c.z;
      c.yaw = dampAngle(c.yaw, Math.atan2(dx, dz), 10, dt);
      const canSee = d < 45 && !g.world.segmentBlocked(c.x, c.z, p.x, p.z, 1.5);
      let spd = 0;
      if (lv === 1) {
        if (d > 1.3) spd = d > 6 ? 5.5 : 3;
        if (d < 1.6 && !P.inVehicle) { c.arrestT += dt; c.pose = 'punch'; c.punchT = 0.2; if (c.arrestT > 1.6) P.busted(); }
        else c.arrestT = 0;
      } else {
        if (d > 14 || !canSee) spd = 5.2; else if (d < 6) spd = -2;
        c.pose = canSee ? 'aim' : 'walk';
        c.shootT -= dt;
        if (canSee && c.shootT <= 0 && !P.dead) {
          c.shootT = COP_WEAPON.rate * (0.8 + r() * 0.6);
          const oy = groundY(c.x, c.z) + 1.4, L = Math.hypot(dx, dz) || 1;
          const miss = r() > clamp(0.5 - d * 0.012 - (P.inVehicle ? 0.15 : 0), 0.08, 0.45);
          const ex = miss ? (r() - 0.5) * 3 : 0, ez = miss ? (r() - 0.5) * 3 : 0;
          const tx = p.x + ex - c.x, tz = p.z + ez - c.z, ty = groundY(p.x, p.z) + 1.0 - oy, TL = Math.hypot(tx, ty, tz);
          const h = g.combat.fire(c, COP_WEAPON, c.x + (dx / L) * 0.5, oy, c.z + (dz / L) * 0.5, tx / TL, ty / TL, tz / TL, false, null);
          if (P.inVehicle && h.type === 'veh' && h.target === P.vehicle) P.vehicle.damage(3);
        }
      }
      if (spd) { c.x += Math.sin(c.yaw) * spd * dt; c.z += Math.cos(c.yaw) * spd * dt; }
      c.speed = Math.abs(spd);
      resolveCircle(g.world, c, 0.35, 0.5, res);
    }
    // Spawns según estrellas
    const want = [0, 1, 2, 3, 4, 5][lv];
    const alive = this.units.filter((u) => !u.veh.dead && !u.dismounted).length;
    this.spawnT -= dt;
    if (lv > 0 && alive < want && this.spawnT <= 0) { this.spawnT = 3.5 - lv * 0.4; this.spawnUnit(); }
    this.updateHeli(dt, lv >= 4);
    // Sirena: volumen por la patrulla más cercana con torreta encendida
    let near = Infinity;
    for (const u of this.units) if (u.veh.sirenOn) near = Math.min(near, Math.hypot(u.veh.x - p.x, u.veh.z - p.z));
    g.audio.setSiren(lv ? clamp(1 - near / 160, 0, 1) : 0, dt);
  }

  updateHeli(dt, want) {
    const h = this.heli, p = this.g.player.pos();
    if (want && !this.heliActive) { this.heliActive = true; h.visible = true; h.position.set(p.x + 150, 70, p.z + 150); }
    if (!want && this.heliActive) { h.position.y += dt * 12; if (h.position.y > 140) { this.heliActive = false; h.visible = false; } }
    if (!this.heliActive) return;
    this.rotor.rotation.y += dt * 30;
    if (want) {
      h.position.x = damp(h.position.x, p.x - 8, 0.6, dt);
      h.position.z = damp(h.position.z, p.z - 8, 0.6, dt);
      h.position.y = damp(h.position.y, groundY(p.x, p.z) + 45, 1, dt);
      h.rotation.y = dampAngle(h.rotation.y, Math.atan2(p.x - h.position.x, p.z - h.position.z), 2, dt);
      h.rotation.x = 0.12;
      if (this.g.wanted.level >= 5) {
        this.heliShootT -= dt;
        if (this.heliShootT <= 0) {
          this.heliShootT = 0.9;
          const o = h.position, tx = p.x + (r() - 0.5) * 6 - o.x, ty = groundY(p.x, p.z) + 1 - (o.y - 1.5), tz = p.z + (r() - 0.5) * 6 - o.z, L = Math.hypot(tx, ty, tz);
          this.g.combat.fire(null, { rate: 0, dmg: 9, spread: 0.02, range: 120 }, o.x, o.y - 1.5, o.z, tx / L, ty / L, tz / L, false, null);
        }
      }
    }
  }

  clearAll() {
    for (const u of this.units) this.g.removeVehicle(u.veh);
    this.units.length = 0; this.cops.length = 0;
    this.heliActive = false; this.heli.visible = false;
  }
}

// Recompensas en el suelo: dinero, salud, blindaje, armas.
export class Pickups {
  constructor(game) {
    this.g = game; this.items = [];
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, emissive: 0x222222 }), 64);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.setColorAt(0, new THREE.Color());
    game.scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1); this.c = new THREE.Color(); this.t = 0;
    this.COL = { cash: 0x66bb6a, health: 0xef5350, armor: 0x42a5f5, subfusil: 0xffa726, pistola: 0xffee58 };
  }
  drop(x, z, kind, amount = 0, life = 40, respawn = 0) { if (this.items.length < 64) this.items.push({ x, z, kind, amount, life, respawn, hidden: 0, ox: x, oz: z }); }
  update(dt) {
    this.t += dt;
    const P = this.g.player, p = P.pos();
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.hidden > 0) { it.hidden -= dt; continue; }
      if (!it.respawn) { it.life -= dt; if (it.life <= 0) { this.items.splice(i, 1); continue; } }
      if (!P.inVehicle && (it.x - p.x) ** 2 + (it.z - p.z) ** 2 < 1.8 && P.collect(it)) {
        this.g.audio.pickup();
        if (it.respawn) it.hidden = it.respawn; else { this.items.splice(i, 1); }
        continue;
      }
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), this.t * 2 + i);
      this.m.compose(this.v.set(it.x, groundY(it.x, it.z) + 0.9 + Math.sin(this.t * 3 + i) * 0.15, it.z), this.q, this.s);
      this.mesh.setMatrixAt(n, this.m); this.mesh.setColorAt(n, this.c.set(this.COL[it.kind] || 0xffffff)); n++;
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
