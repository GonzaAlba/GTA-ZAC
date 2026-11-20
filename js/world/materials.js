import * as THREE from 'three';

// Rampa de 3 tonos para el sombreado cel (look caricaturesco).
export const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

export const shared = { uNight: { value: 0 }, uTime: { value: 0 } };

export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });

// Material de fachada: ventanas, puertas y rodapié generados en el shader según
// las dimensiones de cada instancia (cero texturas, una sola llamada de dibujo).
export function makeFacadeMaterial() {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLoc; varying vec3 vLocN; varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
          vec3 sc = vec3(1.0); vSeed = 0.37;
        #endif
        vLoc = position * sc; vLocN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec3 vLoc; varying vec3 vLocN; varying float vSeed;
        float h1(float n){ return fract(sin(n) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winLit = 0.0;
        if (abs(vLocN.y) < 0.5) {
          float u = abs(vLocN.x) > 0.5 ? vLoc.z : vLoc.x;
          float y = vLoc.y;
          float col = floor(u / 3.4 + 0.5), flo = floor(y / 3.2);
          float fu = fract(u / 3.4 + 0.5), fy = fract(y / 3.2);
          if (y < 0.85) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.22, 0.17), 0.85);
          bool ground = flo < 0.5;
          bool hole = ground ? (fu > 0.3 && fu < 0.7 && fy < 0.74) : (fu > 0.32 && fu < 0.68 && fy > 0.3 && fy < 0.78);
          bool frame = ground ? (fu > 0.26 && fu < 0.74 && fy < 0.79) : (fu > 0.28 && fu < 0.72 && fy > 0.25 && fy < 0.83);
          float r = h1(vSeed * 91.0 + col * 7.13 + flo * 3.7);
          if (frame && !hole) diffuseColor.rgb = ground ? vec3(0.42, 0.25, 0.14) : vec3(0.95, 0.93, 0.88);
          if (hole) {
            if (ground) {
              diffuseColor.rgb = r > 0.55 ? vec3(0.45, 0.27, 0.15) : vec3(0.18, 0.2, 0.24);
              winLit = (r < 0.55 && h1(vSeed * 13.0 + col) > 0.35) ? 1.0 : 0.0;
            } else {
              diffuseColor.rgb = vec3(0.2, 0.27, 0.35) + vec3(0.12) * step(0.62, fy);
              winLit = r > 0.45 ? 1.0 : 0.0;
            }
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += winLit * uNight * vec3(1.0, 0.78, 0.42);`);
  };
  m.customProgramCacheKey = () => 'facade-v1';
  return m;
}
