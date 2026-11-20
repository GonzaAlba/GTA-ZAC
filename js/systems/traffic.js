// IA de conducción sobre el grafo de OSM + gestor de tráfico civil con pool.
import { Vehicle } from '../entities/vehicle.js';
import { Character, randomLook } from '../entities/characters.js';
import { clamp, rng, wrapAngle } from '../util.js';

const r = rng(4242);

export class DriverAI {
  constructor(game, v, mode = 'cruise') {
    this.g = game; this.v = v; this.mode = mode;
    this.a = -1; this.b = -1; this.next = -1;
    this.path = []; this.pi = 0;
    this.cruise = 9 + r() * 4;
    this.stuck = 0; this.reverseT = 0; this.honkT = 0; this.repath = 0;
    this.target = null; // {x,z} objetivo directo
    this.aggr = 0; // agresividad (policía / persecuciones)
    this.done = false;
    this.blockT = 0; this.overtake = 0;
  }
  laneOff(a, b) { const w = this.g.world.graph.edgeWidth(a, b), o = w < 6 ? 0.6 : w * 0.25; return this.overtake > 0 ? -o : o; }

  place(a, b, t = 0.3) {
    const G = this.g.world.graph; this.a = a; this.b = b;
    const dx = G.x[b] - G.x[a], dz = G.z[b] - G.z[a], L = Math.hypot(dx, dz) || 1, off = this.laneOff(a, b);
    this.v.x = this.v.px = G.x[a] + dx * t - (dz / L) * off;
    this.v.z = this.v.pz = G.z[a] + dz * t + (dx / L) * off;
    this.v.yaw = this.v.pyaw = Math.atan2(dx, dz);
    this.next = this.choose(a, b);
  }

  // Arranca la navegación desde la posición actual del vehículo (nodo más cercano hacia adelante).
  attach() {
    const G = this.g.world.graph, v = this.v;
    const n = G.nearest(v.x, v.z, true);
    if (n < 0) return;
    let best = -1, bd = -2;
    for (const e of G.adj[n]) if (e.drive) {
      const dx = G.x[e.to] - G.x[n], dz = G.z[e.to] - G.z[n], L = Math.hypot(dx, dz) || 1;
      const d = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / L;
      if (d > bd) { bd = d; best = e.to; }
    }
    if (best < 0) return;
    this.a = n; this.b = best; this.next = this.choose(n, best);
  }

  setPath(nodes, target) {
    this.mode = 'path'; this.path = nodes.slice(); this.target = target; this.done = false;
    if (nodes.length >= 2) { this.a = nodes[0]; this.b = nodes[1]; this.pi = 1; this.next = this.choose(this.a, this.b); }
    else { this.a = this.b = -1; }
  }

  choose(a, b) {
    const G = this.g.world.graph;
    if (this.mode === 'path') return this.pi + 1 < this.path.length ? this.path[this.pi + 1] : -1;
    if (this.mode === 'flee' && this.g.player) {
      const p = this.g.player.pos();
      let best = -1, bd = -1;
      for (const e of G.adj[b]) if (e.drive && e.to !== a) {
        const d = (G.x[e.to] - p.x) ** 2 + (G.z[e.to] - p.z) ** 2 + r() * 400;
        if (d > bd) { bd = d; best = e.to; }
      }
      return best < 0 ? a : best;
    }
    return G.randomNext(a, b, true, r);
  }

  advance() {
    this.a = this.b; this.b = this.next;
    if (this.mode === 'path') this.pi++;
    this.next = this.b >= 0 ? this.choose(this.a, this.b) : -1;
  }

