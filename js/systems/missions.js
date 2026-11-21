// Motor de misiones dirigido por datos + las 6 misiones de la historia.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { Character, randomLook } from '../entities/characters.js';
import { DriverAI } from './traffic.js';
import { fmtMoney } from '../util.js';
import { groundY } from '../world/terrain.js';

// ---------------- Historia ----------------
export const STORY = [
  {
    id: 'm1', title: 'Manzanas a Domicilio', giver: 'Mateo', start: 'Mercado', reward: 800,
    steps: [
      { say: [['Mateo', 'Don Chuy quiere sus cajas de manzana antes de que cierre la bodega.'], ['Citlali', 'Fácil. Lo difícil es no comérnoslas en el camino.']] },
      { spawn: { truck: { type: 'pickup', at: 'Mercado', paint: 0x8d6e63, survive: true } } },
      { type: 'enter', vehicle: 'truck', text: 'Súbete a la ~y~camioneta de manzanas~w~.' },
      { type: 'deliver', at: 'Bodega:road', vehicle: 'truck', time: 160, text: 'Lleva las manzanas a la ~y~Bodega Don Chuy~w~.' },
    ],
  },
  {
    id: 'm2', title: 'La Hidalgo a Toda Velocidad', giver: 'Citlali', start: 'Reloj Floral', reward: 1500,
    steps: [
      { say: [['Citlali', 'El Pelón nos debe desde la feria de la manzana.'], ['Mateo', 'Y ya lo vieron cerca de la parroquia en su carrito deportivo...']] },
      { spawn: { target: { type: 'deportivo', at: 'Parroquia', paint: 0xff7043, driver: 'thug', ai: 'cruise', hostileTarget: true } } },
      { type: 'inVehicle', text: 'Consigue un ~b~vehículo~w~.' },
      { type: 'chase', vehicle: 'target', text: 'Detén al ~r~Pelón~w~: ¡choca su auto hasta inutilizarlo!' },
      { type: 'collect', text: 'Recoge el ~g~dinero~w~ que tiró el Pelón.' },
    ],
  },
  {
    id: 'm3', title: 'Sidra Robada', giver: 'Mateo', start: 'Sidrería', reward: 2500,
    steps: [
      { say: [['Mateo', 'Ese camión lleva la mejor sidra de la sierra.'], ['Citlali', 'Y el taller de Lalo paga bien por ella... sin preguntas.']] },
      { spawn: { truck: { type: 'camion', at: 'Sidrería', survive: true } } },
      { type: 'enter', vehicle: 'truck', text: 'Roba el ~y~camión de sidra~w~.' },
      { wanted: 2 },
      { type: 'lose', vehicle: 'truck', text: 'Pierde a la ~b~policía~w~ sin perder el camión.' },
      { type: 'deliver', at: 'Taller:road', vehicle: 'truck', text: 'Lleva el camión al ~y~Taller Pinta y Listo~w~.' },
    ],
  },
  {
    id: 'm4', title: 'Carrera a la Barranca', giver: 'Citlali', start: 'Palacio Municipal', reward: 3000,
    steps: [
      { say: [['Citlali', 'Los de Chignahuapan dicen que nadie les gana bajando a la cascada.'], ['Mateo', 'Pues hoy aprenden.']] },
      { spawn: { car: { type: 'deportivo', at: 'Palacio Municipal', paint: 0xfdd835 } } },
      { type: 'enter', vehicle: 'car', text: 'Súbete a tu ~y~Neblina GT~w~.' },
      { type: 'race', via: ['Mercado', 'Clínica', 'Casa', 'Cascada'], rivals: 2, text: 'Gana la carrera a la ~y~Cascada~w~.' },
    ],
  },
  {
    id: 'm5', title: 'Neblina en el Mirador', giver: 'Mateo', start: 'Casa', reward: 4000,
    steps: [
      { say: [['Mateo', 'El contacto del banco quiere vernos en el mirador de cristal.'], ['Citlali', 'Con esta neblina no se ve ni el piso... me gusta.']] },
      { fog: 2.4 },
      { type: 'goto', at: 'Mirador de Cristal', r: 4, onFoot: true, text: 'Ve a pie al ~y~Mirador de Cristal~w~.' },
      { type: 'goto', at: 'Punta del Mirador', r: 2.5, onFoot: true, text: 'Camina sobre el cristal hasta la ~y~punta~w~.' },
      { say: [['Contacto', '(por teléfono) Perdón, chavos... la policía me agarró primero.'], ['Citlali', '¡Es una trampa!']] },
      { wanted: 3 },
      { type: 'lose', text: 'Escapa de la ~r~emboscada~w~.' },
      { fog: 1 },
    ],
  },
  {
    id: 'm6', title: 'El Golpe del Reloj', giver: 'Citlali', start: 'Reloj Floral', reward: 25000,
    steps: [
      { say: [['Citlali', 'Cuando el Reloj Floral marque la hora, entramos al Banco de la Sierra.'], ['Mateo', 'Y salimos por la carretera a Chignahuapan antes de que nos alcancen.']] },
      { spawn: { car: { type: 'deportivo', at: 'Banco', paint: 0x212121, survive: true } } },
      { type: 'goto', at: 'Banco', r: 3, onFoot: true, text: 'Entra al ~g~Banco de la Sierra~w~.' },
      { wanted: 4 },
      { type: 'hold', at: 'Banco', r: 6, time: 12, text: 'Quédate en el banco mientras se abre la caja fuerte.' },
      { type: 'enter', vehicle: 'car', text: 'Sube al ~b~auto de escape~w~.' },
      { type: 'goto', at: 'Salida', r: 10, inVehicle: true, text: 'Huye por la ~y~carretera a Chignahuapan~w~.' },
      { type: 'lose', text: 'Pierde a la policía para siempre.' },
    ],
  },
];

