// Materiales PBR (MeshStandardMaterial) con texturas CC0 y detalle procedural en shader.
import * as THREE from 'three';
import { RODAPIES, SHOPS } from './streetStyles.js';
import { tex } from './textures.js';

// Compatibilidad: algunos módulos todavía importan gradientMap (ya no se usa sombreado cel).
export const gradientMap = null;
export const shared = { uNight: { value: 0 }, uTime: { value: 0 } };

export const toon = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

const glslColor = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };

// Posición local en metros, tamaño de instancia y tangente en espacio de vista (para mapas normales).
const LOCAL_VERTEX = `
  #ifdef USE_INSTANCING
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    mat3 iM3 = mat3(instanceMatrix);
  #else
    vec3 sc = vec3(1.0); vSeed = 0.37; mat3 iM3 = mat3(1.0);
  #endif
  vLoc = position * sc; vLocN = normal; vSize = sc;
  vec3 lt = abs(normal.z) > 0.5 ? vec3(1.0, 0.0, 0.0) : (abs(normal.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
  vTanV = normalize(mat3(modelViewMatrix) * (iM3 * lt));
  vUpV = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));`;
const LOCAL_VARY = 'varying vec3 vLoc; varying vec3 vLocN; varying float vSeed; varying vec3 vSize; varying vec3 vTanV; varying vec3 vUpV;';

// Aplica un mapa normal de tangente (T, arriba) sobre `normal` (espacio de vista).
const APPLY_NM = (sampler, uv, amt) => `{
  vec3 nm = texture2D(${sampler}, ${uv}).xyz * 2.0 - 1.0; nm.xy *= ${amt};
  vec3 T = normalize(vTanV - normal * dot(normal, vTanV)); vec3 Bv = normalize(cross(normal, T));
  if (dot(Bv, vUpV) < 0.0) Bv = -Bv;
  normal = normalize(T * nm.x + Bv * nm.y + normal * nm.z);
}`;

