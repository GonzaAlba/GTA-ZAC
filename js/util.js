// Utilidades matemáticas y estructuras sin asignaciones en el bucle caliente.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// PRNG determinista (mulberry32) para que la ciudad salga igual siempre.
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
export const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

// Rejilla espacial genérica: los elementos se registran en todas las celdas que tocan.
export class SpatialGrid {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  key(i, j) { return (i + 2048) * 4096 + (j + 2048); }
  insert(item, minx, minz, maxx, maxz) {
    const c = this.cell;
    for (let i = Math.floor(minx / c); i <= Math.floor(maxx / c); i++)
      for (let j = Math.floor(minz / c); j <= Math.floor(maxz / c); j++) {
        const k = this.key(i, j);
        let b = this.map.get(k);
        if (!b) this.map.set(k, (b = []));
        b.push(item);
      }
  }
  // Llena `out` con los elementos únicos cercanos a (x,z) en radio r. Devuelve la cantidad.
  query(x, z, r, out) {
    const c = this.cell, s = ++this.stamp;
    let n = 0;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const b = this.map.get(this.key(i, j));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) { const it = b[k]; if (it._q !== s) { it._q = s; out[n++] = it; } }
      }
    out.length = n;
    return n;
  }
}

// Montículo binario mínimo para A*.
export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  clear() { this.k.length = 0; this.v.length = 0; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}

export const fmtMoney = (n) => '$' + Math.floor(n).toLocaleString('es-MX');