const SAVE_KEY = 'zacatlan-libre-save-v1';

export class Missions {
  constructor(game) {
    this.g = game;
    this.index = 0; this.active = null; this.stepI = 0; this.vehicles = {}; this.timer = 0; this.stepT = 0;
    this.load();
    // Marcador cilíndrico (objetivo) y marcador de inicio
    const mk = (color, r, h) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      m.visible = false; game.scene.add(m); return m;
    };
    this.marker = mk(0xffd54f, 2, 3);
    this.startMarker = mk(0x4fc3f7, 1.4, 2.4);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffd54f }));
    this.arrow.visible = false; game.scene.add(this.arrow);
    this.t = 0;
  }

  load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) { this.index = s.index || 0; this.g.state.money = s.money ?? this.g.state.money; } } catch { /* almacenamiento no disponible */ } }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ index: this.index, money: this.g.state.money })); } catch { /* sin almacenamiento */ } }
  reset() { this.index = 0; this.g.state.money = 500; this.save(); }

  place(name) {
    const P = this.g.world.places;
    if (Array.isArray(name)) return name;
    if (name === 'Salida') { const G = this.g.world.graph, n = G.nearest(-900, -700, true); return [G.x[n], G.z[n]]; }
    return P[name] || P[name + ':road'] || [0, 0];
  }
  // Punto sobre un carril cercano a un lugar, con orientación.
  roadSpot(x, z) {
    const G = this.g.world.graph, n = G.nearest(x, z, true);
    const e = G.adj[n].find((e) => e.drive) || G.adj[n][0];
    const dx = G.x[e.to] - G.x[n], dz = G.z[e.to] - G.z[n], L = Math.hypot(dx, dz) || 1, off = e.width / 2 - 1.2, t = Math.min(0.5, 8 / L);
    return { x: G.x[n] + dx * t - (dz / L) * off, z: G.z[n] + dz * t + (dx / L) * off, yaw: Math.atan2(dx, dz), a: n, b: e.to };
  }

  // Punto de banqueta junto a un lugar (los marcadores de inicio nunca quedan dentro de un edificio).
  startSpot(m) {
    if (m._spot) return m._spot;
    const P = this.g.world.places;
    if (P[m.start + ':road']) return (m._spot = P[m.start]);
    const [x, z] = this.place(m.start), G = this.g.world.graph, ne = G.nearestEdge(x, z);
    if (!ne) return (m._spot = [x, z]);
    const ax = G.x[ne.a], az = G.z[ne.a], dx = G.x[ne.b] - ax, dz = G.z[ne.b] - az, L = Math.hypot(dx, dz) || 1;
    const px = ax + dx * ne.t, pz = az + dz * ne.t, side = Math.sign((x - px) * -dz / L + (z - pz) * dx / L) || 1;
    const off = (G.edgeWidth(ne.a, ne.b) / 2 + 1.2) * side;
    return (m._spot = [px - (dz / L) * off, pz + (dx / L) * off]);
  }

  get next() { return STORY[this.index] || null; }

  start(m) {
    const g = this.g;
    this.active = m; this.stepI = -1; this.vehicles = {}; this.timer = 0; this.failed = false;
    g.hud.bigText(m.title, 'Misión de ' + m.giver, 3);
    g.audio.jingle(true);
    this.advance();
  }

  advance() {
    const g = this.g, m = this.active;
    this.stepI++; this.stepT = 0; this.timer = 0; g.hud.timer(null);
    const s = m.steps[this.stepI];
    if (!s) return this.pass();
    if (s.say) { g.hud.say(s.say); return this.advance(); }
    if (s.spawn) { for (const [k, d] of Object.entries(s.spawn)) this.spawnVehicle(k, d); return this.advance(); }
    if (s.wanted) { g.wanted.set(s.wanted); return this.advance(); }
    if (s.fog) { g.fogBoost = s.fog; return this.advance(); }
    if (s.text) g.hud.objective(s.text);
    if (s.time && s.type !== 'hold') this.timer = s.time;
    this.holdT = 0;
    if (s.type === 'race') this.setupRace(s);
  }

  spawnVehicle(key, d) {
    const g = this.g, [px, pz] = this.place(d.at), sp = this.roadSpot(px, pz);
    const v = new Vehicle(d.type, sp.x, sp.z, sp.yaw, d.paint);
    v.owner = 'mission'; v.mission = true; v.survive = !!d.survive;
    if (d.driver) {
      const c = new Character(randomLook(Math.random, d.driver)); c.kind = 'ped'; c.onFoot = false; c.vehicle = v; c.hostile = true;
      v.driver = c; v.ai = new DriverAI(g, v, d.ai || 'cruise'); v.ai.place(sp.a, sp.b, 0.3); v.ai.cruise = 8;
    }
    g.addVehicle(v);
    this.vehicles[key] = v;
  }

  setupRace(s) {
    const g = this.g, G = g.world.graph, P = g.player.pos();
    const nodes = [];
    let from = G.nearest(P.x, P.z, true);
    for (const name of s.via) {
      const [x, z] = this.place(name), to = G.nearest(x, z, true);
      const path = G.path(from, to, true);
      if (path) { if (nodes.length) path.shift(); nodes.push(...path); }
      from = to;
    }
    // Puntos de control cada ~110 m sobre la ruta
    const cps = []; let acc = 0;
    for (let i = 1; i < nodes.length; i++) {
      acc += Math.hypot(G.x[nodes[i]] - G.x[nodes[i - 1]], G.z[nodes[i]] - G.z[nodes[i - 1]]);
      if (acc > 110 || i === nodes.length - 1) { cps.push([G.x[nodes[i]], G.z[nodes[i]]]); acc = 0; }
    }
    const total = cps.reduce((s2, c, i) => s2 + (i ? Math.hypot(c[0] - cps[i - 1][0], c[1] - cps[i - 1][1]) : 0), 0);
    this.race = { cps, i: 0, nodes, rivals: [] };
    this.timer = Math.round(total / 15 + 25);
    for (let k = 0; k < (s.rivals || 0); k++) {
      const v = new Vehicle('deportivo', 0, 0, 0, [0x1e88e5, 0x43a047][k % 2]);
      v.owner = 'mission';
      v.driver = new Character(randomLook(Math.random)); v.driver.onFoot = false; v.driver.vehicle = v;
      v.ai = new DriverAI(g, v, 'path');
      v.ai.setPath(nodes, { x: cps[cps.length - 1][0], z: cps[cps.length - 1][1] });
      v.ai.place(nodes[0], nodes[1], 0.15 + k * 0.12);
      v.ai.pi = 1; v.ai.next = nodes[2] ?? -1;
      v.ai.aggr = 0.4; v.raceCp = 0;
      g.addVehicle(v); this.race.rivals.push(v);
    }
  }

  pass() {
    const g = this.g, m = this.active;
    g.addMoney(m.reward);
    g.hud.bigText('¡MISIÓN COMPLETADA!', fmtMoney(m.reward), 4, '#ffd54f');
    g.audio.jingle(true);
    this.cleanup();
    this.index++;
    this.save();
    if (this.index >= STORY.length) setTimeout(() => g.hud.bigText('ZACATLÁN ES TUYO', 'Gracias por jugar · El mundo sigue abierto', 7, '#f06292'), 4500);
  }

  fail(reason) {
    const g = this.g;
    if (!this.active) return;
    g.hud.bigText('MISIÓN FALLIDA', reason, 4, '#ef5350');
    g.audio.jingle(false);
    this.cleanup();
  }

  cleanup() {
    const g = this.g;
    for (const v of Object.values(this.vehicles)) { if (v.owner === 'mission') v.owner = v.driver?.isPlayer ? 'player' : 'parked'; v.survive = false; if (v.ai && v.driver && !v.driver.isPlayer) { v.ai.mode = 'cruise'; v.ai.target = null; v.ai.aggr = 0; v.owner = 'traffic'; } }
    if (this.race) for (const v of this.race.rivals) { v.owner = 'traffic'; v.ai.mode = 'cruise'; v.ai.aggr = 0; v.ai.target = null; v.ai.attach(); }
    this.race = null; this.active = null; this.vehicles = {}; this.cash = null;
    g.fogBoost = 1; g.hud.objective(''); g.hud.subQ.length = 0; g.hud.timer(null); g.gps.clear();
    this.marker.visible = false; this.arrow.visible = false;
  }

  onEnterVehicle(v) {}
  onCharDamaged(c, byPlayer) {}

  showMarker(x, z, r = 2) {
    const gy = groundY(x, z);
    this.marker.visible = true; this.marker.position.set(x, gy + 1.5, z); this.marker.scale.set(r / 2, 1, r / 2);
    this.arrow.visible = true; this.arrow.position.set(x, gy + 4.5 + Math.sin(this.t * 3) * 0.4, z); this.arrow.rotation.y = this.t * 2;
  }

  update(dt) {
    const g = this.g, P = g.player, p = P.pos();
    this.t += dt;
    if (!this.active) {
      this.marker.visible = this.arrow.visible = false;
      const m = this.next;
      if (!m) { this.startMarker.visible = false; return; }
      const [x, z] = this.startSpot(m);
      this.startMarker.visible = true; this.startMarker.position.set(x, groundY(x, z) + 1.2, z);
      this.startMarker.material.color.set(m.giver === 'Mateo' ? 0x4fc3f7 : 0xf06292);
      g.gps.set(x, z, m.giver === 'Mateo' ? '#4fc3f7' : '#f06292', !this.gpsForced);
      const near = Math.hypot(p.x - x, p.z - z) < 3.4;
      if (!P.dead && g.wanted.level === 0 && near && (!P.inVehicle || P.vehicle.speed < 3)) { this.gpsForced = false; this.start(m); }
      return;
    }
    this.startMarker.visible = false;
    const s = this.active.steps[this.stepI];
    if (!s) return;
    this.stepT += dt;
    if (P.dead) return this.fail(P.deathKind === 'busted' ? 'Te arrestaron' : 'Te eliminaron');
    for (const v of Object.values(this.vehicles)) if (v.survive && v.dead) return this.fail('El vehículo quedó destruido');
    if (this.timer > 0) { this.timer -= dt; g.hud.timer(this.timer); if (this.timer <= 0) return this.fail('Se acabó el tiempo'); }
    const veh = s.vehicle ? this.vehicles[s.vehicle] : null;
    const at = s.at ? this.place(s.at) : null;
    switch (s.type) {
      case 'enter':
        if (!veh) return this.advance();
        this.showMarker(veh.x, veh.z, 1.6); this.marker.visible = false;
        this.arrow.position.set(veh.x, groundY(veh.x, veh.z) + veh.spec.hgt + 2 + Math.sin(this.t * 3) * 0.3, veh.z);
        g.gps.set(veh.x, veh.z, '#4fc3f7');
        if (P.vehicle === veh) this.advance();
        break;
      case 'inVehicle':
        g.gps.clear();
        if (P.inVehicle) this.advance();
        break;
      case 'goto': case 'deliver': case 'hold': {
        const [x, z] = at, r = s.r || 5;
        this.showMarker(x, z, r);
        g.gps.set(x, z, '#ffd54f');
        if (s.vehicle && P.vehicle !== veh) { g.hud.objective('Regresa al ~y~vehículo~w~.'); g.gps.set(veh.x, veh.z, '#4fc3f7'); this.wasOut = true; break; }
        if (this.wasOut) { this.wasOut = false; g.hud.objective(s.text); }
        const inside = Math.hypot(p.x - x, p.z - z) < r;
        const okMode = (!s.onFoot || !P.inVehicle) && (!s.inVehicle || P.inVehicle);
        if (s.type === 'hold') {
          if (inside && !P.inVehicle) { this.holdT = (this.holdT || 0) + dt; g.hud.timer(s.time - this.holdT); if (this.holdT >= s.time) { this.holdT = 0; g.addMoney(0); this.advance(); } }
          break;
        }
        if (inside && okMode && (!P.inVehicle || P.vehicle.speed < 6)) this.advance();
        break;
      }
      case 'lose':
        this.marker.visible = this.arrow.visible = false; g.gps.clear();
        if (veh && P.vehicle !== veh && !veh.dead) g.hud.objective('Regresa al ~y~vehículo~w~ y ' + s.text.charAt(0).toLowerCase() + s.text.slice(1));
        if (g.wanted.level === 0 && this.stepT > 1) this.advance();
        break;
      case 'chase': {
        if (!veh) return this.advance();
        this.marker.visible = false; this.arrow.visible = true;
        this.arrow.position.set(veh.x, groundY(veh.x, veh.z) + 3.5 + Math.sin(this.t * 3) * 0.3, veh.z);
        g.gps.set(veh.x, veh.z, '#ef5350');
        // El Pelón pasea tranquilo hasta que te ve cerca; entonces huye a toda velocidad
        if (veh.ai && veh.ai.mode !== 'flee' && Math.hypot(veh.x - p.x, veh.z - p.z) < 70) { veh.ai.mode = 'flee'; veh.ai.aggr = 0.85; g.hud.say([['Citlali', '¡Ahí va el Pelón! ¡Que no se escape!']]); }
        if (veh.hp < veh.spec.hp * 0.4 || veh.dead) {
          // El Pelón se baja, suelta el dinero y huye
          const d = veh.driver;
          veh.driver = null; veh.ai = null; veh.input.throttle = 0; veh.input.brake = 1;
          if (d && !d.isPlayer) { d.onFoot = true; d.vehicle = null; d.x = d.px = veh.x + 2; d.z = d.pz = veh.z; d.flee = 10; d.threat = { x: p.x, z: p.z }; d.a = d.b = g.world.graph.nearest(d.x, d.z, false); d.side = 1; d.walk = 1.4; d.bodyT = 0; g.peds.list.push(d); }
          g.pickups.drop(veh.x - 2, veh.z, 'cash', 0, 120);
          this.cash = g.pickups.items[g.pickups.items.length - 1];
          this.advance();
        } else if (veh.ai?.mode === 'flee' && Math.hypot(veh.x - p.x, veh.z - p.z) > 320) return this.fail('El Pelón se escapó');
        break;
      }
      case 'collect': {
        const it = this.cash;
        if (!it || !g.pickups.items.includes(it)) return this.advance();
        this.showMarker(it.x, it.z, 1.2); this.marker.visible = false;
        g.gps.set(it.x, it.z, '#66bb6a');
        break;
      }
      case 'race': {
        const R = this.race; if (!R) return this.advance();
        const cp = R.cps[R.i], last = R.i === R.cps.length - 1;
        this.showMarker(cp[0], cp[1], 6);
        this.marker.material.color.set(last ? 0xf06292 : 0xffd54f);
        g.gps.set(cp[0], cp[1], '#ffd54f');
        if (Math.hypot(p.x - cp[0], p.z - cp[1]) < 9 && P.inVehicle) {
          R.i++; g.audio.pickup();
          if (R.i >= R.cps.length) {
            const pos = 1 + R.rivals.filter((v) => v.raceDone).length;
            this.marker.material.color.set(0xffd54f);
            if (pos === 1) this.advance(); else this.fail(`Llegaste en ${pos}º lugar`);
            return;
          }
        }
        for (const v of R.rivals) {
          const c = R.cps[Math.min(v.raceCp, R.cps.length - 1)];
          if (Math.hypot(v.x - c[0], v.z - c[1]) < 14) { v.raceCp++; if (v.raceCp >= R.cps.length) v.raceDone = true; }
        }
        const ahead = R.rivals.filter((v) => v.raceCp > R.i).length;
        g.hud.racePos(1 + ahead, R.rivals.length + 1, R.i, R.cps.length);
        break;
      }
    }
  }
}