// ------------------------------------------------------------------
// Fachada PBR: aplanado (estuco) con relieve, cimiento de piedra, cantera, vidrio reflejante,
// madera, cortina metálica y herrería. aExtra = (rodapié, estilo, pisos, aleatorio).
// ------------------------------------------------------------------
export function makeFacadeMaterial(instanced = true) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  // USE_INSTANCING sólo existe en el vertex shader; el fragment usa su propia bandera
  if (instanced) m.defines = { FACADE_INST: '' };
  const rod = RODAPIES.map((c, i) => `if (k == ${i}) return ${glslColor(c)};`).join(' ');
  const tW = tex('white_stucco_diff', true), tWN = tex('white_stucco_nor_gl'), tS = tex('plaster_stone_wall_01_diff', true), tSN = tex('plaster_stone_wall_01_nor_gl');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uNight: shared.uNight, tW: { value: tW }, tWN: { value: tWN }, tS: { value: tS }, tSN: { value: tSN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n attribute vec4 aExtra; ${LOCAL_VARY} varying vec4 vExtra;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${LOCAL_VERTEX}\n vExtra = aExtra;\n #ifdef USE_INSTANCING\n vLoc.y -= 2.5;\n #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform sampler2D tW, tWN, tS, tSN; ${LOCAL_VARY} varying vec4 vExtra;
        float h1(float n){ return fract(sin(n) * 43758.5453); }
        vec3 rodapie(int k){ ${rod} return ${glslColor(RODAPIES[0])}; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winLit = 0.0, rough = 0.9, metal = 0.0, nmAmt = 0.0; int nmSrc = 0; vec2 nmUV = vec2(0.0);
        #ifdef FACADE_INST
        if (abs(vLocN.y) < 0.5) {
          int style = int(vExtra.y + 0.5);
          float rnd = vExtra.w;
          bool front = abs(vLocN.z) > 0.5;
          float u = front ? vLoc.x : vLoc.z;
          float halfW = (front ? vSize.x : vSize.z) * 0.5;
          float y = vLoc.y, H = vSize.y - 2.5;
          vec2 wuv = vec2(u, y) * 0.35 + vSeed * 7.0;
          vec3 stucco = texture2D(tW, wuv).rgb;
          vec3 wall = diffuseColor.rgb * (stucco / 0.78);
          // Manchas de humedad y escurrimientos bajo las ventanas
          float streak = smoothstep(0.6, 1.0, texture2D(tW, vec2(u * 0.05, y * 0.6) + 3.1).r);
          wall *= 1.0 - 0.18 * smoothstep(1.6, 0.0, y) - 0.06 * streak;
          vec3 col = wall; nmSrc = 1; nmUV = wuv; nmAmt = 1.0;
          if (y < 0.0) {
            vec2 suv = vec2(u, y) * 0.5; col = texture2D(tS, suv).rgb * 0.95; nmSrc = 2; nmUV = suv; nmAmt = 1.2;
          } else {
            float rodH = style == 2 ? 0.6 : 1.0;
            if (y < rodH) col = rodapie(int(vExtra.x + 0.5)) * (stucco / 0.78) * 0.95;
            else if (y < rodH + 0.06) col = wall * 0.7;
            if (y > H - 0.62) col = y > H - 0.3 ? wall * 1.03 : (y > H - 0.42 ? wall * 0.7 : wall * 0.86);
            float fl = mod(y, 3.2);
            if (style != 0 && y > 2.0 && y < H - 0.7 && fl > 3.02) col = wall * 0.82;
            if (style != 2 && front && abs(u) > halfW - 0.45 && y > rodH) col = wall * (abs(u) > halfW - 0.1 ? 0.8 : 0.93);
            float c = floor(u / 3.4 + 0.5), uc = c * 3.4, fu = (u - uc) / 3.4 + 0.5;
            float flo = floor(y / 3.2), fy = fract(y / 3.2);
            bool inside = front ? abs(uc) < halfW - 1.0 : (style == 2 && abs(uc) < halfW - 1.6 && h1(vSeed * 7.0 + c) > 0.6);
            if (inside && y < H - 0.65) {
              float r = h1(vSeed * 91.0 + c * 7.13 + flo * 3.7);
              bool groundF = flo < 0.5;
              float x0, x1, y0, y1;
              if (groundF) {
                if (style == 1) { x0 = 0.12; x1 = 0.88; y0 = 0.0; y1 = 0.72; }
                else if (h1(vSeed * 5.0 + c) > 0.45) { x0 = 0.32; x1 = 0.68; y0 = 0.0; y1 = 0.74; }
                else { x0 = 0.3; x1 = 0.7; y0 = 0.3; y1 = 0.72; }
              } else if (style == 0) { x0 = 0.34; x1 = 0.66; y0 = 0.04; y1 = 0.8; }
              else { x0 = 0.31; x1 = 0.69; y0 = 0.3; y1 = 0.76; }
              float mx = 0.045, my = 0.03;
              bool hole = fu > x0 && fu < x1 && fy > y0 && fy < y1;
              bool frame = fu > x0 - mx && fu < x1 + mx && fy > max(y0 - my, 0.0) && fy < y1 + my * 1.6;
              if (frame && !hole) { col = style == 0 ? texture2D(tS, wuv * 2.0).rgb * vec3(1.05, 0.92, 0.78) : (style == 1 ? wall * 0.72 : vec3(0.82)); nmAmt = 0.4; }
              if (hole) {
                float lu = (fu - x0) / (x1 - x0), lv = (fy - y0) / (y1 - y0);
                bool isDoor = groundF && y0 < 0.01;
                nmAmt = 0.0;
                if (isDoor && style == 1) {
                  if (lv > 0.62 + 0.25 * r) { col = vec3(0.55, 0.57, 0.6) * (0.8 + 0.2 * step(0.5, fract(lv * 22.0))); rough = 0.45; metal = 0.8; }
                  else { col = vec3(0.07, 0.065, 0.07) + vec3(0.05, 0.03, 0.01) * lv; winLit = 1.0; rough = 0.6; }
                } else if (isDoor) {
                  vec3 wood = r > 0.6 ? vec3(0.3, 0.15, 0.07) : (r > 0.3 ? vec3(0.12, 0.24, 0.19) : vec3(0.38, 0.22, 0.1));
                  float grain = texture2D(tS, vec2(lu * 0.3, lv * 3.0)).r;
                  float groove = step(0.47, lu) * step(lu, 0.53) + step(fract(lu * 2.0), 0.08) + step(0.92, fract(lu * 2.0));
                  float panel = step(0.12, fract(lv * 3.0)) * step(fract(lv * 3.0), 0.88);
                  col = wood * (0.7 + 0.5 * grain) * (0.75 + 0.25 * panel) * (1.0 - 0.35 * clamp(groove, 0.0, 1.0)); rough = 0.65;
                } else {
                  col = mix(vec3(0.05, 0.07, 0.09), vec3(0.16, 0.2, 0.24), lv * 0.6);
                  col *= 1.0 - 0.5 * smoothstep(0.82, 1.0, lv);
                  rough = 0.06; metal = 0.0;
                  if (style == 0 && !groundF && (step(0.94, fract(lu * 2.0)) + step(lu, 0.04)) > 0.5) { col = vec3(0.25, 0.13, 0.06); rough = 0.6; }
                  bool bars = (groundF && style != 1) || (style == 2 && rnd > 0.5);
                  if (bars && (fract(lu * 6.0) < 0.12 || fract(lv * 2.0) < 0.06)) { col = vec3(0.03); rough = 0.4; metal = 0.9; }
                  winLit = r > 0.42 ? 1.0 : 0.0;
                }
              }
            }
          }
          diffuseColor.rgb = col;
        }
        #endif`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = rough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = metal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (nmAmt > 0.0) { if (nmSrc == 2) ${APPLY_NM('tSN', 'nmUV', 'nmAmt')} else ${APPLY_NM('tWN', 'nmUV', 'nmAmt')} }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += winLit * uNight * vec3(2.4, 1.7, 0.85);`);
  };
  m.customProgramCacheKey = () => 'facade-pbr-v2-' + instanced;
  return m;
}

