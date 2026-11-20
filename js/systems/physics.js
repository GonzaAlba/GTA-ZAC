// Colisión círculo vs cajas orientadas (edificios) y límites del mundo.
import { constrainWorld } from '../world/terrain.js';

const tmp = [];
const hit = { nx: 0, nz: 0, depth: 0 };

export function circleVsObb(px, pz, r, b, out) {
  const dx = px - b.x, dz = pz - b.z;
  const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
  const cx = lx < -b.hw ? -b.hw : lx > b.hw ? b.hw : lx;
  const cz = lz < -b.hd ? -b.hd : lz > b.hd ? b.hd : lz;
  let ex = lx - cx, ez = lz - cz;
  const d2 = ex * ex + ez * ez;
  if (d2 > r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2); ex /= d; ez /= d; out.depth = r - d;
  } else {
    const px1 = b.hw - Math.abs(lx), pz1 = b.hd - Math.abs(lz);
    if (px1 < pz1) { ex = Math.sign(lx) || 1; ez = 0; out.depth = px1 + r; }
    else { ex = 0; ez = Math.sign(lz) || 1; out.depth = pz1 + r; }
  }
  out.nx = ex * b.c - ez * b.s; out.nz = ex * b.s + ez * b.c;
  return true;
}

// Empuja la entidad fuera de los obstáculos. Devuelve la normal acumulada (o null) y la
// componente de velocidad perdida en contra de la normal (impacto).
export function resolveCircle(world, e, r, y = 0.5, res = { nx: 0, nz: 0, impact: 0, hit: false }) {
  res.hit = false; res.nx = 0; res.nz = 0; res.impact = 0;
  const n = world.grid.query(e.x, e.z, r + 1, tmp);
  for (let k = 0; k < n; k++) {
    const b = tmp[k];
    if (b.h < y) continue;
    if (!circleVsObb(e.x, e.z, r, b, hit)) continue;
    e.x += hit.nx * hit.depth; e.z += hit.nz * hit.depth;
    applyNormal(e, hit.nx, hit.nz, res);
  }
  if (constrainWorld(e, r, hit, world.allowMirador && e.onFoot ? world.allowMirador : null)) applyNormal(e, hit.nx, hit.nz, res);
  return res;
}

function applyNormal(e, nx, nz, res) {
  res.hit = true; res.nx += nx; res.nz += nz;
  if (e.vx !== undefined) {
    const vn = e.vx * nx + e.vz * nz;
    if (vn < 0) { e.vx -= vn * nx; e.vz -= vn * nz; res.impact = Math.max(res.impact, -vn); }
  }
}
