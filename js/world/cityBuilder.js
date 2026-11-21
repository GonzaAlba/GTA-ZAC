import * as THREE from 'three';
import map from './mapData.js';
import { RoadGraph, DRIVABLE_MAX_TYPE } from './graph.js';
import { ChunkedInstances } from './chunks.js';
import { gradientMap, makeFacadeMaterial, makeRailingMaterial, makeSignMaterial, makeRoadMaterial, makeRoofMaterial, toon, shared } from './materials.js';
import { STYLE, PALETTES, TEJAS, SHOPS, styleAt } from './streetStyles.js';
import { buildTerrain, heightAt, edgeX, groundY } from './terrain.js';
import { SpatialGrid, rng, clamp, pick } from '../util.js';

const OCC = 2, OCC_N = 1200, OCC_O = -1200; // ocupación en celdas de 2 m
export const CENTRO_R = 460; // radio del centro histórico (adoquín, casas blancas)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.grid = new SpatialGrid(24);
    this.colliders = [];
    this.occ = new Uint8Array(OCC_N * OCC_N);
    this.graph = new RoadGraph();
    this.chunked = [];
    this.lampMat = null;
    this.places = {}; // puntos con nombre para misiones y servicios
    this.blips = [];  // íconos fijos del minimapa
  }

  // ---------- Colisión ----------
  // Caja orientada: eje local x = (cos a, sin a) en el plano xz.
  addBox(x, z, hw, hd, a, h = 6, kind = 'building') {
    const c = Math.cos(a), s = Math.sin(a);
    const b = { x, z, hw, hd, c, s, h, kind, _q: 0 };
    const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
    this.grid.insert(b, x - ex, z - ez, x + ex, z + ez);
    this.colliders.push(b);
    return b;
  }

  // ---------- Ocupación (evita que casas invadan calles o monumentos) ----------
  occIdx(x, z) {
    const i = Math.floor((x - OCC_O) / OCC), j = Math.floor((z - OCC_O) / OCC);
    if (i < 0 || j < 0 || i >= OCC_N || j >= OCC_N) return -1;
    return j * OCC_N + i;
  }
  occAt(x, z) { const k = this.occIdx(x, z); return k < 0 ? 1 : this.occ[k]; }
  // Recorre la huella de una caja orientada; mode 0 = probar, 1 = marcar.
  occBox(x, z, hw, hd, a, mode, val = 2) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let u = -hw; u <= hw + 0.01; u += 1)
      for (let v = -hd; v <= hd + 0.01; v += 1) {
        const k = this.occIdx(x + c * u - s * v, z + s * u + c * v);
        if (mode === 0) { if (k < 0 || this.occ[k]) return false; }
        else if (k >= 0) this.occ[k] = val;
      }
    return true;
  }
  occPoly(pts, val = 3) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { minx = Math.min(minx, pts[i]); maxx = Math.max(maxx, pts[i]); minz = Math.min(minz, pts[i + 1]); maxz = Math.max(maxz, pts[i + 1]); }
    for (let x = minx; x <= maxx; x += 1) for (let z = minz; z <= maxz; z += 1) if (pointInPoly(x, z, pts)) { const k = this.occIdx(x, z); if (k >= 0) this.occ[k] = val; }
  }
  occSegment(ax, az, bx, bz, r, val = 1) {
    const minx = Math.min(ax, bx) - r, maxx = Math.max(ax, bx) + r, minz = Math.min(az, bz) - r, maxz = Math.max(az, bz) + r;
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
    for (let x = minx; x <= maxx; x += OCC) for (let z = minz; z <= maxz; z += OCC) {
      let t = ((x - ax) * dx + (z - az) * dz) / L; t = clamp(t, 0, 1);
      if ((ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2 <= r * r) { const k = this.occIdx(x, z); if (k >= 0) this.occ[k] = val; }
    }
  }

  // ---------- Construcción ----------
  build(landmarks) {
    const scene = this.scene;
    this.terrain = buildTerrain(scene, gradientMap);
    this.buildRoads();
    this.buildAreas();
    landmarks.build(this);
    this.buildOsmBuildings();
    this.buildHouses();
    this.buildTrees();
    this.buildLamps();
    this.buildFurniture();
    for (const c of this.chunked) c.build();
  }

  wayPoints(way) { return way.ids.map((i) => [this.graph.x[i], this.graph.z[i]]); }

  buildRoads() {
    const side = new GeoBuilder(), road = new GeoBuilder(), mark = new GeoBuilder(), curb = new GeoBuilder();
    const cSide = new THREE.Color(0xd8cfc0), cAsph = new THREE.Color(0x55575e), cMain = new THREE.Color(0x4a4c52), cCobble = new THREE.Color(0xa3958a), cPed = new THREE.Color(0xcdb79a), cPath = new THREE.Color(0xb59f7e), cLine = new THREE.Color(0xf3d34a), cWhite = new THREE.Color(0xf4f4f0);
    const cCurb = new THREE.Color(0xc9c4ba), cCurbY = new THREE.Color(0xf2c230);
    const G = this.graph;
    const isX = (i) => G.adj[i].filter((e) => e.drive).length > 2; // intersección
    for (const way of map.ways) {
      const pts = this.wayPoints(way);
      const mid = pts[Math.floor(pts.length / 2)];
      const centro = Math.hypot(mid[0], mid[1]) < CENTRO_R;
      if (way.t <= DRIVABLE_MAX_TYPE) {
        side.ribbon(pts, way.w + 3.4, 0.04, cSide);
        road.ribbon(pts, way.w, 0.08, centro ? cCobble : way.t <= 1 ? cMain : cAsph);
        if (way.t <= 2 && !centro) mark.dashes(pts, 0.22, 0.12, cLine, 3, 4);
        // Guarniciones elevadas, cortadas en las esquinas para no cruzar otras calles
        const cut = way.ids.filter(isX).map((i) => [G.x[i], G.z[i], G.adj[i].reduce((m, e) => Math.max(m, e.width), 0) / 2 + 2.2]);
        const col = centro && way.t <= 2 ? cCurbY : cCurb;
        if (Math.hypot(mid[0], mid[1]) < 750) for (const s of [1, -1]) curb.curb(pts, s * (way.w / 2 + 0.15), 0.3, 0.17, col, cut);
        for (let k = 0; k < pts.length - 1; k++) this.occSegment(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], way.w / 2 + 1.9, 1);
      } else {
        road.ribbon(pts, way.w, 0.07, way.t === 6 ? cPed : cPath);
        for (let k = 0; k < pts.length - 1; k++) this.occSegment(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], way.w / 2 + 0.6, 1);
      }
    }
    // Pasos peatonales tipo cebra en los cruces del centro y calles comerciales
    this.crossings = [];
    for (let i = 0; i < G.n; i++) {
      if (!isX(i) || Math.hypot(G.x[i], G.z[i]) > 520) continue;
      for (const e of G.adj[i]) {
        if (!e.drive || e.len < 16) continue;
        const ux = (G.x[e.to] - G.x[i]) / e.len, uz = (G.z[e.to] - G.z[i]) / e.len, d = 6.5;
        const cx = G.x[i] + ux * d, cz = G.z[i] + uz * d, hw = e.width / 2 - 0.3;
        for (let k = -hw; k < hw; k += 0.9) {
          const px = cx - uz * k, pz = cz + ux * k;
          mark.ribbonSeg(px - ux * 1.2, pz - uz * 1.2, px + ux * 1.2, pz + uz * 1.2, 0.45, 0.12, cWhite);
        }
        this.crossings.push([cx, cz, ux, uz, e.width]);
      }
    }
    const mk = (gb, off) => {
      const mesh = new THREE.Mesh(gb.geometry(), makeRoadMaterial(off));
      mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
    };
    mk(side, 1); mk(road, 2); mk(mark, 3);
    const cm = new THREE.Mesh(curb.geometry(true), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
    cm.receiveShadow = true; this.scene.add(cm);
  }

  buildAreas() {
    const gb = new GeoBuilder();
    const plaza = new THREE.Color(0xd9c7a6), park = new THREE.Color(0x76b04a), cem = new THREE.Color(0x9fb08a);
    for (const a of map.areas) {
      const isPlaza = a.n === 'Zócalo' || a.n.includes('Plazuela');
      gb.polygon(a.p, 0.1, isPlaza ? plaza : a.k === 'cemetery' ? cem : park);
      this.occPoly(a.p, 3);
      const c = centroid(a.p);
      if (a.n) this.places[a.n] = c;
    }
    const mesh = new THREE.Mesh(gb.geometry(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    mesh.receiveShadow = true; this.scene.add(mesh);
  }

  buildOsmBuildings() {
    const facade = this.facadeMat || (this.facadeMat = makeFacadeMaterial());
    const skip = /Convento|Palacio|Parroqu|Quiosco|Claustros|Mercadito|Relojer/;
    const geos = [];
    for (const b of map.buildings) {
      if (skip.test(b.n)) continue;
      const pts = b.p; if (pts.length < 6) continue;
      const shape = new THREE.Shape();
      for (let i = 0; i < pts.length; i += 2) (i ? shape.lineTo : shape.moveTo).call(shape, pts[i], -pts[i + 1]);
      const h = (b.lv || (b.k === 'hotel' ? 3 : 2)) * 3.2 + 0.4;
      const g = new THREE.ExtrudeGeometry(shape, { depth: h + 2.5, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const cc = centroid(pts); g.translate(0, groundY(cc[0], cc[1]) - 2.5, 0);
      geos.push(g);
      const o = fitObb(pts);
      this.addBox(o.x, o.z, o.hw, o.hd, o.a, h);
      this.occPoly(pts, 2);
    }
    if (geos.length) {
      for (const g of geos) { g.deleteAttribute('uv'); }
      const merged = mergeSimple(geos);
      const mat = makeFacadeMaterial(); mat.color.set(0xf1e6d2);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  buildHouses() {
    const r = rng(20261120);
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const vc = () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    const walls = new ChunkedInstances(this.scene, box, this.facadeMat || (this.facadeMat = makeFacadeMaterial()), { name: 'casas' });
    const roofs = new ChunkedInstances(this.scene, gableGeometry(), makeRoofMaterial(), { name: 'tejados' });
    const tank = coloredMerge([[new THREE.CylinderGeometry(0.55, 0.6, 1.2, 10).translate(0, 0.6, 0), 0x2b2b2e], [new THREE.CylinderGeometry(0.25, 0.3, 0.12, 8).translate(0, 1.26, 0), 0x2b2b2e]]);
    const tanks = new ChunkedInstances(this.scene, tank, vc(), { name: 'tinacos', castShadow: false, receiveShadow: false, maxDist: 220 });
    const slabs = new ChunkedInstances(this.scene, box, toon(0xd9d2c5), { name: 'azoteas', castShadow: false });
    // Detalles de fachada
    const balcSlab = new ChunkedInstances(this.scene, box, toon(0xd8cfc0), { name: 'balcones', maxDist: 200 });
    const rails = new ChunkedInstances(this.scene, box, makeRailingMaterial(), { name: 'herreria', castShadow: false, maxDist: 180 });
    const awning = new THREE.BufferGeometry();
    awning.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 1, 0, 0.5, 1, 0, 0.5, 0, 1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 1, 0.5, -0.18, 1, -0.5, -0.18, 1], 3));
    awning.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]); awning.computeVertexNormals();
    const awnings = new ChunkedInstances(this.scene, awning, toon(0xffffff, { side: THREE.DoubleSide }), { name: 'toldos', maxDist: 220 });
    const signs = new ChunkedInstances(this.scene, new THREE.PlaneGeometry(1, 1), makeSignMaterial(), { name: 'letreros', castShadow: false, maxDist: 200 });
    const arch = coloredMerge([
      [new THREE.BoxGeometry(0.55, 3.0, 0.55).translate(-1.7, 1.5, 0), 0xf1e6d2],
      [new THREE.BoxGeometry(0.75, 0.3, 0.75).translate(-1.7, 0.15, 0), 0x9a8f80],
      [new THREE.BoxGeometry(3.4, 0.55, 0.6).translate(0, 3.25, 0), 0xf1e6d2],
      [new THREE.BoxGeometry(3.4, 0.2, 2.2).translate(0, 3.6, -0.9), 0xb5532f],
    ]);
    const arches = new ChunkedInstances(this.scene, arch, vc(), { name: 'portales' });
    const antenna = coloredMerge([[new THREE.CylinderGeometry(0.03, 0.03, 2.4, 4).translate(0, 1.2, 0), 0x777777], [new THREE.BoxGeometry(1.2, 0.03, 0.03).translate(0, 2.1, 0), 0x777777], [new THREE.BoxGeometry(0.8, 0.03, 0.03).translate(0, 1.7, 0), 0x777777]]);
    const antennas = new ChunkedInstances(this.scene, antenna, vc(), { name: 'antenas', castShadow: false, maxDist: 180 });
    this.chunked.push(walls, roofs, tanks, slabs, balcSlab, rails, awnings, signs, arches, antennas);

    const awnCols = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0xff7043, 0x8e24aa, 0x26c6da];
    const zoc = this.places['Zócalo'] || [0, 0];
    const qFace = new THREE.Quaternion();
    let count = 0;
    for (const way of map.ways) {
      if (way.t > 6) continue;
      const pts = this.wayPoints(way);
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 7) continue;
        const ux = dx / L, uz = dz / L, a = Math.atan2(uz, ux);
        for (const sideSign of [1, -1]) {
          const nx = -uz * sideSign, nz = ux * sideSign;
          let s = 2;
          while (s < L - 2) {
            const W = 3.4 * (2 + Math.floor(r() * 3)) - (r() < 0.3 ? 1.7 : 0), D = 8 + r() * 6;
            const cx0 = ax + ux * (s + W / 2), cz0 = az + uz * (s + W / 2);
            const off = way.w / 2 + 2.1 + D / 2;
            const cx = cx0 + nx * off, cz = cz0 + nz * off;
            const rad = Math.hypot(cx, cz);
            const dens = rad < 650 ? 1 : clamp(1 - (rad - 650) / 700, 0.3, 1);
            if (s + W > L || cx > edgeX(cz) - 10 || r() > dens) { s += 3; continue; }
            if (!this.occBox(cx, cz, W / 2, D / 2, a, 0)) { s += 1.5; continue; }
            this.occBox(cx, cz, W / 2, D / 2, a, 1);
            const style = styleAt(cx, cz);
            const floors = style === STYLE.COLONIAL ? (r() < 0.6 ? 2 : r() < 0.75 ? 1 : 3) : style === STYLE.COMERCIAL ? (r() < 0.55 ? 2 : r() < 0.8 ? 3 : 1) : r() < 0.6 ? 1 : 2;
            const H = floors * 3.2 + 0.7, gy = groundY(cx, cz);
            _q.setFromAxisAngle(UP, -a);
            _m.compose(_p.set(cx, gy - 2.5, cz), _q, _s.set(W, H + 2.5, D));
            const rod = style === STYLE.POPULAR ? Math.floor(r() * 5) : r() < 0.7 ? 0 : 1 + Math.floor(r() * 3);
            walls.add(_m, _c.set(pick(PALETTES[style], r)), [rod, style, floors, r()]);
            const teja = style === STYLE.COLONIAL ? r() < 0.85 : style === STYLE.COMERCIAL ? r() < 0.4 : r() < 0.3;
            if (teja) {
              _m.compose(_p.set(cx, gy + H - 0.05, cz), _q, _s.set(W + 0.9, 1.3 + r() * 0.7, D + 0.9));
              roofs.add(_m, _c.set(pick(TEJAS, r)));
            } else {
              _m.compose(_p.set(cx, gy + H, cz), _q, _s.set(W + 0.15, 0.22, D + 0.15));
              slabs.add(_m);
              const ca = Math.cos(a), sa = Math.sin(a);
              const roofPt = () => { const u = (r() - 0.5) * (W - 2), v = (r() - 0.5) * (D - 2); return [cx + ca * u - sa * v, cz + sa * u + ca * v]; };
              if (r() < 0.7) { const [tx, tz] = roofPt(); _m.compose(_p.set(tx, gy + H + 0.22, tz), _q, _s.set(1, 1, 1)); tanks.add(_m); }
              if (style === STYLE.POPULAR && r() < 0.35) { const [tx, tz] = roofPt(); _m.compose(_p.set(tx, gy + H + 0.22, tz), _q, _s.set(1, 1, 1)); antennas.add(_m); }
            }
            // ---- Detalles de la fachada que da a la calle ----
            const fz = -sideSign; // la cara local -z mira a la calle cuando sideSign = 1
            const axX = Math.cos(a), axZ = Math.sin(a), azX = -Math.sin(a), azZ = Math.cos(a);
            const at = (u, v, y) => _p.set(cx + axX * u + azX * v, gy + y, cz + axZ * u + azZ * v);
            qFace.setFromAxisAngle(UP, -a + (fz < 0 ? Math.PI : 0));
            for (let col = Math.floor((-W / 2 + 1.0) / 3.4 + 0.5); col * 3.4 < W / 2 - 1.0; col++) {
              const uc = col * 3.4;
              if (Math.abs(uc) > W / 2 - 1.0) continue;
              if (style === STYLE.COLONIAL && floors >= 2) {
                for (let fl = 1; fl < floors; fl++) {
                  if (r() < 0.25) continue;
                  _m.compose(at(uc, fz * (D / 2 + 0.3), fl * 3.2 + 0.02), _q, _s.set(1.7, 0.14, 0.6)); balcSlab.add(_m);
                  _m.compose(at(uc, fz * (D / 2 + 0.58), fl * 3.2 + 0.16), _q, _s.set(1.7, 1.0, 0.04)); rails.add(_m);
                }
              }
              if (style === STYLE.COMERCIAL && r() < 0.6) {
                _m.compose(at(uc, fz * (D / 2), 2.3), qFace, _s.set(2.9, 0.75, 1.1)); awnings.add(_m, _c.set(pick(awnCols, r)));
              }
            }
            if (style === STYLE.COMERCIAL && r() < 0.75) {
              _m.compose(at(0, fz * (D / 2 + 0.04), 3.1), qFace, _s.set(Math.min(W - 1.2, 4.2), 0.7, 1));
              signs.add(_m, null, [Math.floor(r() * SHOPS.length), 0, 0, 0]);
            }
            // Portales con arcos frente al zócalo
            if (Math.hypot(cx - zoc[0], cz - zoc[1]) < 85 && style === STYLE.COLONIAL) {
              for (let u = -W / 2 + 1.7; u <= W / 2 + 0.1; u += 3.4) { _m.compose(at(u, fz * (D / 2 + 1.9), 0), qFace, _s.set(1, 1, 1)); arches.add(_m); }
            }
            this.addBox(cx, cz, W / 2, D / 2, a, H);
            count++;
            s += W + (style === STYLE.POPULAR ? r() * 3 : 0.05);
          }
        }
      }
    }
    this.houseCount = count;
  }

  buildTrees() {
    const r = rng(77);
    // Pino de la sierra (cono doble) y árbol frondoso (icosaedro) con colores por vértice.
    const pine = coloredMerge([
      [new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6).translate(0, 1.1, 0), 0x6b4a2f],
      [new THREE.ConeGeometry(2.2, 4.5, 7).translate(0, 4.2, 0), 0x2f6b3c],
      [new THREE.ConeGeometry(1.6, 3.6, 7).translate(0, 6.6, 0), 0x3a7d45],
    ]);
    const leafy = coloredMerge([
      [new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6).translate(0, 1.3, 0), 0x6b4a2f],
      [new THREE.CylinderGeometry(0.09, 0.12, 1.4, 5).rotateZ(0.7).translate(0.5, 2.6, 0), 0x6b4a2f],
      [new THREE.IcosahedronGeometry(1.8, 0).translate(0, 4.0, 0), 0x5f9e3b],
      [new THREE.IcosahedronGeometry(1.3, 0).translate(1.3, 3.5, 0.4), 0x6fb046],
      [new THREE.IcosahedronGeometry(1.2, 0).translate(-1.1, 3.6, -0.6), 0x4f8a33],
      [new THREE.IcosahedronGeometry(1.0, 0).translate(0.2, 5.1, 0.3), 0x7cbd50],
    ]);
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    const pines = new ChunkedInstances(this.scene, pine, mat, { name: 'pinos' });
    const trees = new ChunkedInstances(this.scene, leafy, mat, { name: 'arboles', maxDist: 320 });
    this.chunked.push(pines, trees);
    const add = (set, x, z, s) => { _q.setFromAxisAngle(UP, r() * 6.28); _m.compose(_p.set(x, heightAt(x, z) - 0.2, z), _q, _s.set(s, s * (0.85 + r() * 0.4), s)); set.add(_m); };
    // Barranca y sierra
    let n = 0;
    for (let i = 0; i < 40000 && n < 3200; i++) {
      const x = (r() - 0.5) * 3600, z = (r() - 0.5) * 3600;
      const h = heightAt(x, z);
      const m = Math.max(Math.abs(x), Math.abs(z));
      if ((x > edgeX(z) + 6 && h < -8) || m > map.limit + 40) { add(pines, x, z, 0.9 + r() * 0.8); n++; }
    }
    // Parques y zócalo
    for (const a of map.areas) {
      const bb = bbox(a.p);
      const cnt = Math.min(40, Math.floor(((bb[2] - bb[0]) * (bb[3] - bb[1])) / 140));
      for (let i = 0; i < cnt * 3 && i < 400; i++) {
        const x = bb[0] + r() * (bb[2] - bb[0]), z = bb[1] + r() * (bb[3] - bb[1]);
        if (!pointInPoly(x, z, a.p) || r() < 0.6) continue;
        if (a.n === 'Zócalo' && Math.hypot(x - this.places['Zócalo'][0], z - this.places['Zócalo'][1]) < 14) continue;
        add(trees, x, z, 0.8 + r() * 0.4);
        this.addBox(x, z, 0.4, 0.4, 0, 3, 'tree');
      }
    }
    // Huertos de manzanos y árboles en patios libres
    for (let i = 0; i < 30000; i++) {
      const x = (r() - 0.5) * 2200, z = (r() - 0.5) * 2200;
      if (x > edgeX(z) - 8) continue;
      if (!this.occBox(x, z, 2, 2, 0, 0)) continue;
      const rad = Math.hypot(x, z);
      if (r() > (rad < 500 ? 0.04 : 0.25)) continue;
      this.occBox(x, z, 2, 2, 0, 1, 4);
      add(r() < 0.35 ? pines : trees, x, z, 0.7 + r() * 0.5);
      this.addBox(x, z, 0.4, 0.4, 0, 3, 'tree');
    }
  }

  buildLamps() {
    const pole = coloredMerge([
      [new THREE.CylinderGeometry(0.09, 0.12, 4.2, 6).translate(0, 2.1, 0), 0x1d1f24],
      [new THREE.BoxGeometry(0.1, 0.1, 0.9).translate(0, 4.1, 0.4), 0x1d1f24],
    ]);
    const head = new THREE.BoxGeometry(0.42, 0.55, 0.42).translate(0, 3.85, 0.85);
    this.lampMat = new THREE.MeshToonMaterial({ color: 0xfff1c4, emissive: 0xffc85a, emissiveIntensity: 0, gradientMap });
    const poles = new ChunkedInstances(this.scene, pole, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }), { name: 'postes', castShadow: false });
    const heads = new ChunkedInstances(this.scene, head, this.lampMat, { name: 'faroles', castShadow: false });
    this.chunked.push(poles, heads);
    this.lampPositions = [];
    for (const way of map.ways) {
      if (way.t > 4) continue;
      const pts = this.wayPoints(way);
      let acc = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        for (let s = (30 - acc) % 30; s < L; s += 30) {
          const off = way.w / 2 + 1.0;
          const x = ax + ux * s - uz * off, z = az + uz * s + ux * off;
          if (x > edgeX(z) - 4) continue;
          _q.setFromAxisAngle(UP, Math.atan2(uz, -ux));
          _m.compose(_p.set(x, groundY(x, z), z), _q, _s.set(1, 1, 1));
          poles.add(_m); heads.add(_m);
          this.lampPositions.push(x, z);
        }
        acc = (acc + L) % 30;
      }
    }
  }

  // Bancas y jardineras en plazas; postes de luz con cables colgantes en calles de barrio.
  buildFurniture() {
    const r = rng(555);
    const vc = () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    const bench = coloredMerge([
      [new THREE.BoxGeometry(1.8, 0.08, 0.45).translate(0, 0.45, 0), 0x8d5a2b], [new THREE.BoxGeometry(1.8, 0.4, 0.07).translate(0, 0.75, -0.2), 0x8d5a2b],
      [new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(-0.8, 0.22, 0), 0x1d1f24], [new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(0.8, 0.22, 0), 0x1d1f24],
    ]);
    const planter = coloredMerge([
      [new THREE.CylinderGeometry(0.75, 0.65, 0.55, 8).translate(0, 0.27, 0), 0xb5532f],
      [new THREE.IcosahedronGeometry(0.42, 0).translate(-0.25, 0.75, 0), 0xe53950], [new THREE.IcosahedronGeometry(0.38, 0).translate(0.3, 0.7, 0.15), 0xfdd835],
      [new THREE.IcosahedronGeometry(0.4, 0).translate(0, 0.72, -0.3), 0x8e44ad], [new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.6, 0.1), 0x4f8a33],
    ]);
    const benches = new ChunkedInstances(this.scene, bench, vc(), { name: 'bancas', castShadow: false, maxDist: 160 });
    const planters = new ChunkedInstances(this.scene, planter, vc(), { name: 'jardineras', castShadow: false, maxDist: 180 });
    const pole = coloredMerge([[new THREE.CylinderGeometry(0.12, 0.17, 8, 6).translate(0, 4, 0), 0x9e9a90], [new THREE.BoxGeometry(1.6, 0.12, 0.12).translate(0, 7.4, 0), 0x6b6b6b], [new THREE.CylinderGeometry(0.22, 0.22, 0.6, 6).translate(0.5, 6.8, 0), 0x777777]]);
    const poles = new ChunkedInstances(this.scene, pole, vc(), { name: 'postes-cfe', castShadow: false, maxDist: 300 });
    this.chunked.push(benches, planters, poles);
    for (const a of map.areas) {
      if (a.k !== 'park') continue;
      const pts = a.p; let n = 0;
      for (let i = 0; i < pts.length - 2 && n < 30; i += 2) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], L = Math.hypot(bx - ax, bz - az);
        const ang = Math.atan2(bz - az, bx - ax);
        for (let s = 4; s < L - 3; s += 9) {
          const ux = (bx - ax) / L, uz = (bz - az) / L, cx = centroid(pts);
          let px = ax + ux * s, pz = az + uz * s;
          const tx = cx[0] - px, tz = cx[1] - pz, tl = Math.hypot(tx, tz) || 1; px += (tx / tl) * 2.2; pz += (tz / tl) * 2.2;
          _q.setFromAxisAngle(UP, Math.atan2(tx, tz) + Math.PI);
          _m.compose(_p.set(px, groundY(px, pz), pz), _q, _s.set(1, 1, 1));
          (r() < 0.6 ? benches : planters).add(_m); n++;
          if (r() < 0.6) this.addBox(px, pz, 0.9, 0.3, ang, 1, 'tree');
        }
      }
    }
    // Postes de concreto cada ~34 m, del lado opuesto a los faroles, con cables con catenaria
    const cable = [];
    for (const way of map.ways) {
      if (way.t > 4 || way.w < 6) continue;
      const pts = densify(this.wayPoints(way), 34), mid = pts[Math.floor(pts.length / 2)];
      if (Math.hypot(mid[0], mid[1]) < 200) continue;
      let prev = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1;
        const ux = (bx - ax) / L, uz = (bz - az) / L, off = -(way.w / 2 + 1.1);
        const x = ax - uz * off, z = az + ux * off;
        if (x > edgeX(z) - 4 || this.occAt(x, z) === 2) { prev = null; continue; }
        const gy = groundY(x, z);
        _q.setFromAxisAngle(UP, Math.atan2(-ux, -uz)); // cruceta perpendicular a la calle
        _m.compose(_p.set(x, gy, z), _q, _s.set(1, 1, 1)); poles.add(_m);
        const top = [x, gy + 7.3, z];
        if (prev) for (const k of [-0.7, 0, 0.7]) {
          const ox = -uz * k, oz = ux * k;
          for (let t = 0; t < 6; t++) {
            const t0 = t / 6, t1 = (t + 1) / 6, sag = (u) => -1.1 * 4 * u * (1 - u);
            cable.push(prev[0] + (top[0] - prev[0]) * t0 + ox, prev[1] + (top[1] - prev[1]) * t0 + sag(t0), prev[2] + (top[2] - prev[2]) * t0 + oz,
              prev[0] + (top[0] - prev[0]) * t1 + ox, prev[1] + (top[1] - prev[1]) * t1 + sag(t1), prev[2] + (top[2] - prev[2]) * t1 + oz);
          }
        }
        prev = top;
      }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cable, 3));
    this.cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
    this.scene.add(this.cables);
  }

  updateVisibility(px, pz, maxDist) { for (const c of this.chunked) c.updateVisibility(px, pz, maxDist); }

  // ¿El segmento a→b (a altura y) cruza algún edificio? Muestreo cada 2.5 m.
  segmentBlocked(ax, az, bx, bz, y = 1.5, out = null) {
    const L = Math.hypot(bx - ax, bz - az), steps = Math.ceil(L / 2.5), tmp = this._tmp || (this._tmp = []);
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const n = this.grid.query(x, z, 0.1, tmp);
      for (let k = 0; k < n; k++) {
        const b = tmp[k];
        if (b.h < y || b.kind === 'tree') continue;
        const dx = x - b.x, dz = z - b.z;
        if (Math.abs(dx * b.c + dz * b.s) < b.hw && Math.abs(-dx * b.s + dz * b.c) < b.hd) { if (out) out.t = t; return true; }
      }
    }
    return false;
  }
}