// Teja de barro: textura real a lo largo de la pendiente del tejado + mapa normal.
export function makeRoofMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
  const tR = tex('clay_roof_tiles_02_diff', true), tRN = tex('clay_roof_tiles_02_nor_gl');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tR: { value: tR }, tRN: { value: tRN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n ${LOCAL_VARY}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${LOCAL_VERTEX}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n uniform sampler2D tR, tRN; ${LOCAL_VARY}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 ruv = vec2(vLoc.x * 0.45, length(vec2(vLoc.y, vLoc.z)) * 0.45) + vSeed * 5.0;
        bool slope = abs(vLocN.x) < 0.7;
        if (slope) diffuseColor.rgb *= texture2D(tR, ruv).rgb * 1.35;
        else diffuseColor.rgb = vec3(0.88, 0.84, 0.77);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (slope) ${APPLY_NM('tRN', 'ruv', '1.0')}`);
  };
  m.customProgramCacheKey = () => 'roof-pbr-v1';
  return m;
}

// Herrería: barrotes recortados en el shader sobre una sola caja.
export function makeRailingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n ${LOCAL_VARY}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${LOCAL_VERTEX}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n ${LOCAL_VARY}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float u = abs(vLocN.x) > 0.5 ? vLoc.z * 4.0 : vLoc.x * 7.0, v = vLoc.y / max(vSize.y, 0.01);
        bool keep = v < 0.07 || v > 0.92 || fract(u) < 0.16 || (v > 0.46 && v < 0.52) || abs(vLocN.y) > 0.5;
        if (!keep) discard;`);
  };
  m.customProgramCacheKey = () => 'railing-pbr-v1';
  return m;
}

