import * as THREE from 'three';
import { RODAPIES, SHOPS } from './streetStyles.js';

// Rampa de 3 tonos para el sombreado cel (look caricaturesco).
export const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

export const shared = { uNight: { value: 0 }, uTime: { value: 0 } };

export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });

const glslColor = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };

// Pasa al fragment shader la posición local en metros (escala de la instancia) y el tamaño.
const LOCAL_VERTEX = `
  #ifdef USE_INSTANCING
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vec3 sc = vec3(1.0); vSeed = 0.37;
  #endif
  vLoc = position * sc; vLocN = normal; vSize = sc;`;

// ------------------------------------------------------------------
// Fachada: tres estilos (colonial, comercial, popular) con ventanas, puertas de madera,
// cortinas metálicas, herrería, cornisa, pilastras, rodapié, cimiento de piedra y desgaste.
// aExtra = (índice de rodapié, estilo, pisos, aleatorio). Una sola llamada de dibujo por chunk.
// ------------------------------------------------------------------
export function makeFacadeMaterial() {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap });
  const rod = RODAPIES.map((c, i) => `if (k == ${i}) return ${glslColor(c)};`).join(' ');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aExtra;
        varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize; varying vec4 vExtra;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${LOCAL_VERTEX}
        vExtra = aExtra;
        #ifdef USE_INSTANCING
          vLoc.y -= 2.5;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize; varying vec4 vExtra;
        float h1(float n){ return fract(sin(n) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h1(dot(i, vec2(1.0,57.0))), h1(dot(i+vec2(1.0,0.0), vec2(1.0,57.0))), f.x),
                     mix(h1(dot(i+vec2(0.0,1.0), vec2(1.0,57.0))), h1(dot(i+vec2(1.0,1.0), vec2(1.0,57.0))), f.x), f.y); }
        vec3 rodapie(int k){ ${rod} return ${glslColor(RODAPIES[0])}; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winLit = 0.0;
        #ifdef USE_INSTANCING
        if (abs(vLocN.y) < 0.5) {
          int style = int(vExtra.y + 0.5);
          float rnd = vExtra.w;
          bool front = abs(vLocN.z) > 0.5;           // fachada a la calle (caras ±z locales)
          float u = front ? vLoc.x : vLoc.z;
          float halfW = (front ? vSize.x : vSize.z) * 0.5;
          float y = vLoc.y, H = vSize.y - 2.5;
          vec3 wall = diffuseColor.rgb;
          // Desgaste: manchas de humedad abajo y variación suave
          float dirt = n2(vec2(u * 0.8, y * 1.3) + vSeed * 40.0);
          wall *= 0.93 + 0.07 * dirt;
          wall = mix(wall, wall * vec3(0.78, 0.76, 0.72), smoothstep(1.8, 0.0, y) * 0.35 * dirt);
          vec3 col = wall;
          if (y < 0.0) {
            // Cimiento de piedra en hiladas
            vec2 b = vec2(u * 1.6 + floor(y * 2.5) * 0.5, y * 2.5);
            float edge = step(0.9, fract(b.x)) + step(0.88, fract(b.y));
            col = mix(vec3(0.6, 0.56, 0.5) * (0.85 + 0.3 * h1(floor(b.x) * 3.1 + floor(b.y))), vec3(0.35, 0.33, 0.3), clamp(edge, 0.0, 1.0));
          } else {
            float rodH = style == 2 ? 0.6 : 1.0;
            if (y < rodH) col = rodapie(int(vExtra.x + 0.5)) * (0.9 + 0.1 * dirt);
            else if (y < rodH + 0.08) col = wall * 0.7;
            // Cornisa y pretil
            if (y > H - 0.62) col = y > H - 0.3 ? wall * 1.04 : (y > H - 0.42 ? wall * 0.72 : wall * 0.86);
            // Banda de entrepiso
            float fl = mod(y, 3.2);
            if (style != 0 && y > 2.0 && y < H - 0.7 && fl > 3.02) col = wall * 0.82;
            // Pilastras en las esquinas (colonial y comercial)
            if (style != 2 && front && abs(u) > halfW - 0.45 && y > rodH) col = wall * (abs(u) > halfW - 0.1 ? 0.8 : 0.93);
            // Vanos
            float c = floor(u / 3.4 + 0.5), uc = c * 3.4, fu = (u - uc) / 3.4 + 0.5;
            float flo = floor(y / 3.2), fy = fract(y / 3.2);
            bool inside = front ? abs(uc) < halfW - 1.0 : (style == 2 && abs(uc) < halfW - 1.6 && h1(vSeed * 7.0 + c) > 0.6);
            if (inside && y < H - 0.65) {
              float r = h1(vSeed * 91.0 + c * 7.13 + flo * 3.7);
              bool groundF = flo < 0.5;
              float x0, x1, y0, y1;
              if (groundF) {
                if (style == 1) { x0 = 0.12; x1 = 0.88; y0 = 0.0; y1 = 0.72; }           // local comercial
                else if (h1(vSeed * 5.0 + c) > 0.45) { x0 = 0.32; x1 = 0.68; y0 = 0.0; y1 = 0.74; } // puerta
                else { x0 = 0.3; x1 = 0.7; y0 = 0.3; y1 = 0.72; }                        // ventana con reja
              } else if (style == 0) { x0 = 0.34; x1 = 0.66; y0 = 0.04; y1 = 0.8; }      // puerta-ventana de balcón
              else { x0 = 0.31; x1 = 0.69; y0 = 0.3; y1 = 0.76; }
              float mx = 0.045, my = 0.03;
              bool hole = fu > x0 && fu < x1 && fy > y0 && fy < y1;
              bool frame = fu > x0 - mx && fu < x1 + mx && fy > max(y0 - my, 0.0) && fy < y1 + my * 1.6;
              if (frame && !hole) col = style == 0 ? vec3(0.74, 0.62, 0.5) : (style == 1 ? wall * 0.72 : vec3(0.85, 0.85, 0.83));
              if (hole) {
                float lu = (fu - x0) / (x1 - x0), lv = (fy - y0) / (y1 - y0);
                bool isDoor = groundF && y0 < 0.01;
                if (isDoor && style == 1) {
                  // Cortina metálica medio abierta + interior
                  if (lv > 0.62 + 0.25 * r) col = vec3(0.62, 0.64, 0.66) * (0.85 + 0.15 * step(0.5, fract(lv * 22.0)));
                  else { col = vec3(0.16, 0.15, 0.17) + vec3(0.08, 0.05, 0.02) * lv; winLit = 1.0; }
                } else if (isDoor) {
                  // Puerta de madera de dos hojas con tableros
                  vec3 wood = r > 0.6 ? vec3(0.36, 0.2, 0.1) : (r > 0.3 ? vec3(0.18, 0.32, 0.26) : vec3(0.45, 0.28, 0.14));
                  float groove = step(0.47, lu) * step(lu, 0.53) + step(fract(lu * 2.0), 0.08) + step(0.92, fract(lu * 2.0));
                  float panel = step(0.12, fract(lv * 3.0)) * step(fract(lv * 3.0), 0.88);
                  col = wood * (0.75 + 0.25 * panel) * (1.0 - 0.35 * clamp(groove, 0.0, 1.0));
                } else {
                  // Vidrio con reflejo, sombra superior (relieve) y postigos/rejas
                  col = mix(vec3(0.17, 0.24, 0.32), vec3(0.45, 0.58, 0.68), smoothstep(0.2, 1.0, lv) * 0.6);
                  col += vec3(0.12) * step(abs(lu - lv * 0.6 - 0.15), 0.05);
                  col *= 1.0 - 0.45 * smoothstep(0.82, 1.0, lv);
                  if (style == 0 && !groundF) col = mix(col, vec3(0.3, 0.17, 0.09), step(0.94, fract(lu * 2.0)) + step(lu, 0.04));
                  bool bars = (groundF && style != 1) || (style == 2 && rnd > 0.5);
                  if (bars && (fract(lu * 6.0) < 0.12 || fract(lv * 2.0) < 0.06)) col = vec3(0.08, 0.08, 0.09);
                  winLit = r > 0.42 ? 1.0 : 0.0;
                }
              }
            }
          }
          diffuseColor.rgb = col;
        }
        #else
        if (abs(vLocN.y) < 0.5) {
          float u = abs(vLocN.x) > 0.5 ? vLoc.z : vLoc.x, y = vLoc.y;
          float fu = fract(u / 3.4), fy = fract(y / 3.2);
          if (fu > 0.3 && fu < 0.7 && fy > 0.3 && fy < 0.75) { diffuseColor.rgb = vec3(0.2, 0.27, 0.35); winLit = step(0.5, h1(floor(u / 3.4) + floor(y / 3.2) * 7.0)); }
        }
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += winLit * uNight * vec3(1.0, 0.78, 0.42);`);
  };
  m.customProgramCacheKey = () => 'facade-v2';
  return m;
}

// Herrería: barrotes recortados en el shader sobre una sola caja (pocos triángulos).
export function makeRailingMaterial() {
  const m = new THREE.MeshToonMaterial({ color: 0x1d1f24, gradientMap, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + LOCAL_VERTEX);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float u = abs(vLocN.x) > 0.5 ? vLoc.z * 4.0 : vLoc.x * 7.0, v = vLoc.y / max(vSize.y, 0.01);
        bool keep = v < 0.07 || v > 0.92 || fract(u) < 0.16 || (v > 0.46 && v < 0.52) || abs(vLocN.y) > 0.5;
        if (!keep) discard;`);
  };
  m.customProgramCacheKey = () => 'railing-v1';
  return m;
}

