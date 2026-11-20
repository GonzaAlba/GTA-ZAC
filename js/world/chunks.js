import * as THREE from 'three';

// Agrupa instancias estáticas por celdas de CHUNK metros: cada celda es un InstancedMesh
// con su propia esfera envolvente (frustum culling real) y se oculta por distancia.
export const CHUNK = 260;

export class ChunkedInstances {
  constructor(scene, geometry, material, { castShadow = true, receiveShadow = true, name = '' } = {}) {
    this.scene = scene; this.geometry = geometry; this.material = material;
    this.cast = castShadow; this.receive = receiveShadow; this.name = name;
    this.buckets = new Map(); // key -> {mats:[], cols:[]}
    this.meshes = [];
  }
  add(matrix, color) {
    const p = matrix.elements;
    const k = Math.floor(p[12] / CHUNK) + ',' + Math.floor(p[14] / CHUNK);
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = { mats: [], cols: [] }));
    b.mats.push(matrix.clone()); b.cols.push(color ? color.clone() : null);
  }
  build() {
    for (const [k, b] of this.buckets) {
      const m = new THREE.InstancedMesh(this.geometry, this.material, b.mats.length);
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
    const lim = (maxDist + CHUNK * 0.75) ** 2;
    for (const m of this.meshes) m.visible = (m.userData.cx - px) ** 2 + (m.userData.cz - pz) ** 2 < lim;
  }
}
