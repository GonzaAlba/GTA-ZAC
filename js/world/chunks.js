import * as THREE from 'three';

// Agrupa instancias estáticas por celdas de CHUNK metros: cada celda es un InstancedMesh
// con su propia esfera envolvente (frustum culling real) y se oculta por distancia.
// Admite un atributo por instancia `aExtra` (vec4) para que los shaders varíen el estilo.
export const CHUNK = 260;

export class ChunkedInstances {
  constructor(scene, geometry, material, { castShadow = true, receiveShadow = true, name = '', maxDist = Infinity } = {}) {
    this.scene = scene; this.geometry = geometry; this.material = material;
    this.cast = castShadow; this.receive = receiveShadow; this.name = name; this.maxDist = maxDist;
    this.buckets = new Map(); // key -> {mats:[], cols:[], ext:[]}
    this.meshes = [];
  }
  add(matrix, color, extra) {
    const p = matrix.elements;
    const k = Math.floor(p[12] / CHUNK) + ',' + Math.floor(p[14] / CHUNK);
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = { mats: [], cols: [], ext: [] }));
    b.mats.push(matrix.clone()); b.cols.push(color ? color.clone() : null); b.ext.push(extra || null);
  }
  get count() { let n = 0; for (const b of this.buckets.values()) n += b.mats.length; for (const m of this.meshes) n += m.count; return n; }
  build() {
    for (const [k, b] of this.buckets) {
      let geo = this.geometry;
      if (b.ext.some(Boolean)) {
        // Geometría propia por chunk (comparte vértices) para alojar el atributo por instancia
        geo = new THREE.BufferGeometry();
        for (const [n, a] of Object.entries(this.geometry.attributes)) geo.setAttribute(n, a);
        if (this.geometry.index) geo.setIndex(this.geometry.index);
        const arr = new Float32Array(b.ext.length * 4);
        b.ext.forEach((e, i) => { if (e) arr.set(e, i * 4); });
        geo.setAttribute('aExtra', new THREE.InstancedBufferAttribute(arr, 4));
      }
      const m = new THREE.InstancedMesh(geo, this.material, b.mats.length);
      b.mats.forEach((mt, i) => { m.setMatrixAt(i, mt); if (b.cols[i]) m.setColorAt(i, b.cols[i]); });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.castShadow = this.cast; m.receiveShadow = this.receive;
      m.name = this.name + ':' + k;
      const [cx, cz] = k.split(',').map(Number);
      m.userData.cx = (cx + 0.5) * CHUNK; m.userData.cz = (cz + 0.5) * CHUNK;
      this.scene.add(m);
      this.meshes.push(m);
    }
    this.buckets.clear();
    return this;
  }
  updateVisibility(px, pz, maxDist) {
    const lim = (Math.min(maxDist, this.maxDist) + CHUNK * 0.75) ** 2;
    for (const m of this.meshes) m.visible = (m.userData.cx - px) ** 2 + (m.userData.cz - pz) ** 2 < lim;
  }
}
