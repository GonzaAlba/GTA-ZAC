// Minimapa circular que gira con la cámara, mapa completo y ruta GPS (A* sobre calles reales).
import map from '../world/mapData.js';
import { edgeX } from '../world/terrain.js';

const PX = 0.5; // píxeles por metro en el mapa pre-renderizado
const SIZE = 2400, OFF = 1200;

export class GPS {
  constructor(game) { this.g = game; this.target = null; this.points = []; this.color = '#ffd54f'; this.t = 0; this.blipOnly = false; this._path = []; }
  set(x, z, color = '#ffd54f', blipOnly = false) {
    const changed = !this.target || Math.hypot(this.target.x - x, this.target.z - z) > 12 || this.blipOnly !== blipOnly;
    this.target = { x, z }; this.color = color; this.blipOnly = blipOnly;
    if (changed) this.t = 0;
  }
  clear() { this.target = null; this.points.length = 0; }
  update(dt) {
    if (!this.target || this.blipOnly) { this.points.length = 0; return; }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const G = this.g.world.graph, p = this.g.player.pos();
    const a = G.nearest(p.x, p.z, true), b = G.nearest(this.target.x, this.target.z, true);
    const path = G.path(a, b, true, this._path);
    this.points.length = 0;
    if (path) { this.points.push(p.x, p.z); for (const n of path) this.points.push(G.x[n], G.z[n]); this.points.push(this.target.x, this.target.z); }
  }
}

export class Minimap {
  constructor(game, canvas, bigCanvas) {
    this.g = game; this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.big = bigCanvas; this.bctx = bigCanvas.getContext('2d');
    this.bg = this.prerender();
    this.zoom = 1.5; this.frame = 0;
  }

