// Grafo vial a partir de OSM: navegación de tráfico, peatones, policía y GPS.
import map from './mapData.js';
import { MinHeap, SpatialGrid } from '../util.js';

export const DRIVABLE_MAX_TYPE = 5; // 0..5 = calles para autos; 6 peatonal; 7 andador

export class RoadGraph {
  constructor() {
    const N = map.nodes.length / 2;
    this.n = N;
    this.x = new Float32Array(N); this.z = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.x[i] = map.nodes[i * 2]; this.z[i] = map.nodes[i * 2 + 1]; }
    this.ways = map.ways;
    this.adj = Array.from({ length: N }, () => []);
    this.degDrive = new Uint8Array(N);
    for (let w = 0; w < map.ways.length; w++) {
      const way = map.ways[w], ids = way.ids, drive = way.t <= DRIVABLE_MAX_TYPE;
      for (let k = 0; k < ids.length - 1; k++) {
        const a = ids[k], b = ids[k + 1];
        if (a === b) continue;
        const len = Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]);
        this.adj[a].push({ to: b, w, len, drive, width: way.w });
        this.adj[b].push({ to: a, w, len, drive, width: way.w });
        if (drive) { this.degDrive[a]++; this.degDrive[b]++; }
      }
    }
    this.grid = new SpatialGrid(60);
    for (let i = 0; i < N; i++) { const o = { i }; this.grid.insert(o, this.x[i], this.z[i], this.x[i], this.z[i]); }
    this._q = [];
    this.driveNodes = [];
    for (let i = 0; i < N; i++) if (this.degDrive[i] > 0) this.driveNodes.push(i);
    // Estructuras reutilizables de A*
    this.g = new Float32Array(N); this.came = new Int32Array(N); this.seen = new Uint32Array(N); this.closed = new Uint32Array(N); this.gen = 0;
    this.heap = new MinHeap();
  }

  nearest(x, z, driveOnly = true, maxR = 400) {
    let best = -1, bd = Infinity;
    for (let r = 60; r <= maxR && best < 0; r *= 2) {
      const n = this.grid.query(x, z, r, this._q);
      for (let k = 0; k < n; k++) {
        const i = this._q[k].i;
        if (driveOnly && !this.degDrive[i]) continue;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  // Calle más cercana (para mostrar el nombre en pantalla). Devuelve índice de vía o -1.
  nearestWay(x, z) {
    const n = this.grid.query(x, z, 70, this._q);
    let best = -1, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const a = this._q[k].i;
      for (const e of this.adj[a]) {
        const b = e.to, ax = this.x[a], az = this.z[a], dx = this.x[b] - ax, dz = this.z[b] - az;
        const L = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
        if (d < bd) { bd = d; best = e.w; }
      }
    }
    return bd < 30 * 30 ? best : -1;
  }

  // Tramo transitable más cercano (proyección perpendicular). Devuelve {a, b, t} o null.
  nearestEdge(x, z) {
    const n = this.grid.query(x, z, 90, this._q);
    let best = null, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const a = this._q[k].i;
      for (const e of this.adj[a]) {
        if (!e.drive) continue;
        const b = e.to, ax = this.x[a], az = this.z[a], dx = this.x[b] - ax, dz = this.z[b] - az;
        const L = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
        if (d < bd) { bd = d; best = { a, b, t }; }
      }
    }
    return best;
  }

  // A* sobre calles transitables. Devuelve arreglo de índices de nodo (o null).
  path(from, to, driveOnly = true, out = []) {
    out.length = 0;
    if (from < 0 || to < 0) return null;
    const gen = ++this.gen, g = this.g, came = this.came, seen = this.seen, closed = this.closed, heap = this.heap;
    const tx = this.x[to], tz = this.z[to];
    heap.clear();
    g[from] = 0; came[from] = -1; seen[from] = gen;
    heap.push(0, from);
    let iter = 0;
    while (heap.size && iter++ < 6000) {
      const a = heap.pop();
      if (closed[a] === gen) continue;
      closed[a] = gen;
      if (a === to) break;
      for (const e of this.adj[a]) {
        if (driveOnly && !e.drive) continue;
        const b = e.to, ng = g[a] + e.len;
        if (seen[b] !== gen || ng < g[b]) {
          seen[b] = gen; g[b] = ng; came[b] = a;
          heap.push(ng + Math.hypot(this.x[b] - tx, this.z[b] - tz), b);
        }
      }
    }
    if (seen[to] !== gen) return null;
    for (let c = to; c !== -1; c = came[c]) out.push(c);
    out.reverse();
    return out;
  }

  randomNext(prev, cur, driveOnly, r) {
    const opts = this.adj[cur];
    let cnt = 0;
    for (const e of opts) if ((!driveOnly || e.drive) && e.to !== prev) cnt++;
    if (cnt === 0) return prev; // callejón sin salida: media vuelta
    let k = Math.floor(r() * cnt);
    for (const e of opts) if ((!driveOnly || e.drive) && e.to !== prev) { if (k-- === 0) return e.to; }
    return prev;
  }

  edgeWidth(a, b) { for (const e of this.adj[a]) if (e.to === b) return e.width; return 7; }
}