  update(dt) {
    const v = this.v, G = this.g.world.graph, inp = v.input;
    inp.handbrake = false;
    if (v.dead) return;
    const sp = v.speed, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -fz, rz = fx;
    let tx, tz, desired = this.aggr ? v.spec.maxV * (0.45 + 0.3 * this.aggr) : this.cruise;

    const direct = this.target && (this.a < 0 || this.b < 0 || this.mode === 'direct');
    if (direct) {
      tx = this.target.x; tz = this.target.z;
      const d = Math.hypot(tx - v.x, tz - v.z);
      desired = this.aggr ? v.spec.maxV * 0.85 : clamp(d * 0.5, 0, this.cruise);
      if (!this.aggr && d < 4) { desired = 0; this.done = true; }
    } else if (this.a >= 0 && this.b >= 0) {
      const ax = G.x[this.a], az = G.z[this.a], bx = G.x[this.b], bz = G.z[this.b];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      const off = this.laneOff(this.a, this.b);
      const t = ((v.x - ax) * ux + (v.z - az) * uz);
      if (t > L - 3) {
        if (this.next < 0) { if (this.target) this.mode = 'direct'; else this.done = true; desired = 0; }
        else { this.advance(); return; }
      }
      const look = 5 + sp * 0.45;
      let s = t + look;
      if (s <= L || this.next < 0) {
        s = Math.min(s, L);
        tx = ax + ux * s - uz * off; tz = az + uz * s + ux * off;
      } else {
        const cx = G.x[this.next], cz = G.z[this.next];
        const ex = cx - bx, ez = cz - bz, L2 = Math.hypot(ex, ez) || 1, off2 = this.laneOff(this.b, this.next);
        const s2 = Math.min(s - L, L2);
        tx = bx + (ex / L2) * s2 - (ez / L2) * off2; tz = bz + (ez / L2) * s2 + (ex / L2) * off2;
      }
      // Frenar antes de curvas cerradas
      if (this.next >= 0 && L - t < 22) {
        const ex = G.x[this.next] - bx, ez = G.z[this.next] - bz, L2 = Math.hypot(ex, ez) || 1;
        const turn = Math.acos(clamp((ux * ex + uz * ez) / L2, -1, 1));
        if (turn > 0.45) desired = Math.min(desired, this.aggr ? 10 + (1 - turn / Math.PI) * 4 : 6.5);
      }
    } else { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return; }

    // Evitar choques: vehículos y peatones al frente
    const ahead = 9 + sp * 1.1;
    let blockedByCar = false;
    for (const o of this.g.vehicles) {
      if (o === v || (this.overtake > 0 && o.speed < 1)) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (Math.abs(dx) > ahead || Math.abs(dz) > ahead) continue;
      const lz = dx * fx + dz * fz, lx = dx * rx + dz * rz;
      if (lz > 0 && lz < ahead && Math.abs(lx) < 2.3) { desired = Math.min(desired, Math.max(0, (lz - 6) * 0.7)); if (o.speed < 1) blockedByCar = true; }
    }
    if (!this.aggr) {
      for (const list of this.g.charLists) for (const c of list) {
        if (!c.onFoot || !c.alive) continue;
        const dx = c.x - v.x, dz = c.z - v.z;
        if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
        const lz = dx * fx + dz * fz, lx = dx * rx + dz * rz;
        if (lz > 0 && lz < 4 + sp && Math.abs(lx) < 1.8) {
          desired = 0;
          if (c === this.g.player?.ch && this.honkT <= 0 && sp < 1) { this.honkT = 3; this.g.audio.horn(); }
        }
      }
    }
    this.honkT -= dt;
    // Rebasar obstáculos detenidos (autos estacionados, choques) usando el carril contrario
    if (this.overtake > 0) this.overtake -= dt;
    if (blockedByCar && sp < 1.5) { this.blockT += dt; if (this.blockT > (this.aggr ? 0.6 : 1.4)) { this.overtake = 3.5; this.blockT = 0; } }
    else this.blockT = 0;

    // Dirección (pure pursuit)
    const ddx = tx - v.x, ddz = tz - v.z;
    const lx = ddx * rx + ddz * rz, lz = ddx * fx + ddz * fz;
    let steer = clamp(Math.atan2(lx, Math.max(lz, 0.1)) * 1.9, -1, 1);
    if (lz < 0 && this.aggr) steer = Math.sign(lx) || 1;

    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = 0; inp.brake = 1; inp.steer = -steer;
      return;
    }
    if (sp < desired) { inp.throttle = clamp((desired - sp) * 0.35 + 0.2, 0, 1); inp.brake = 0; }
    else { inp.throttle = 0; inp.brake = clamp((sp - desired) * 0.25, 0, 1); }
    if (desired < 0.3 && sp < 0.6) { inp.throttle = 0; inp.brake = 0.4; }
    inp.steer = steer;
    // Atascado contra algo: reversa breve
    if (inp.throttle > 0.3 && sp < 0.8) { this.stuck += dt; if (this.stuck > 1.8) { this.stuck = 0; this.reverseT = 1.1; } }
    else this.stuck = 0;
  }
}

