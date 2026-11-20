// Protagonistas controlados con el control Xbox: a pie, apuntado asistido, autos y cambio de personaje.
import { Character, stepCharacterBody } from './characters.js';
import { BTN } from '../input/gamepad.js';
import { WEAPONS } from '../systems/combat.js';
import { resolveCircle } from '../systems/physics.js';
import { clamp, dampAngle, wrapAngle } from '../util.js';

const res = { nx: 0, nz: 0, impact: 0, hit: false };

export const HEROES = [
  { name: 'Citlali', look: { skin: 0xc68642, shirt: 0xd81b60, pants: 0x263238, hair: 0x1b1b1b, hat: 0, scale: 0.97 } },
  { name: 'Mateo', look: { skin: 0xe0ac69, shirt: 0x00897b, pants: 0x3e2723, hair: 0x3e2723, hat: 1, hatColor: 0xf5deb3, scale: 1.05 } },
];

export class Player {
  constructor(game, x, z) {
    this.g = game;
    this.heroes = HEROES.map((h, i) => {
      const ch = new Character(h.look, x + i * 3, z, 0);
      ch.isPlayer = true; ch.kind = 'hero'; ch.name = h.name;
      return { name: h.name, ch, vehicle: null, hp: 100, armor: 0, ammo: WEAPONS.map((w) => w.start || 0), weapon: 0 };
    });
    this.active = 0;
    this.fireT = 0; this.dodgeT = 0; this.dodgeX = 0; this.dodgeZ = 0;
    this.aimTarget = null; this.aiming = false;
    this.dead = false; this.lockT = 0;
    this._p = { x, z };
    this.aimDir = { x: 0, y: 0, z: 1 };
  }
  get hero() { return this.heroes[this.active]; }
  get ch() { return this.hero.ch; }
  get vehicle() { return this.hero.vehicle; }
  get inVehicle() { return !!this.hero.vehicle; }
  get weapon() { return WEAPONS[this.hero.weapon]; }
  pos() { const v = this.hero.vehicle, o = this._p; if (v) { o.x = v.x; o.z = v.z; } else { o.x = this.ch.x; o.z = this.ch.z; } return o; }
  // Todos los cuerpos de protagonistas que deben dibujarse/colisionar
  bodies() { return this.heroes.map((h) => h.ch); }

  hurt(dmg) {
    const h = this.hero;
    if (this.dead) return;
    const a = Math.min(h.armor, dmg * 0.7); h.armor -= a; dmg -= a;
    h.hp -= dmg;
    this.g.hud.hit();
    this.g.input.rumble(0.4, 0.6, 120);
    if (h.hp <= 0) { h.hp = 0; this.die('wasted'); }
  }
  busted() { if (!this.dead) this.die('busted'); }
  die(kind) {
    this.dead = true;
    if (kind === 'wasted' && !this.inVehicle) { this.ch.alive = false; this.ch.downT = 1; }
    this.g.onPlayerDown(kind);
  }
  respawn(x, z) {
    const h = this.hero;
    if (h.vehicle) this.exitVehicle(true);
    const c = this.ch;
    c.x = c.px = x; c.z = c.pz = z; c.y = 0; c.alive = true; c.downT = 0; c.tilt = 0; c.hp = 100; c.vx = c.vz = 0;
    h.hp = 100; this.dead = false;
  }

  collect(it) {
    const h = this.hero, g = this.g;
    if (it.kind === 'cash') { g.addMoney(it.amount); return true; }
    if (it.kind === 'health') { if (h.hp >= 100) return false; h.hp = 100; return true; }
    if (it.kind === 'armor') { if (h.armor >= 100) return false; h.armor = 100; return true; }
    const wi = WEAPONS.findIndex((w) => w.id === it.kind);
    if (wi > 0) { h.ammo[wi] += it.amount || 60; g.hud.notify(`+${it.amount || 60} ${WEAPONS[wi].name}`); return true; }
    return false;
  }