// Letreros de comercio: atlas 4×4 generado en canvas; aExtra.x elige el letrero.
export function makeSignMaterial() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const bgs = ['#b71c1c', '#0d47a1', '#1b5e20', '#f9a825', '#4a148c', '#e65100', '#006064', '#880e4f'];
  SHOPS.forEach((name, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
    const grd = g.createLinearGradient(0, y, 0, y + 128); grd.addColorStop(0, bgs[i % bgs.length]); grd.addColorStop(1, '#00000055');
    g.fillStyle = bgs[i % bgs.length]; g.fillRect(x, y, 256, 128); g.fillStyle = grd; g.fillRect(x, y, 256, 128);
    g.strokeStyle = '#f5f0e0'; g.lineWidth = 5; g.strokeRect(x + 8, y + 8, 240, 112);
    g.fillStyle = '#fff8e6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${name.length > 10 ? 27 : 34}px "Nunito", "Arial Black", sans-serif`;
    g.fillText(name, x + 128, y + 66, 228);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n attribute vec4 aExtra;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv = vMapUv * vec2(0.25, 0.25) + vec2(mod(aExtra.x, 4.0), 3.0 - floor(aExtra.x / 4.0)) * 0.25;`);
  };
  m.customProgramCacheKey = () => 'signs-pbr-v1';
  return m;
}

// Calles: adoquín, asfalto y concreto con texturas reales proyectadas desde arriba + relieve.
// El color por vértice decide el tipo (cálido = adoquín, claro = banqueta, frío = asfalto).
export function makeRoadMaterial(off) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -off, polygonOffsetUnits: -off * 2 });
  const tG = tex('sparse_grass_diff', true), tC = tex('cobblestone_floor_04_diff', true), tCN = tex('cobblestone_floor_04_nor_gl'), tA = tex('asphalt_02_diff', true), tAN = tex('asphalt_02_nor_gl'), tP = tex('brushed_concrete_diff', true), tPN = tex('brushed_concrete_nor_gl');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tG: { value: tG }, tC: { value: tC }, tCN: { value: tCN }, tA: { value: tA }, tAN: { value: tAN }, tP: { value: tP }, tPN: { value: tPN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWorld; varying vec3 vTanV; varying vec3 vUpV;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTanV = normalize(mat3(viewMatrix) * vec3(1.0, 0.0, 0.0)); vUpV = normalize(mat3(viewMatrix) * vec3(0.0, 0.0, -1.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tG, tC, tCN, tA, tAN, tP, tPN; varying vec3 vWorld; varying vec3 vTanV; varying vec3 vUpV;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 base = diffuseColor.rgb;
        float isCobble = step(0.04, base.r - base.b);
        float isPave = step(0.55, base.r) * step(0.5, base.g);
        vec2 p = vWorld.xz;
        int kind = base.g > base.r + 0.1 ? 3 : (isPave > 0.5 ? 2 : (isCobble > 0.5 ? 0 : 1));
        float rough = 0.85; vec2 ruv;
        if (kind == 0) { ruv = p * 0.33; diffuseColor.rgb = texture2D(tC, ruv).rgb * (base / 0.34) * 0.9; rough = 0.8; }
        else if (kind == 1) { ruv = p * 0.18; diffuseColor.rgb = texture2D(tA, ruv).rgb * (base / 0.1) * 0.75; rough = 0.92; }
        else if (kind == 2) { ruv = p * 0.25; diffuseColor.rgb = texture2D(tP, ruv).rgb * (base / 0.68) * 0.95; rough = 0.88; }
        else { ruv = p * 0.12; diffuseColor.rgb = mix(texture2D(tG, ruv).rgb, texture2D(tG, p * 0.031).rgb, 0.4) * vec3(0.95, 1.05, 0.85); rough = 0.95; }
        // Variación a gran escala (manchas, desgaste)
        diffuseColor.rgb *= 0.88 + 0.2 * texture2D(tA, p * 0.013).r;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = rough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nm = kind == 3 ? vec3(0.5, 0.5, 1.0) : (kind == 0 ? texture2D(tCN, ruv).xyz : (kind == 1 ? texture2D(tAN, ruv).xyz : texture2D(tPN, ruv).xyz)); nm = nm * 2.0 - 1.0;
          nm.xy *= kind == 0 ? 1.3 : 0.7;
          vec3 T = normalize(vTanV - normal * dot(normal, vTanV)); vec3 Bv = normalize(cross(normal, T));
          if (dot(Bv, vUpV) < 0.0) Bv = -Bv;
          normal = normalize(T * nm.x + Bv * nm.y + normal * nm.z);
        }`);
  };
  m.customProgramCacheKey = () => 'road-pbr-v1-' + off;
  return m;
}
