// Edificios emblemáticos de Zacatlán modelados a mano en low-poly + servicios del juego.
import * as THREE from 'three';
import map from './mapData.js';
import { coloredMerge, fitObb, centroid } from './cityBuilder.js';
import { gradientMap, shared, toon } from './materials.js';
import { edgeX, heightAt, groundY } from './terrain.js';

const vcMat = () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });

// Lista de piezas que se fusionan en una sola malla (1 draw call por monumento).
class Parts {
  constructor() { this.list = []; }
  add(g, color, x = 0, y = 0, z = 0, ry = 0) { if (ry) g.rotateY(ry); g.translate(x, y, z); this.list.push([g, color]); return this; }
  box(w, h, d, x, y, z, color, ry = 0) { return this.add(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, x, y, z, ry); }
  cyl(rt, rb, h, x, y, z, color, seg = 10) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0), color, x, y, z); }
  cone(r, h, x, y, z, color, seg = 10) { return this.add(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), color, x, y, z); }
  dome(r, x, y, z, color) { return this.add(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, x, y, z); }
  mesh(x, z, a, y) {
    const m = new THREE.Mesh(coloredMerge(this.list), vcMat());
    m.position.set(x, y ?? groundY(x, z) - 0.6, z); m.rotation.y = -a;
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

function canvasSign(text, bg = '#b5532f', fg = '#fff8e6', w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg; g.font = `bold ${Math.floor(h * 0.42)}px "Bangers", "Arial Black", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w / 64, h / 64), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
}

export class Landmarks {
  constructor(scene) { this.scene = scene; this.updaters = []; this.mirador = null; }

  byName(re) { const b = map.buildings.find((b) => re.test(b.n)); return b ? fitObb(b.p) : null; }

  build(world) {
    this.world = world;
    const S = this.scene;
    const add = (mesh, o, h = 10, pad = 0) => {
      S.add(mesh);
      world.addBox(o.x, o.z, o.hw + pad, o.hd + pad, o.a, h, 'landmark');
      world.occBox(o.x, o.z, o.hw + 2, o.hd + 2, o.a, 1, 3);
    };

    // --- Parroquia de San Pedro y San Pablo ---
    let o = this.byName(/Parroqu/);
    if (o) {
      const L = Math.max(o.hw, o.hd), Wd = Math.min(o.hw, o.hd);
      const p = new Parts();
      const long = o.hw >= o.hd; // nave a lo largo del eje local x
      const nave = (w, h, d, x, y, z, c) => long ? p.box(w, h, d, x, y, z, c) : p.box(d, h, w, z, y, x, c);
      nave(L * 2, 13, Wd * 2, 0, 0, 0, 0xf2e2bd);
      nave(L * 2 + 0.4, 0.8, Wd * 2 + 0.4, 0, 13, 0, 0xb5532f);
      const fx = -L + 2.5;
      for (const s of [-1, 1]) {
        const tx = fx, tz = s * (Wd - 2);
        const [X, Z] = long ? [tx, tz] : [tz, tx];
        p.box(5, 20, 5, X, 0, Z, 0xf7ecd2).box(5.4, 0.6, 5.4, X, 20, Z, 0xb5532f);
        p.box(3.6, 4, 3.6, X, 20.6, Z, 0xf7ecd2).dome(2, X, 24.6, Z, 0xe0b04a).box(0.25, 2, 0.25, X, 26.4, Z, 0x333333);
      }
      const [DX, DZ] = long ? [L * 0.35, 0] : [0, L * 0.35];
      p.cyl(4.2, 4.2, 4, DX, 13.6, DZ, 0xf7ecd2, 14).dome(4.4, DX, 17.6, DZ, 0xe0b04a).box(0.3, 3, 0.3, DX, 21.6, DZ, 0x333333);
      const [PX, PZ] = long ? [-L - 0.05, 0] : [0, -L - 0.05];
      p.box(long ? 0.3 : 4, 6, long ? 4 : 0.3, PX, 0, PZ, 0x6b3b22);
      add(p.mesh(o.x, o.z, o.a), o, 20);
      world.places['Parroquia'] = [o.x, o.z];
    }

    // --- Ex-Convento Franciscano (s. XVI) ---
    o = this.byName(/Convento/);
    if (o) {
      const p = new Parts(); const long = o.hw >= o.hd, L = Math.max(o.hw, o.hd), Wd = Math.min(o.hw, o.hd);
      const B = (w, h, d, x, y, z, c) => long ? p.box(w, h, d, x, y, z, c) : p.box(d, h, w, z, y, x, c);
      B(L * 2, 11, Wd * 2, 0, 0, 0, 0xbca78a);
      B(L * 2 + 0.3, 0.6, Wd * 2 + 0.3, 0, 11, 0, 0x8f7b62);
      for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) B(1.4, 9, 1.4, i * (L / 2.6), 0, s * (Wd + 0.6), 0xa8937a); // contrafuertes
      B(1.2, 7, Wd * 1.2, -L + 0.4, 11, 0, 0xbca78a); // espadaña
      B(1.4, 0.6, 1.4, -L + 0.4, 18, 0, 0x8f7b62);
      B(0.3, 5.5, 3.6, -L - 0.05, 0, 0, 0x5a3520);
      add(p.mesh(o.x, o.z, o.a), o, 15);
      world.places['Ex-Convento'] = [o.x, o.z];
    }

    // --- Palacio Municipal con portales ---
    o = this.byName(/Palacio/);
    if (o) {
      const p = new Parts(); const long = o.hw >= o.hd, L = Math.max(o.hw, o.hd), Wd = Math.min(o.hw, o.hd);
      const B = (w, h, d, x, y, z, c) => long ? p.box(w, h, d, x, y, z, c) : p.box(d, h, w, z, y, x, c);
      B(L * 2, 9, Wd * 2 - 3, 0, 0, 1.5, 0xd2a789);
      B(L * 2, 0.8, Wd * 2, 0, 4.2, 0, 0xc29a7c); // losa del portal
      const n = Math.max(4, Math.round(L / 2));
      for (let i = 0; i <= n; i++) B(0.7, 4.2, 0.7, -L + 0.4 + (i * (2 * L - 0.8)) / n, 0, -Wd + 0.4, 0xe9d6c0);
      B(L * 2 + 0.4, 0.7, Wd * 2 + 0.4, 0, 9, 0, 0x8c4a33);
      B(4, 4, 3, 0, 9.7, 0, 0xd2a789); B(2.2, 2.2, 0.2, 0, 10.6, -1.6, 0xfaf3e0);
      add(p.mesh(o.x, o.z, o.a), o, 10);
      world.places['Palacio Municipal'] = [o.x, o.z];
      const sign = canvasSign('PALACIO MUNICIPAL', '#8c4a33');
      sign.position.set(o.x, 7.2 + groundY(o.x, o.z) - 0.6, o.z); sign.rotation.y = -o.a + (long ? Math.PI : -Math.PI / 2);
      S.add(sign);
    }

    // --- Quiosco del zócalo ---
    o = this.byName(/Quiosco/);
    const zoc = world.places['Zócalo'] || [0, 0];
    const kx = o ? o.x : zoc[0], kz = o ? o.z : zoc[1];
    {
      const p = new Parts();
      p.cyl(6, 6.4, 1.2, 0, 0, 0, 0xe6dccb, 8);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.cyl(0.18, 0.18, 4, Math.cos(a) * 5.3, 1.2, Math.sin(a) * 5.3, 0x3e6b4b, 6); }
      p.cyl(6.3, 6.3, 0.5, 0, 5.2, 0, 0x3e6b4b, 8).cone(6.6, 3.2, 0, 5.7, 0, 0x6aa36f, 8).cyl(0.5, 0.5, 1.2, 0, 8.8, 0, 0xe0b04a, 8);
      S.add(p.mesh(kx, kz, 0));
      world.addBox(kx, kz, 4.6, 4.6, 0, 1.2, 'kiosk');
      world.places['Quiosco'] = [kx, kz];
    }

    // --- Reloj Floral (manecillas sincronizadas con la hora del juego) ---
    {
      const rx = zoc[0] + 2, rz = zoc[1] + 26;
      const grp = new THREE.Group(); grp.position.set(rx, groundY(rx, rz) - 0.3, rz);
      const p = new Parts();
      p.cyl(5.6, 6, 0.8, 0, 0, 0, 0x8a7a68, 24);
      const rings = [[5.2, 0xd8343f], [4.4, 0xf2c84b], [3.6, 0x8e44ad], [2.8, 0xf6f1e7], [2.0, 0xe56b9a], [1.2, 0x5fae3a]];
      rings.forEach(([r, c], i) => p.cyl(r, r, 0.3 + i * 0.05, 0, 0.8, 0, c, 28));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; p.box(0.5, 0.5, 0.9, Math.sin(a) * 4.8, 1.0, -Math.cos(a) * 4.8, 0xffffff, -a); }
      const face = p.mesh(0, 0, 0, 0); face.rotation.x = -0.45;
      const handM = toon(0x1d1f24);
      const hour = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 3).translate(0, 0, -1.5), handM);
      const minute = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 4.4).translate(0, 0, -2.2), handM);
      hour.position.y = minute.position.y = 1.35; minute.position.y = 1.45;
      face.add(hour, minute);
      grp.add(face);
      grp.rotation.y = Math.PI; // la carátula mira a la calle (sur)
      S.add(grp);
      world.addBox(rx, rz, 5.8, 5.8, 0, 2, 'landmark');
      world.places['Reloj Floral'] = [rx, rz];
      this.updaters.push((dt, minutes) => {
        minute.rotation.y = -((minutes % 60) / 60) * Math.PI * 2;
        hour.rotation.y = -(((minutes / 60) % 12) / 12) * Math.PI * 2;
      });
    }

    // --- Museo de Relojería (torre con reloj) ---
    o = this.byName(/Relojer/);
    if (o) {
      const p = new Parts();
      p.box(o.hw * 2, 7, o.hd * 2, 0, 0, 0, 0xf2dfb2).box(o.hw * 2 + 0.4, 0.5, o.hd * 2 + 0.4, 0, 7, 0, 0x9a4229);
      p.box(3.2, 6, 3.2, 0, 7.5, 0, 0xf2dfb2).box(2.4, 2.4, 0.3, 0, 10, -1.7, 0xffffff).cone(2.6, 2.5, 0, 13.5, 0, 0x9a4229, 4);
      add(p.mesh(o.x, o.z, o.a), o, 8);
      world.places['Museo de Relojería'] = [o.x, o.z];
    }

    // --- Mercado (puestos con toldos de colores) ---
    o = this.byName(/Mercadito/) || { x: -82, z: 222, hw: 9, hd: 7, a: 0 };
    {
      const p = new Parts(); const hw = Math.max(o.hw, 9), hd = Math.max(o.hd, 7);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.5, 5, 0.5, sx * (hw - 0.5), 0, sz * (hd - 0.5), 0x6b4a2f);
      p.box(hw * 2 + 1, 0.4, hd * 2 + 1, 0, 5, 0, 0xb5532f);
      const cols = [0xe8443a, 0xf2c84b, 0x2e9bd6, 0x5fae3a, 0xe56b9a, 0xff8c2a];
      let k = 0;
      for (let x = -hw + 2.5; x < hw - 1; x += 3.5) for (const z of [-hd / 2, hd / 2]) {
        p.box(2.6, 1, 1.6, x, 0, z, 0x8a6a4a).box(3, 0.15, 2.2, x, 2.4, z, cols[k++ % cols.length]);
        p.box(0.5, 0.5, 0.5, x - 0.6, 1, z, 0xd8343f).box(0.5, 0.5, 0.5, x + 0.5, 1, z, 0x7cc142); // manzanas
      }
      S.add(p.mesh(o.x, o.z, o.a));
      world.occBox(o.x, o.z, hw + 2, hd + 2, o.a, 1, 3);
      world.places['Mercado'] = [o.x, o.z];
    }

    // --- Mirador de cristal sobre la barranca ---
    {
      const mz = -21, ex = edgeX(mz) - 2.2;
      const p = new Parts();
      p.box(22, 0.4, 0.3, 11, 1.1, -2.2, 0xcfd8dc).box(22, 0.4, 0.3, 11, 1.1, 2.2, 0xcfd8dc).box(0.3, 0.4, 4.6, 22, 1.1, 0, 0xcfd8dc);
      for (let x = 0; x <= 22; x += 2) { p.box(0.15, 1.1, 0.15, x, 0, -2.2, 0x9aa4a8); p.box(0.15, 1.1, 0.15, x, 0, 2.2, 0x9aa4a8); }
      p.box(2, 0.6, 6, -1, -0.6, 0, 0x8f7b62);
      const my = groundY(ex, mz), frame = p.mesh(ex, mz, 0, my);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(22, 0.15, 4.4).translate(11, -0.08, 0), new THREE.MeshToonMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.35, gradientMap, depthWrite: false }));
      glass.position.set(ex, my, mz);
      S.add(frame, glass);
      this.mirador = { x0: ex - 3, x1: ex + 22, z0: mz - 2, z1: mz + 2 };
      world.places['Mirador de Cristal'] = [ex - 4, mz];
      world.places['Punta del Mirador'] = [ex + 18, mz];
    }

    // --- Cascada en la pared de la barranca (shader animado) ---
    {
      const cz = 236, ex = edgeX(cz);
      const g = new THREE.PlaneGeometry(9, 160, 1, 16);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime },
        transparent: true, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main(){ float s = fract(vUv.y * 7.0 + uTime * 1.6 + sin(vUv.x * 18.0) * 0.12);
            float e = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
            vec3 c = mix(vec3(0.55,0.8,0.95), vec3(1.0), step(0.55, s));
            gl_FragColor = vec4(c, 0.85 * e); }`,
      });
      const fall = new THREE.Mesh(g, mat);
      // Inclinada siguiendo la pared del cañón
      const top = new THREE.Vector3(ex + 3, groundY(ex, cz), cz), bot = new THREE.Vector3(ex + 75, heightAt(ex + 75, cz) + 1, cz);
      const yAx = top.clone().sub(bot), len = yAx.length(); yAx.normalize();
      const xAx = new THREE.Vector3(0, 0, 1), zAx = new THREE.Vector3().crossVectors(xAx, yAx);
      fall.matrixAutoUpdate = false;
      fall.matrix.makeBasis(xAx, yAx.multiplyScalar(len / 160), zAx).setPosition(top.clone().add(bot).multiplyScalar(0.5));
      mat.side = THREE.DoubleSide;
      S.add(fall);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(12, 16).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, gradientMap }));
      pool.position.copy(bot).add(new THREE.Vector3(0, 0.3, 0));
      S.add(pool);
      world.places['Cascada'] = [ex - 8, cz];
    }

    // --- Barandal de la ceja de la barranca ---
    {
      const p = new Parts();
      const lim = map.limit - 12;
      for (let z = -lim; z < lim; z += 4) {
        if (this.mirador && z > this.mirador.z0 - 2 && z < this.mirador.z1 + 2) continue;
        const x0 = edgeX(z) - 2.2, x1 = edgeX(z + 4) - 2.2;
        const gy0 = groundY(x0, z), gy1 = groundY(x1, z + 4);
        p.box(0.2, 1, 0.2, x0, gy0, z, 0x6b4a2f);
        const L = Math.hypot(x1 - x0, 4), a = Math.atan2(x1 - x0, 4);
        const rail = new THREE.BoxGeometry(0.12, 0.18, L).translate(0, 0.85, L / 2); rail.rotateX(-Math.atan2(gy1 - gy0, L));
        p.add(rail, 0x8a6a4a, x0, gy0, z, a);
      }
      S.add(p.mesh(0, 0, 0, 0));
    }

    this.buildServices(world);
  }

  // Coloca un edificio de servicio a pie de calle cerca de un punto deseado.
  findLot(world, x, z, W, D) {
    const g = world.graph;
    const cands = [];
    for (let i = 0; i < g.n; i++) if (g.degDrive[i]) cands.push([(g.x[i] - x) ** 2 + (g.z[i] - z) ** 2, i]);
    cands.sort((a, b) => a[0] - b[0]);
    for (let c = 0; c < 80 && c < cands.length; c++) {
      const a = cands[c][1];
      for (const e of g.adj[a]) {
        if (!e.drive) continue;
        const b = e.to, dx = g.x[b] - g.x[a], dz = g.z[b] - g.z[a], L = Math.hypot(dx, dz);
        if (L < W + 4) continue;
        const ux = dx / L, uz = dz / L, ang = Math.atan2(uz, ux);
        for (const t of [0.5, 0.3, 0.7]) for (const sg of [1, -1]) {
          const rx = g.x[a] + dx * t, rz = g.z[a] + dz * t;
          const off = e.width / 2 + 2.2 + D / 2;
          const cx = rx - uz * sg * off, cz = rz + ux * sg * off;
          if (cx > edgeX(cz) - 12) continue;
          if (world.occBox(cx, cz, W / 2 + 1, D / 2 + 1, ang, 0)) {
            world.occBox(cx, cz, W / 2 + 1, D / 2 + 1, ang, 1, 3);
            // frente: punto sobre la banqueta frente a la puerta
            const fx = rx - uz * sg * (e.width / 2 + 1), fz = rz + ux * sg * (e.width / 2 + 1);
            return { x: cx, z: cz, a: ang, fx, fz, rx, rz, face: Math.atan2(-(-uz * sg), -(ux * sg)) };
          }
        }
      }
    }
    return null;
  }

  service(world, name, near, W, D, H, color, label, labelBg, icon, blipColor) {
    const lot = this.findLot(world, near[0], near[1], W, D);
    if (!lot) return null;
    const p = new Parts();
    p.box(W, H, D, 0, 0, 0, color).box(W + 0.5, 0.5, D + 0.5, 0, H, 0, 0x6b4a2f);
    this.scene.add(p.mesh(lot.x, lot.z, lot.a));
    world.addBox(lot.x, lot.z, W / 2, D / 2, lot.a, H, 'landmark');
    if (label) {
      const s = canvasSign(label, labelBg);
      // Letrero en la fachada que da a la calle
      const nx = lot.fx - lot.x, nz = lot.fz - lot.z, n = Math.hypot(nx, nz);
      s.position.set(lot.x + (nx / n) * (D / 2 + 0.06), H - 1.8 + groundY(lot.x, lot.z), lot.z + (nz / n) * (D / 2 + 0.06));
      s.rotation.y = Math.atan2(nx, nz);
      this.scene.add(s);
    }
    world.places[name] = [lot.fx, lot.fz];
    world.places[name + ':road'] = [lot.rx, lot.rz];
    if (icon) world.blips.push({ x: lot.fx, z: lot.fz, icon, color: blipColor, name });
    return lot;
  }

  buildServices(world) {
    const bank = map.pois['bank:BBVA'] || [63, -8];
    this.service(world, 'Clínica', [-330, 140], 22, 12, 7, 0xf6f1e7, 'CLÍNICA SAN PEDRO', '#c62828', 'H', '#e53935');
    this.service(world, 'Taller', [-240, -160], 14, 10, 5.5, 0xd9734e, 'TALLER PINTA Y LISTO', '#1565c0', '✚', '#42a5f5');
    this.service(world, 'Banco', bank, 12, 10, 7, 0xe8dcc4, 'BANCO DE LA SIERRA', '#2e7d32', '$', '#66bb6a');
    this.service(world, 'Bodega', [295, -10], 20, 14, 6, 0xc9b79c, 'BODEGA DON CHUY', '#6d4c41', null);
    this.service(world, 'Casa', [-150, 300], 12, 10, 6.8, 0xe89bb0, 'CASA', '#ad1457', '⌂', '#f06292');
    this.service(world, 'Sidrería', [180, -330], 18, 12, 6, 0xf2c84b, 'SIDRA LA SERRANA', '#c62828', null);
    // Gasolinera: techumbre sobre columnas
    const lot = this.findLot(world, -420, -360, 18, 12);
    if (lot) {
      const p = new Parts();
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.5, 5, 0.5, sx * 6, 0, sz * 3.5, 0xeeeeee);
      p.box(15, 0.8, 9, 0, 5, 0, 0x2e7d32).box(1.2, 1.6, 0.8, -3, 0, 0, 0xd32f2f).box(1.2, 1.6, 0.8, 3, 0, 0, 0xd32f2f);
      this.scene.add(p.mesh(lot.x, lot.z, lot.a));
      world.addBox(lot.x, lot.z, 2.2, 0.6, lot.a, 2, 'landmark');
      world.places['Gasolinera'] = [lot.fx, lot.fz];
      world.blips.push({ x: lot.fx, z: lot.fz, icon: '⛽', color: '#ffb300', name: 'Gasolinera' });
    }
    // Comandancia en el Palacio Municipal
    if (world.places['Palacio Municipal']) world.blips.push({ x: world.places['Palacio Municipal'][0], z: world.places['Palacio Municipal'][1], icon: '★', color: '#5c6bc0', name: 'Comandancia' });
    world.blips.push({ x: world.places['Reloj Floral'][0], z: world.places['Reloj Floral'][1], icon: '◷', color: '#ffd54f', name: 'Reloj Floral' });
    world.blips.push({ x: world.places['Mirador de Cristal'][0], z: world.places['Mirador de Cristal'][1], icon: '◈', color: '#4fc3f7', name: 'Mirador' });
  }

  allowMirador = (x, z) => { const m = this.mirador; return m && x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1; };

  update(dt, minutes) { for (const u of this.updaters) u(dt, minutes); }
}