// Teja: hileras y canales de teja dibujados en el shader según el tamaño de cada tejado.
export function makeRoofMaterial() {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + LOCAL_VERTEX);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vLocN.x) < 0.7) {
          float row = fract(length(vec2(vLoc.y, vLoc.z)) * 2.6), canal = fract(vLoc.x * 3.2);
          float shade = 0.82 + 0.18 * smoothstep(0.0, 0.5, canal) * smoothstep(1.0, 0.5, canal);
          diffuseColor.rgb *= shade * (row < 0.12 ? 0.72 : 1.0);
          diffuseColor.rgb *= 0.92 + 0.12 * fract(sin(floor(vLoc.x * 3.2) * 12.9 + floor(length(vec2(vLoc.y, vLoc.z)) * 2.6) * 78.2) * 43758.5);
        } else diffuseColor.rgb = vec3(0.93, 0.9, 0.84);`);
  };
  m.customProgramCacheKey = () => 'roof-v1';
  return m;
}

// Letreros de comercio: atlas 4×4 generado en canvas; aExtra.x elige el letrero.
export function makeSignMaterial() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const bgs = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457'];
  SHOPS.forEach((name, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
    g.fillStyle = bgs[i % bgs.length]; g.fillRect(x, y, 256, 128);
    g.strokeStyle = '#fff8e6'; g.lineWidth = 6; g.strokeRect(x + 8, y + 8, 240, 112);
    g.fillStyle = '#fff8e6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${name.length > 10 ? 30 : 38}px "Bangers", "Arial Black", sans-serif`;
    g.fillText(name, x + 128, y + 66, 228);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshToonMaterial({ map: t, gradientMap });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n attribute vec4 aExtra;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv = vMapUv * vec2(0.25, 0.25) + vec2(mod(aExtra.x, 4.0), 3.0 - floor(aExtra.x / 4.0)) * 0.25;`);
  };
  m.customProgramCacheKey = () => 'signs-v1';
  return m;
}

// Calles: adoquín (centro) / asfalto con textura procedural por coordenada de mundo.
// El color por vértice decide: rojo>verde>azul ≈ adoquín; el canal alfa no se usa.
export function makeRoadMaterial(off) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -off, polygonOffsetUnits: -off * 2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        float h1(float n){ return fract(sin(n) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 base = diffuseColor.rgb;
        float isCobble = step(0.04, base.r - base.b);     // adoquín (tono cálido)
        float isPave = step(0.55, base.r) * step(0.5, base.g); // banqueta clara
        vec2 p = vWorld.xz;
        if (isCobble > 0.5 && isPave < 0.5) {
          vec2 q = vec2(p.x * 2.2 + floor(p.y * 3.0) * 0.5, p.y * 3.0);
          vec2 f = fract(q); float id = h1(floor(q.x) * 13.7 + floor(q.y) * 3.1);
          float mortar = smoothstep(0.0, 0.1, f.x) * smoothstep(1.0, 0.9, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
          diffuseColor.rgb = mix(base * 0.55, base * (0.85 + 0.3 * id), mortar);
        } else if (isPave > 0.5) {
          vec2 f = fract(p * 0.9);
          diffuseColor.rgb = base * (0.92 + 0.08 * step(0.06, f.x) * step(0.06, f.y));
        } else {
          float n = h1(floor(p.x * 3.0) * 7.0 + floor(p.y * 3.0) * 131.0);
          diffuseColor.rgb = base * (0.93 + 0.1 * n);
        }`);
  };
  m.customProgramCacheKey = () => 'road-v1-' + off;
  return m;
}