export class Traffic {
  constructor(game) { this.g = game; this.target = 18; this.parkedTarget = 6; this.spawnT = 0; }

  spawnPoint(minD, maxD) {
    const G = this.g.world.graph, p = this.g.player.pos(), cam = this.g.camera;
    for (let tries = 0; tries < 40; tries++) {
      const n = G.driveNodes[Math.floor(r() * G.driveNodes.length)];
      const d = Math.hypot(G.x[n] - p.x, G.z[n] - p.z);
      if (d < minD || d > maxD) continue;
      if (d < 160 && this.g.inView(G.x[n], G.z[n])) continue;
      const opts = G.adj[n].filter((e) => e.drive);
      if (!opts.length) continue;
      const e = opts[Math.floor(r() * opts.length)];
      let clear = true;
      for (const v of this.g.vehicles) if ((v.x - G.x[n]) ** 2 + (v.z - G.z[n]) ** 2 < 144) { clear = false; break; }
      if (clear) return [n, e.to, e.len];
    }
    return null;
  }

  update(dt) {
    const g = this.g, p = g.player.pos();
    let moving = 0, parked = 0;
    for (let i = g.vehicles.length - 1; i >= 0; i--) {
      const v = g.vehicles[i];
      if (v.owner !== 'traffic' && v.owner !== 'parked') continue;
      const d2 = (v.x - p.x) ** 2 + (v.z - p.z) ** 2;
      if (d2 > 330 * 330 || (d2 > 200 * 200 && !g.inView(v.x, v.z)) || (v.dead && d2 > 90 * 90)) { g.removeVehicle(v); continue; }
      if (v.owner === 'traffic') moving++; else parked++;
      if (v.ai && v.driver) v.ai.update(dt);
      else if (!v.driver) { v.input.throttle = 0; v.input.brake = 1; v.input.steer = 0; }
    }
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.25;
    if (moving < this.target) {
      const sp = this.spawnPoint(70, 260);
      if (sp) {
        const roll = r();
        const type = roll < 0.32 ? 'compacto' : roll < 0.52 ? 'taxi' : roll < 0.72 ? 'pickup' : roll < 0.84 ? 'combi' : roll < 0.93 ? 'deportivo' : roll < 0.97 ? 'camion' : 'policia';
        const v = new Vehicle(type === 'policia' ? 'compacto' : type, 0, 0, 0);
        v.owner = 'traffic';
        v.driver = new Character(randomLook(r)); v.driver.onFoot = false; v.driver.vehicle = v;
        v.ai = new DriverAI(g, v, 'cruise');
        v.ai.place(sp[0], sp[1], Math.min(0.5, 6 / sp[2]));
        g.addVehicle(v);
      }
    } else if (parked < this.parkedTarget) {
      const sp = this.spawnPoint(50, 200);
      if (sp) {
        const G = g.world.graph, [a, b] = sp;
        const dx = G.x[b] - G.x[a], dz = G.z[b] - G.z[a], L = Math.hypot(dx, dz) || 1, w = G.edgeWidth(a, b);
        if (L > 14 && w >= 7.5) {
          const t = 0.5, off = w / 2 - 0.85;
          const types = ['compacto', 'pickup', 'taxi', 'deportivo', 'compacto'];
          const v = new Vehicle(types[Math.floor(r() * types.length)], G.x[a] + dx * t - (dz / L) * off, G.z[a] + dz * t + (dx / L) * off, Math.atan2(dx, dz));
          v.owner = 'parked';
          g.addVehicle(v);
        }
      }
    }
  }
}