  switchHero(dir) {
    const g = this.g;
    if (g.wanted.level > 0 || g.missions.active) { g.hud.notify('No puedes cambiar de personaje ahora'); return; }
    const cur = this.hero;
    if (cur.vehicle) { cur.vehicle.input.throttle = 0; cur.vehicle.input.brake = 1; }
    this.active = (this.active + dir + this.heroes.length) % this.heroes.length;
    g.hud.fade(0.7);
    g.hud.notify(`Ahora juegas con ${this.hero.name}`);
    g.cam.snap = true;
  }

  // ------------------- Bucle de control -------------------
  update(dt, I, cam) {
    if (this.dead) { if (!this.inVehicle) stepCharacterBody(this.ch, dt); return; }
    // El protagonista inactivo sólo aplica física básica
    for (const h of this.heroes) if (h !== this.hero && !h.vehicle) stepCharacterBody(h.ch, dt);
    if (I.pressed(BTN.LEFT)) this.switchHero(-1);
    if (I.pressed(BTN.RIGHT)) this.switchHero(1);
    if (this.inVehicle) this.updateDriving(dt, I);
    else this.updateOnFoot(dt, I, cam);
  }

  updateDriving(dt, I) {
    const v = this.vehicle, g = this.g;
    v.input.throttle = I.rt; v.input.brake = I.lt; v.input.steer = I.lx; v.input.handbrake = I.held(BTN.A);
    if (I.pressed(BTN.X)) g.audio.horn();
    if (I.pressed(BTN.LB) || I.pressed(BTN.RB)) {
      const st = g.audio.nextStation(I.pressed(BTN.RB) ? 1 : -1);
      g.hud.radio(st);
    }
    if (I.pressed(BTN.Y)) this.exitVehicle(false);
    if (v.dead && v.burn === 0 && this.inVehicle) this.exitVehicle(true);
  }

  updateOnFoot(dt, I, cam) {
    const ch = this.ch, g = this.g;
    if (!stepCharacterBody(ch, dt)) { resolveCircle(g.world, ch, 0.35, 0.5, res); return; }
    const cy = cam.yaw, fx = Math.sin(cy), fz = Math.cos(cy), rx = -fz, rz = fx;
    const lx = I.lx, ly = I.ly, mag = Math.min(1, Math.hypot(lx, ly));
    let dx = fx * -ly + rx * lx, dz = fz * -ly + rz * lx;
    const dl = Math.hypot(dx, dz); if (dl > 0) { dx /= dl; dz /= dl; }

    // Apuntar con LT (bloqueo de objetivo asistido para control)
    const wasAiming = this.aiming;
    this.aiming = I.lt > 0.3 && !this.weapon.melee;
    if (this.aiming && !wasAiming) this.aimTarget = this.findTarget(cam);
    if (!this.aiming) this.aimTarget = null;
    if (this.aimTarget && (!this.aimTarget.alive || Math.hypot(this.aimTarget.x - ch.x, this.aimTarget.z - ch.z) > 55)) this.aimTarget = this.findTarget(cam);
    if (this.aiming && Math.abs(I.rx) > 0.7) { this.lockT -= dt; if (this.lockT <= 0) { this.aimTarget = this.findTarget(cam, Math.sign(I.rx)); this.lockT = 0.4; } }

    let speed = 0;
    const sprint = I.held(BTN.A) && I.heldTime[BTN.A] > 0.2;
    if (mag > 0.05) speed = this.aiming ? 2.4 * mag : sprint ? 7.4 : mag > 0.6 ? 4.6 : 2.1;
    if (I.tapped(BTN.A) && ch.y === 0) ch.vy = 6.2;
    if (I.pressed(BTN.B) && this.dodgeT <= 0) { this.dodgeT = 0.35; this.dodgeX = mag > 0.1 ? dx : -Math.sin(ch.yaw); this.dodgeZ = mag > 0.1 ? dz : -Math.cos(ch.yaw); }
    if (this.dodgeT > 0) { this.dodgeT -= dt; ch.x += this.dodgeX * 8.5 * dt; ch.z += this.dodgeZ * 8.5 * dt; ch.tilt = 0.5; }
    ch.x += dx * speed * dt; ch.z += dz * speed * dt;
    ch.speed = speed;

    // Orientación
    if (this.aiming) {
      const t = this.aimTarget;
      const ay = t ? Math.atan2(t.x - ch.x, t.z - ch.z) : cy;
      ch.yaw = dampAngle(ch.yaw, ay, 18, dt);
      ch.pose = 'aim';
    } else {
      if (speed > 0) ch.yaw = dampAngle(ch.yaw, Math.atan2(dx, dz), 12, dt);
      if (ch.pose === 'aim') ch.pose = 'walk';
    }

    // Armas
    if (I.pressed(BTN.LB) || I.pressed(BTN.RB)) this.cycleWeapon(I.pressed(BTN.RB) ? 1 : -1);
    this.fireT -= dt;
    if (I.pressed(BTN.X) || (this.weapon.melee && I.pressed(BTN.RT))) this.punch();
    else if (!this.weapon.melee && I.rt > 0.5 && this.fireT <= 0) this.shoot(cam);

    if (I.pressed(BTN.Y)) this.tryEnter();
    resolveCircle(g.world, ch, 0.35, 0.5, res);
    // Empujar a otros peatones (sin atravesarlos)
    for (const c of g.peds.list) {
      const ddx = c.x - ch.x, ddz = c.z - ch.z, d2 = ddx * ddx + ddz * ddz;
      if (d2 < 0.5 && d2 > 1e-4) { const d = Math.sqrt(d2), p = (0.71 - d) * 0.5; c.x += (ddx / d) * p; c.z += (ddz / d) * p; ch.x -= (ddx / d) * p; ch.z -= (ddz / d) * p; }
    }
  }