// ---------- Utilidades de geometría ----------
export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Subdivide una polilínea para que siga el relieve (tramos de a lo más `step` m).
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.ceil(Math.hypot(bx - ax, bz - az) / step);
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}
export function centroid(p) { let x = 0, z = 0; const n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; }
function bbox(p) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; }

export function fitObb(p) {
  let best = 0, ang = 0;
  for (let i = 0; i < p.length - 2; i += 2) { const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); if (L > best) { best = L; ang = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]); } }
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { const u = p[i] * c + p[i + 1] * s, v = -p[i] * s + p[i + 1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return { x: uc * c - vc * s, z: uc * s + vc * c, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, a: ang };
}

function gableGeometry() {
  // Prisma de base 1×1, cumbrera a lo largo de x, altura 1.
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // faldón norte
    -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, 0.5, 0, 0.5, // faldón sur
    -0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5, // hastial oeste
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0, // hastial este
  ];
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Une geometrías asignando un color plano por pieza (atributo "color").
export function coloredMerge(parts) {
  const geos = parts.map(([g, color]) => {
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  return mergeSimple(geos);
}

export function mergeSimple(geos) {
  geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const attrs = Object.keys(geos[0].attributes).filter((k) => geos.every((g) => g.attributes[k]));
  const out = new THREE.BufferGeometry();
  for (const k of attrs) {
    const size = geos[0].attributes[k].itemSize;
    const total = geos.reduce((s, g) => s + g.attributes[k].count * size, 0);
    const arr = new Float32Array(total); let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].count * size; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

// Constructor de cintas (calles), polígonos y líneas discontinuas con color por vértice.
class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  v(x, y, z, c) { this.pos.push(x, y + groundY(x, z), z); this.col.push(c.r, c.g, c.b); return this.pos.length / 3 - 1; }
  ribbon(pts, w, y, c) {
    pts = densify(pts, 6);
    const n = pts.length, hw = w / 2;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      let nx = -dz, nz = dx, scale = 1;
      if (i > 0 && i < n - 1) {
        const d1x = p[0] - a[0], d1z = p[1] - a[1], L1 = Math.hypot(d1x, d1z) || 1;
        const cos = (nx * -d1z + nz * d1x) / L1; scale = 1 / Math.max(0.5, cos);
      }
      const l = this.v(p[0] - nx * hw * scale, y, p[1] - nz * hw * scale, c);
      this.v(p[0] + nx * hw * scale, y, p[1] + nz * hw * scale, c);
      if (prev >= 0) this.idx.push(prev, l, prev + 1, prev + 1, l, l + 1);
      prev = l;
    }
    // Remates circulares simples en los extremos para que las esquinas se vean continuas
    for (const p of [pts[0], pts[n - 1]]) {
      const ctr = this.v(p[0], y, p[1], c), seg = 6;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const i0 = this.v(p[0] + Math.cos(a0) * hw, y, p[1] + Math.sin(a0) * hw, c), i1 = this.v(p[0] + Math.cos(a1) * hw, y, p[1] + Math.sin(a1) * hw, c);
        this.idx.push(ctr, i1, i0);
      }
    }
  }
  dashes(pts, w, y, c, dash, gap) {
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let s = carry; s < L; s += dash + gap) {
        const e = Math.min(L, s + dash);
        this.ribbonSeg(ax + ux * s, az + uz * s, ax + ux * e, az + uz * e, w, y, c);
      }
      carry = (carry - L) % (dash + gap); if (carry < 0) carry += dash + gap;
    }
  }
  ribbonSeg(ax, az, bx, bz, w, y, c) {
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / L) * w / 2, nz = ((bx - ax) / L) * w / 2;
    const i = this.v(ax - nx, y, az - nz, c); this.v(ax + nx, y, az + nz, c); this.v(bx - nx, y, bz - nz, c); this.v(bx + nx, y, bz + nz, c);
    this.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }
  // Guarnición: franja elevada con cara vertical hacia el arroyo vehicular; se interrumpe en las esquinas.
  curb(pts, offset, width, height, c, cut) {
    pts = densify(pts, 6);
    const sg = Math.sign(offset) || 1;
    const near = (p) => cut.some(([x, z, r]) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < r * r);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (near(a) || near(b)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      const i0 = [a[0] + nx * offset, a[1] + nz * offset], i1 = [b[0] + nx * offset, b[1] + nz * offset];
      const o0 = [i0[0] + nx * sg * width, i0[1] + nz * sg * width], o1 = [i1[0] + nx * sg * width, i1[1] + nz * sg * width];
      let k = this.v(i0[0], height, i0[1], c); this.v(i1[0], height, i1[1], c); this.v(o1[0], height, o1[1], c); this.v(o0[0], height, o0[1], c);
      this.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      k = this.v(i0[0], 0.06, i0[1], c); this.v(i1[0], 0.06, i1[1], c); this.v(i1[0], height, i1[1], c); this.v(i0[0], height, i0[1], c);
      this.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  }
  polygon(p, y, c) {
    const contour = []; for (let i = 0; i < p.length; i += 2) contour.push(new THREE.Vector2(p[i], p[i + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.pos.length / 3;
    for (const v of contour) this.v(v.x, y, v.y, c);
    for (const t of tris) this.idx.push(base + t[0], base + t[2], base + t[1]);
  }
  geometry(keepNormals = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // Todas las superficies del suelo miran hacia arriba
    if (keepNormals) return g.index ? g.toNonIndexed() : g;
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    return g;
  }
}
export { GeoBuilder };
