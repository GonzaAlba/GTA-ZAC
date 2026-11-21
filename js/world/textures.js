// Texturas PBR CC0 (Poly Haven) en assets/textures, cargadas una sola vez y en repetición.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = Math.min(8, n); for (const t of cache.values()) { t.anisotropy = maxAniso; t.needsUpdate = true; } }

// name: archivo sin extensión (p. ej. 'white_stucco_diff'); color: true para mapas de color (sRGB)
export function tex(name, color = false) {
  if (cache.has(name)) return cache.get(name);
  const t = loader.load(`./assets/textures/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(name, t);
  return t;
}

export const TEXTURE_CREDITS = 'Texturas: Poly Haven (CC0)';