  prerender() {
    const c = document.createElement('canvas'); c.width = c.height = SIZE * PX;
    const g = c.getContext('2d');
    const T = (v) => (v + OFF) * PX;
    g.fillStyle = '#9fc77a'; g.fillRect(0, 0, c.width, c.height);
    // Barranca
    g.fillStyle = '#3f6e3a'; g.beginPath(); g.moveTo(T(edgeX(-OFF)), 0);
    for (let z = -OFF; z <= OFF; z += 25) g.lineTo(T(edgeX(z)), T(z));
    g.lineTo(c.width, c.height); g.lineTo(c.width, 0); g.closePath(); g.fill();
    g.strokeStyle = '#4fa3c7'; g.lineWidth = 4; g.beginPath();
    for (let i = 0; i < map.river.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, T(map.river[i]), T(map.river[i + 1]));
    g.stroke();
    // Áreas
    for (const a of map.areas) {
      g.fillStyle = a.n === 'Zócalo' || a.n.includes('Plazuela') ? '#e8d9b8' : a.k === 'cemetery' ? '#b8c7a3' : '#79b84e';
      g.beginPath(); for (let i = 0; i < a.p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, T(a.p[i]), T(a.p[i + 1])); g.closePath(); g.fill();
    }
    // Calles (de menor a mayor jerarquía)
    const order = [...map.ways].sort((a, b) => b.t - a.t);
    g.lineCap = g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const w of order) {
      const drive = w.t <= 5;
      g.strokeStyle = pass === 0 ? (drive ? '#5b5e66' : '#c9b48f') : drive ? (w.t <= 1 ? '#fff3c4' : '#f4f1ea') : '#e6d6b8';
      g.lineWidth = (pass === 0 ? w.w + 3 : w.w) * PX * 1.4;
      if (!drive && pass === 0) continue;
      g.beginPath();
      w.ids.forEach((id, i) => { const x = T(map.nodes[id * 2]), z = T(map.nodes[id * 2 + 1]); i ? g.lineTo(x, z) : g.moveTo(x, z); });
      g.stroke();
    }
    return c;
  }

  drawWorld(ctx, cx, cz, scale, rot, w, h, full) {
    const g = this.g;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cz);
    ctx.drawImage(this.bg, -OFF, -OFF, SIZE, SIZE);
    // Ruta GPS
    const pts = g.gps.points;
    if (pts.length > 2) {
      ctx.strokeStyle = g.gps.color; ctx.lineWidth = 7 / scale * (full ? 0.6 : 1); ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i], pts[i + 1]); ctx.stroke();
    }
    // Zona de búsqueda policial
    const W = g.wanted;
    if (W.level) {
      ctx.fillStyle = Math.floor(performance.now() / 300) % 2 ? 'rgba(229,57,53,0.22)' : 'rgba(30,136,229,0.22)';
      ctx.beginPath(); ctx.arc(W.lastX, W.lastZ, W.searchR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Convierte un punto del mundo a coordenadas de pantalla del mapa
  project(x, z, cx, cz, scale, rot, w, h) {
    const dx = (x - cx) * scale, dz = (z - cz) * scale, c = Math.cos(rot), s = Math.sin(rot);
    return [w / 2 + dx * c - dz * s, h / 2 + dx * s + dz * c];
  }

  blip(ctx, x, y, color, icon, size = 9) {
    ctx.fillStyle = color; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (icon) { ctx.fillStyle = '#fff'; ctx.font = `bold ${size * 1.2}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, x, y + 1); }
  }

  drawBlips(ctx, cx, cz, scale, rot, w, h, clampR) {
    const g = this.g;
    const put = (x, z, color, icon, size, edge = true) => {
      let [sx, sy] = this.project(x, z, cx, cz, scale, rot, w, h);
      if (clampR) {
        const dx = sx - w / 2, dy = sy - h / 2, d = Math.hypot(dx, dy);
        if (d > clampR) { if (!edge) return; sx = w / 2 + (dx / d) * clampR; sy = h / 2 + (dy / d) * clampR; }
      }
      this.blip(ctx, sx, sy, color, icon, size);
    };
    for (const b of g.world.blips) put(b.x, b.z, b.color, b.icon, 8, false);
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const u of g.police.units) if (!u.veh.dead) put(u.veh.x, u.veh.z, blink ? '#e53935' : '#1e88e5', '', 5, false);
    for (const c of g.police.cops) if (c.alive && c.onFoot) put(c.x, c.z, '#1e88e5', '', 3.5, false);
    if (g.police.heliActive) put(g.police.heli.position.x, g.police.heli.position.z, '#1e88e5', '✈', 6, false);
    const M = g.missions;
    if (M.active) for (const v of Object.values(M.vehicles)) if (!v.dead && v.driver !== g.player.ch) put(v.x, v.z, v.driver?.hostile ? '#ef5350' : '#4fc3f7', '', 6);
    if (g.gps.target) put(g.gps.target.x, g.gps.target.z, g.gps.color, g.gps.blipOnly ? (M.next?.giver?.[0] || '') : '', g.gps.blipOnly ? 9 : 7);
    // Otro protagonista
    for (const hh of g.player.heroes) if (hh !== g.player.hero) { const p = hh.vehicle || hh.ch; put(p.x, p.z, hh.name === 'Mateo' ? '#4fc3f7' : '#f06292', hh.name[0], 7); }
  }

  drawPlayerArrow(ctx, x, y, angle) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  update(camYaw) {
    if (this.frame++ % 2) return; // 30 Hz es suficiente para el minimapa
    const g = this.g, ctx = this.ctx, w = this.cv.width, h = this.cv.height, p = g.player.pos();
    const speed = g.player.inVehicle ? g.player.vehicle.speed : 0;
    this.zoom += ((speed > 15 ? 0.9 : 1.5) - this.zoom) * 0.05;
    const scale = this.zoom * (w / 220), rot = Math.PI + camYaw;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#3f6e3a'; ctx.fillRect(0, 0, w, h);
    this.drawWorld(ctx, p.x, p.z, scale, rot, w, h, false);
    this.drawBlips(ctx, p.x, p.z, scale, rot, w, h, w / 2 - 12);
    const yaw = g.player.inVehicle ? g.player.vehicle.yaw : g.player.ch.yaw;
    // Flecha: orientación del jugador relativa a la cámara
    this.drawPlayerArrow(ctx, w / 2, h / 2, -(yaw - camYaw));
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    // Norte
    const nx = w / 2 + Math.sin(rot) * (w / 2 - 12), ny = h / 2 - Math.cos(rot) * (w / 2 - 12);
    this.blip(ctx, nx, ny, '#263238', 'N', 8);
  }

  drawBig() {
    const g = this.g, c = this.big, ctx = this.bctx;
    const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
    const scale = Math.min(w, h) / 2100;
    ctx.fillStyle = '#3f6e3a'; ctx.fillRect(0, 0, w, h);
    this.drawWorld(ctx, 0, 0, scale, 0, w, h, true);
    this.drawBlips(ctx, 0, 0, scale, 0, w, h, 0);
    const p = g.player.pos(), [sx, sy] = this.project(p.x, p.z, 0, 0, scale, 0, w, h);
    const yaw = g.player.inVehicle ? g.player.vehicle.yaw : g.player.ch.yaw;
    this.drawPlayerArrow(ctx, sx, sy, Math.PI - yaw);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = `${12 * devicePixelRatio}px sans-serif`; ctx.textAlign = 'right';
    ctx.fillText(map.attribution, w - 10, h - 10);
  }
}