  findTarget(cam, side = 0) {
    const ch = this.ch, g = this.g;
    let best = null, bs = Infinity;
    const cy = cam.yaw, cur = this.aimTarget;
    for (const list of g.charLists) for (const c of list) {
      if (c.isPlayer || !c.alive || !c.onFoot) continue;
      const dx = c.x - ch.x, dz = c.z - ch.z, d = Math.hypot(dx, dz);
      if (d > 50 || d < 0.5) continue;
      const ang = wrapAngle(Math.atan2(dx, dz) - cy);
      if (side) { if (c === cur || Math.sign(-ang) !== side) continue; }
      else if (Math.abs(ang) > 0.45) continue;
      if (g.world.segmentBlocked(ch.x, ch.z, c.x, c.z, 1.4)) continue;
      const score = Math.abs(ang) * 30 + d * 0.6 - (c.kind === 'cop' || c.hostile ? 15 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    return best || (side ? cur : null);
  }

  cycleWeapon(dir) {
    const h = this.hero;
    for (let k = 1; k <= WEAPONS.length; k++) {
      const i = (h.weapon + dir * k + WEAPONS.length * 3) % WEAPONS.length;
      if (WEAPONS[i].melee || h.ammo[i] > 0) { h.weapon = i; break; }
    }
    this.g.audio.click();
  }

  punch() {
    const ch = this.ch, g = this.g;
    if (ch.punchT > 0) return;
    ch.pose = 'punch'; ch.punchT = 0.3;
    const fx = Math.sin(ch.yaw), fz = Math.cos(ch.yaw);
    for (const list of g.charLists) for (const c of list) {
      if (c.isPlayer || !c.alive || !c.onFoot) continue;
      const dx = c.x - ch.x, dz = c.z - ch.z, d = Math.hypot(dx, dz);
      if (d < 1.7 && (dx * fx + dz * fz) / (d || 1) > 0.4) {
        g.audio.punch(); g.input.rumble(0.3, 0.3, 80);
        c.knock(fx * 4, fz * 4, 0);
        g.combat.damageChar(c, 22, fx * 4, fz * 4, true, ch);
        g.wanted.report(c.kind === 'cop' ? 'shootCop' : 'punch', c.x, c.z);
        break;
      }
    }
  }

  shoot(cam) {
    const h = this.hero, w = this.weapon, ch = this.ch, g = this.g;
    if (h.ammo[h.weapon] <= 0) { this.cycleWeapon(-1); return; }
    this.fireT = w.rate; h.ammo[h.weapon]--;
    const ox = ch.x + Math.sin(ch.yaw) * 0.6, oz = ch.z + Math.cos(ch.yaw) * 0.6, oy = 1.45;
    let dx, dy, dz;
    const t = this.aimTarget;
    if (t) { dx = t.x - ox; dz = t.z - oz; dy = (t.isDown ? 0.4 : 1.15) - oy; }
    else if (this.aiming) { dx = Math.sin(cam.yaw) * Math.cos(cam.pitch); dz = Math.cos(cam.yaw) * Math.cos(cam.pitch); dy = -Math.sin(cam.pitch) + 0.12; }
    else { dx = Math.sin(ch.yaw); dz = Math.cos(ch.yaw); dy = 0; }
    const L = Math.hypot(dx, dy, dz);
    g.combat.fire(ch, w, ox, oy, oz, dx / L, dy / L, dz / L, true, null);
    g.input.rumble(0.15, 0.35, 60);
    if (!this.aiming) { ch.pose = 'aim'; ch.punchT = 0.25; }
  }

  tryEnter() {
    const ch = this.ch, g = this.g;
    let best = null, bd = Infinity;
    for (const v of g.vehicles) {
      if (v.dead || v.locked) continue;
      const d = Math.hypot(v.x - ch.x, v.z - ch.z) - v.spec.len / 2;
      if (d < 2.6 && d < bd) { bd = d; best = v; }
    }
    if (!best) return;
    const v = best;
    if (v.driver && !v.driver.isPlayer) {
      const d = v.driver;
      // Sacar al conductor (robo de auto)
      const rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
      d.onFoot = true; d.vehicle = null; d.x = d.px = v.x - rx * 2; d.z = d.pz = v.z - rz * 2;
      d.kind = d.kind || 'ped';
      if (d.kind === 'cop') { if (!g.police.cops.includes(d)) g.police.cops.push(d); g.wanted.report('shootCop', v.x, v.z); }
      else { d.flee = 8; d.threat = { x: ch.x, z: ch.z }; d.a = d.b = g.world.graph.nearest(d.x, d.z, false); d.side = 1; d.walk = 1.3; d.bodyT = 0; d.knock(-rx * 3, -rz * 3, 0); g.peds.list.push(d); g.wanted.report('carjack', v.x, v.z); }
      g.audio.punch();
    } else if (v.owner === 'parked' && Math.random() < 0.5) g.wanted.report('steal', v.x, v.z);
    v.driver = ch; v.ai = null;
    if (v.owner !== 'mission') v.owner = 'player';
    ch.onFoot = false; ch.vehicle = v; this.hero.vehicle = v;
    this.aiming = false; this.aimTarget = null;
    g.audio.setRadio(true);
    g.hud.notify(v.spec.name);
    if (g.missions) g.missions.onEnterVehicle(v);
  }

  exitVehicle(force) {
    const h = this.hero, v = h.vehicle, ch = this.ch, g = this.g;
    if (!v) return;
    const sp = v.speed;
    const lx = Math.cos(v.yaw), lz = -Math.sin(v.yaw);
    ch.x = ch.px = v.x + lx * (v.spec.wid / 2 + 0.7); ch.z = ch.pz = v.z + lz * (v.spec.wid / 2 + 0.7);
    ch.yaw = ch.pyaw = v.yaw; ch.y = 0;
    ch.onFoot = true; ch.vehicle = null; h.vehicle = null;
    v.driver = null; v.input.throttle = 0; v.input.brake = sp > 8 ? 0 : 1; v.input.steer = 0; v.input.handbrake = false;
    if (v.owner === 'player') v.owner = 'parked';
    if (sp > 8 && !force) ch.knock(v.vx * 0.6 + lx * 3, v.vz * 0.6 + lz * 3, 0), (this.hurt(Math.min(25, sp)));
    resolveCircle(g.world, ch, 0.35, 0.5, res);
    g.audio.setRadio(false); g.audio.setEngine(false, 0, 0);
  }
}
