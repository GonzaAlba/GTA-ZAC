// Relieve real: modelo digital de elevación (AWS Terrain Tiles) corregido localmente con las
// altitudes de las ubicaciones de panorámicas. La barranca y la sierra salen de los datos.
import * as THREE from 'three';
import map from './mapData.js';
import panos from './panoData.js';
import { DEM, DEM_B64 } from './demData.js';
import { clamp, smoothstep } from '../util.js';
import { tex } from './textures.js';

export const BOUNDS = map.bounds;
const NX = DEM.nx, NZ = DEM.nz, S = DEM.step, X0 = DEM.x0, Z0 = DEM.z0;

// ---------- Rejilla fusionada (m relativos al zócalo) ----------
const H = (() => {
  const bin = atob(DEM_B64), raw = new Int16Array(bin.length / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
  let h = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] / 10;
  // Suavizado 3×3 (quita el escalonado de 30 m del dato original)
  const b = new Float32Array(h.length);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
      s += h[jj * NX + ii]; n++;
    }
    b[j * NX + i] = s / n;
  }
  h = b;
  // Corrección local con las altitudes de cámara de las panorámicas (cámara ≈ 2.5 m sobre el suelo)
  const sample = (x, z) => {
    const fx = clamp((x - X0) / S, 0, NX - 1.001), fz = clamp((z - Z0) / S, 0, NZ - 1.001), i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * NX + i;
    return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) + (h[k + NX] * (1 - tx) + h[k + NX + 1] * tx) * tz;
  };
  const num = new Float32Array(h.length), den = new Float32Array(h.length), SIG = 60, R = 180;
  for (const p of panos) {
    if (!p.alt) continue;
    const r = p.alt - 2.5 - DEM.base - sample(p.x, p.z);
    const i0 = Math.max(0, Math.floor((p.x - R - X0) / S)), i1 = Math.min(NX - 1, Math.ceil((p.x + R - X0) / S));
    const j0 = Math.max(0, Math.floor((p.z - R - Z0) / S)), j1 = Math.min(NZ - 1, Math.ceil((p.z + R - Z0) / S));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * S - p.x, dz = Z0 + j * S - p.z, w = Math.exp(-(dx * dx + dz * dz) / (2 * SIG * SIG));
      num[j * NX + i] += w * r; den[j * NX + i] += w;
    }
  }
  for (let k = 0; k < h.length; k++) if (den[k] > 1e-4) h[k] += (num[k] / den[k]) * Math.min(1, den[k] * 1.5);
  return h;
})();

export function groundY(x, z) {
  let fx = (x - X0) / S, fz = (z - Z0) / S;
  fx = fx < 0 ? 0 : fx > NX - 1.001 ? NX - 1.001 : fx; fz = fz < 0 ? 0 : fz > NZ - 1.001 ? NZ - 1.001 : fz;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * NX + i;
  return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + NX] * (1 - tx) + H[k + NX + 1] * tx) * tz;
}
export const heightAt = groundY;

// Pendiente (|∇h|) y dirección cuesta arriba
export function slopeAt(x, z, out) {
  const gx = (groundY(x + 2, z) - groundY(x - 2, z)) / 4, gz = (groundY(x, z + 2) - groundY(x, z - 2)) / 4;
  if (out) { out.gx = gx; out.gz = gz; }
  return Math.hypot(gx, gz);
}

// ---------- Ceja de la barranca (frente al centro) calculada del relieve ----------
const EDGE = (() => {
  const t = [];
  for (let z = -1300; z <= 1300; z += 25) {
    let edge = 1500;
    for (let x = 0; x < 1500; x += 5) {
      if (groundY(x, z) < groundY(x - 60, z) - 18) { edge = x - 12; break; }
    }
    t.push(edge);
  }
  // Mediana móvil para eliminar saltos
  return t.map((_, i) => { const w = t.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b); return w[w.length >> 1]; });
})();
export function edgeX(z) {
  const f = (clamp(z, -1300, 1300) + 1300) / 25, i = Math.min(EDGE.length - 2, Math.floor(f)), t = f - i;
  return EDGE[i] * (1 - t) + EDGE[i + 1] * t;
}
export const EDGE_Z = [-1150, 1150]; // tramo con barandal

// ¿Terreno no construible? (más allá de la ceja de la barranca o con mucha pendiente)
export function unbuildable(x, z, margin = 0) {
  if (z > EDGE_Z[0] && z < EDGE_Z[1] && x > edgeX(z) - margin) return true;
  return slopeAt(x, z) > 0.32;
}

