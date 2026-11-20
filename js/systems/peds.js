// Peatones: caminan por banquetas siguiendo el grafo, huyen ante el peligro.
import { Character, randomLook, stepCharacterBody } from '../entities/characters.js';
import { resolveCircle } from './physics.js';
import { rng, dampAngle } from '../util.js';

const r = rng(9001);
const res = { nx: 0, nz: 0, impact: 0, hit: false };

export class Peds {
  constructor(game) { this.g = game; this.list = []; this.target = 34; this.spawnT = 0; }

  sideOff(a, b, side) { return (this.g.world.graph.edgeWidth(a, b) / 2 + 1.0) * side; }

  spawn() {
    const g = this.g, G = g.world.graph, p = g.player.pos();
    for (let t = 0; t < 25; t++) {
      const n = Math.floor(r() * G.n);
      const d = Math.hypot(G.x[n] - p.x, G.z[n] - p.z);
      if (d < 35 || d > 140) continue;
      if (d < 90 && g.inView(G.x[n], G.z[n])) continue;
      const e = G.adj[n][Math.floor(r() * G.adj[n].length)];
      if (!e) continue;
      const c = new Character(randomLook(r));
      c.kind = 'ped'; c.a = n; c.b = e.to; c.side = r() < 0.5 ? 1 : -1;
      c.walk = 1.1 + r() * 0.6; c.flee = 0; c.threat = null; c.bodyT = 0;
      const dx = G.x[e.to] - G.x[n], dz = G.z[e.to] - G.z[n], L = Math.hypot(dx, dz) || 1, off = this.sideOff(n, e.to, c.side);
      const t0 = r();
      c.x = c.px = G.x[n] + dx * t0 - (dz / L) * off; c.z = c.pz = G.z[n] + dz * t0 + (dx / L) * off;
      c.yaw = c.pyaw = Math.atan2(dx, dz);
      this.list.push(c);
      return;
    }
  }

  panic(x, z, radius, dur = 7) {
    for (const c of this.list) {
      if (!c.alive || c.isDown) continue;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < radius * radius) { c.flee = dur * (0.7 + r() * 0.6); c.threat = { x, z }; }
    }
  }

  update(dt) {
    const g = this.g, G = g.world.graph, p = g.player.pos();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const d2 = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d2 > 170 * 170 || (!c.alive && (c.bodyT += dt) > 25)) { this.list.splice(i, 1); continue; }
      if (!stepCharacterBody(c, dt)) continue;
      let tx, tz, spd;
      if (c.flee > 0) {
        c.flee -= dt;
        const dx = c.x - c.threat.x, dz = c.z - c.threat.z, L = Math.hypot(dx, dz) || 1;
        tx = c.x + (dx / L) * 5; tz = c.z + (dz / L) * 5; spd = 5.2;
        c.pose = r() < 0.002 ? 'hands' : c.pose;
        if (c.flee <= 0) { const n = G.nearest(c.x, c.z, false); if (n >= 0) { c.a = c.b = n; } c.pose = 'walk'; }
      } else {
        if (c.a === c.b) { // reengancharse a la red
          const e = G.adj[c.a][Math.floor(r() * G.adj[c.a].length)]; if (e) c.b = e.to;
        }
        const ax = G.x[c.a], az = G.z[c.a], bx = G.x[c.b], bz = G.z[c.b];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, off = this.sideOff(c.a, c.b, c.side);
        tx = bx - (dz / L) * off; tz = bz + (dx / L) * off;
        spd = c.walk;
        if ((tx - c.x) ** 2 + (tz - c.z) ** 2 < 2.2) {
          const nb = G.randomNext(c.a, c.b, false, r);
          c.a = c.b; c.b = nb;
        }
      }
      const dx = tx - c.x, dz = tz - c.z, L = Math.hypot(dx, dz);
      if (L > 0.05) {
        c.yaw = dampAngle(c.yaw, Math.atan2(dx, dz), 8, dt);
        c.x += Math.sin(c.yaw) * spd * dt; c.z += Math.cos(c.yaw) * spd * dt;
        c.speed = spd;
      } else c.speed = 0;
      if (c.flee > 0) resolveCircle(g.world, c, 0.35, 0.5, res);
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.list.length < this.target) { this.spawnT = 0.15; this.spawn(); }
  }
}
