import * as THREE from 'three';
import map from './mapData.js';
import { clamp, smoothstep, hash2 } from '../util.js';

const E = map.edge, E0 = E[0][0];
export const WORLD_LIMIT = map.limit - 12; // límite jugable (m)

// x de la ceja de la barranca para un z dado.
export function edgeX(z) {
  const f = (z - E0) / 50;
  const i = clamp(Math.floor(f), 0, E.length - 2);
  const t = clamp(f - i, 0, 1);
  return E[i][1] * (1 - t) + E[i + 1][1] * t;
}

// El pueblo es una meseta (y = 0). La barranca cae al este y la sierra rodea el mapa.
export function heightAt(x, z) {
  const d = x - edgeX(z);
  let h = 0;
  if (d > 0) h = -140 * smoothstep(0, 110, d) + 95 * smoothstep(380, 700, d);
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m > map.limit + 20) h += 280 * smoothstep(map.limit + 20, map.limit + 650, m);
  if (d > 4 || m > map.limit + 20) h += (hash2(Math.round(x / 9), Math.round(z / 9)) - 0.5) * 6;
  return h;
}

// Restringe un círculo al área jugable (barandal de la barranca + límites del valle).
// Devuelve true si hubo contacto; deja la normal en out.nx/out.nz.
export function constrainWorld(e, r, out, allowMirador = null) {
  let hit = false;
  const L = WORLD_LIMIT;
  if (e.x < -L + r) { e.x = -L + r; out.nx = 1; out.nz = 0; hit = true; }
  if (e.x > L - r) { e.x = L - r; out.nx = -1; out.nz = 0; hit = true; }
  if (e.z < -L + r) { e.z = -L + r; out.nx = 0; out.nz = 1; hit = true; }
  if (e.z > L - r) { e.z = L - r; out.nx = 0; out.nz = -1; hit = true; }
  if (allowMirador && allowMirador(e.x, e.z)) return hit;
  const ex = edgeX(e.z) - 2.2 - r;
  if (e.x > ex) {
    const slope = (edgeX(e.z + 1) - edgeX(e.z - 1)) / 2;
    const n = Math.hypot(1, slope);
    e.x = ex; out.nx = -1 / n; out.nz = slope / n; hit = true;
  }
  return hit;
}

export function buildTerrain(scene, gradientMap) {
  const SIZE = 3800, SEG = 190;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color(0x86b34f), grass2 = new THREE.Color(0x6e9e45), rock = new THREE.Color(0x9c8b72), deep = new THREE.Color(0x3f6e3a), snowy = new THREE.Color(0x7d9a6a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const s = Math.abs(heightAt(x + 4, z) - heightAt(x - 4, z)) + Math.abs(heightAt(x, z + 4) - heightAt(x, z - 4));
    c.copy(hash2(x * 0.05, z * 0.05) > 0.5 ? grass : grass2);
    if (h < -60) c.lerp(deep, 0.7);
    if (h > 80) c.lerp(snowy, 0.5);
    if (s > 9) c.lerp(rock, clamp((s - 9) / 12, 0, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
  mesh.receiveShadow = true;
  mesh.name = 'terreno';
  scene.add(mesh);

  // Río San Pedro en el fondo de la barranca.
  const pts = [];
  for (let i = 0; i < map.river.length; i += 2) {
    const x = map.river[i], z = map.river[i + 1];
    if (heightAt(x, z) < -90) pts.push(new THREE.Vector3(x, heightAt(x, z) + 1.2, z));
  }
  if (pts.length > 3) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = pts.length * 4, verts = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const p = curve.getPoint(i / n), t = curve.getTangent(i / n);
      const rx = -t.z * 7, rz = t.x * 7;
      verts.push(p.x - rx, p.y, p.z - rz, p.x + rx, p.y, p.z + rz);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: 0x4fa3c7, gradientMap, side: THREE.DoubleSide })));
  }
  return mesh;
}