// Restringe un círculo al área jugable: límites del mundo, barandal de la barranca y paredes de roca.
const _g = { gx: 0, gz: 0 };
export function constrainWorld(e, r, out, allowMirador = null) {
  let hit = false;
  const B = BOUNDS, m = 15;
  if (e.x < B.x0 + m + r) { e.x = B.x0 + m + r; out.nx = 1; out.nz = 0; hit = true; }
  if (e.x > B.x1 - m - r) { e.x = B.x1 - m - r; out.nx = -1; out.nz = 0; hit = true; }
  if (e.z < B.z0 + m + r) { e.z = B.z0 + m + r; out.nx = 0; out.nz = 1; hit = true; }
  if (e.z > B.z1 - m - r) { e.z = B.z1 - m - r; out.nx = 0; out.nz = -1; hit = true; }
  if (allowMirador && allowMirador(e.x, e.z)) return hit;
  if (e.z > EDGE_Z[0] && e.z < EDGE_Z[1]) {
    const ex = edgeX(e.z) - 2.2 - r;
    if (e.x > ex && e.x < ex + 40) {
      const sl = (edgeX(e.z + 1) - edgeX(e.z - 1)) / 2, n = Math.hypot(1, sl);
      e.x = ex; out.nx = -1 / n; out.nz = sl / n; hit = true;
    }
  }
  // Paredes de roca: más de ~42° de pendiente no se puede subir ni bajar
  const s = slopeAt(e.x, e.z, _g);
  if (s > 0.9) {
    const k = Math.min(0.6, (s - 0.9) * 1.5) / s;
    e.x += _g.gx * k; e.z += _g.gz * k; // hacia arriba (de vuelta a la meseta)
    out.nx = _g.gx / s; out.nz = _g.gz / s; hit = true;
  }
  return hit;
}

// ---------- Malla del terreno con mezcla de texturas por pendiente y altura ----------
export function buildTerrain(scene) {
  const W = (NX - 1) * S, D = (NZ - 1) * S, SX = Math.round(W / 20), SZ = Math.round(D / 20);
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(X0 + W / 2, 0, Z0 + D / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundY(pos.getX(i), pos.getZ(i)) - 0.05);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const tGrass = tex('sparse_grass_diff', true), tRock = tex('aerial_rocks_02_diff', true), tForest = tex('forest_ground_04_diff', true);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrass = { value: tGrass }; sh.uniforms.tRock = { value: tRock }; sh.uniforms.tForest = { value: tForest };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vW; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tRock, tForest; varying vec3 vW; varying vec3 vWN;
        float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
        // Dos escalas por textura para romper la repetición
        vec3 g = mix(texture2D(tGrass, vW.xz * 0.11).rgb, texture2D(tGrass, vW.xz * 0.023).rgb, 0.45);
        vec3 f = mix(texture2D(tForest, vW.xz * 0.09).rgb, texture2D(tForest, vW.xz * 0.02).rgb, 0.4);
        vec3 r = texture2D(tRock, vec2(vW.x + vW.z, vW.y) * 0.05).rgb;
        float slope = 1.0 - vWN.y;
        float forest = smoothstep(-25.0, -60.0, vW.y) + smoothstep(60.0, 110.0, vW.y);
        forest = clamp(forest + smoothstep(0.35, 0.75, sin(vW.x * 0.004) * sin(vW.z * 0.005) + 0.3), 0.0, 1.0) * 0.85;
        vec3 col = mix(g * vec3(0.92, 1.0, 0.85), f * vec3(0.75, 0.85, 0.7), forest);
        col = mix(col, r, smoothstep(0.28, 0.5, slope));
        diffuseColor.rgb *= col * 1.15;`);
  };
  mat.customProgramCacheKey = () => 'terrain-v2';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terreno';
  scene.add(mesh);

  // Río San Pedro en el fondo de la barranca (agua con brillo especular)
  const pts = [];
  for (let i = 0; i < map.river.length; i += 2) {
    const x = map.river[i], z = map.river[i + 1];
    if (x > X0 && x < X0 + W && z > Z0 && z < Z0 + D) pts.push(new THREE.Vector3(x, groundY(x, z) + 0.6, z));
  }
  if (pts.length > 3) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = pts.length * 3, verts = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const p = curve.getPoint(i / n), t = curve.getTangent(i / n);
      const rx = -t.z * 5, rz = t.x * 5;
      verts.push(p.x - rx, groundY(p.x - rx, p.z - rz) + 0.5, p.z - rz, p.x + rx, groundY(p.x + rx, p.z + rz) + 0.5, p.z + rz);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3f6f78, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide })));
  }
  return mesh;
}
