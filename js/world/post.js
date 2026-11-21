// Cadena de imagen realista: render HDR (HalfFloat) → oclusión ambiental (SAO ligero con normales
// reconstruidas), neblina baja en la barranca, bloom por mitades/cuartos, antialias tipo FXAA y
// tonemapping ACES. Además: cielo físico (Preetham) con iluminación ambiental por PMREM.
import * as THREE from 'three';
import { Sky as PhysSky } from '../../lib/jsm/objects/Sky.js';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.enabled = true; this.ao = true; this.bloom = true;
    this.size = new THREE.Vector2();
    const hf = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtBright = new THREE.WebGLRenderTarget(1, 1, hf);
    this.rtA = new THREE.WebGLRenderTarget(1, 1, hf);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, hf);
    this.bright = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uThr: { value: 1.1 } },
      vertexShader: FS_VERT,
      fragmentShader: `uniform sampler2D tColor; uniform float uThr; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tColor, vUv).rgb; float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(uThr * 0.7, uThr * 1.6, l); gl_FragColor = vec4(c * k, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: `uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
        void main(){ vec3 s = texture2D(tIn, vUv).rgb * 0.227;
          s += (texture2D(tIn, vUv + uDir * 1.38).rgb + texture2D(tIn, vUv - uDir * 1.38).rgb) * 0.316;
          s += (texture2D(tIn, vUv + uDir * 3.23).rgb + texture2D(tIn, vUv - uDir * 3.23).rgb) * 0.07;
          gl_FragColor = vec4(s, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.comp = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.4 }, uFar: { value: 2600 },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
        uMist: { value: new THREE.Color(0xdfe8ee) }, uCamY: { value: 0 },
        uAO: { value: 1 }, uBloom: { value: 0.6 },
      },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tColor, tDepth, tBloom; uniform vec2 uRes; uniform float uNear, uFar, uCamY, uAO, uBloom;
        uniform mat4 uProjInv, uCamWorld, uProj; uniform vec3 uMist; varying vec2 vUv;
        vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).r; vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
        float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        void main(){
          vec2 px = 1.0 / uRes;
          vec3 c = texture2D(tColor, vUv).rgb;
          // Antialias ligero (FXAA simplificado sobre HDR)
          float lC = lum(c), lN = lum(texture2D(tColor, vUv + vec2(0.0, px.y)).rgb), lS = lum(texture2D(tColor, vUv - vec2(0.0, px.y)).rgb);
          float lE = lum(texture2D(tColor, vUv + vec2(px.x, 0.0)).rgb), lW = lum(texture2D(tColor, vUv - vec2(px.x, 0.0)).rgb);
          float range = max(max(lN, lS), max(lE, lW)) - min(min(lN, lS), min(lE, lW));
          if (range > max(0.04, 0.15 * lC)) {
            vec2 dir = normalize(vec2(-((lN) - (lS)), (lE) - (lW)) + 1e-5) * px * 0.75;
            c = 0.5 * (texture2D(tColor, vUv + dir).rgb + texture2D(tColor, vUv - dir).rgb) * 0.6 + c * 0.4;
          }
          float raw = texture2D(tDepth, vUv).r;
          if (raw < 0.9999) {
            vec3 P = viewPos(vUv);
            float d = -P.z;
            // Oclusión ambiental: hemisferio orientado por la normal reconstruida (8 muestras)
            if (uAO > 0.0 && d < 180.0) {
              vec3 N = normalize(cross(dFdx(P), dFdy(P)));
              float radius = 1.2, rpx = clamp(radius * uProj[1][1] * 0.5 * uRes.y / d, 3.0, 60.0);
              float occ = 0.0, a0 = ign(gl_FragCoord.xy) * 6.2831853;
              for (int i = 0; i < 8; i++) {
                float a = a0 + float(i) * 2.3999632, r = rpx * (float(i) + 0.5) / 8.0;
                vec3 S = viewPos(vUv + vec2(cos(a), sin(a)) * r * px);
                vec3 v = S - P; float L = length(v);
                occ += max(0.0, dot(N, v / max(L, 1e-4)) - 0.15) * (1.0 - smoothstep(radius * 0.6, radius * 2.0, L));
              }
              float ao = 1.0 - clamp(occ / 8.0 * 2.2, 0.0, 0.75) * (1.0 - smoothstep(80.0, 180.0, d));
              c *= mix(1.0, ao, uAO);
            }
            // Neblina baja que llena la barranca
            vec3 wp = (uCamWorld * vec4(P, 1.0)).xyz;
            float below = smoothstep(-8.0, -90.0, wp.y - uCamY);
            c = mix(c, uMist, clamp((1.0 - exp(-d / 700.0)) * below * 0.6, 0.0, 0.6));
          }
          c += texture2D(tBloom, vUv).rgb * uBloom;
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.28;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
  }

  ensure() {
    this.r.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(w, h);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.rtBright.setSize(w >> 1, h >> 1); this.rtA.setSize(w >> 2, h >> 2); this.rtB.setSize(w >> 2, h >> 2);
    this.comp.uniforms.uRes.value.set(w, h);
  }

  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }

  render(scene, camera) {
    if (!this.enabled) { this.r.setRenderTarget(null); this.r.render(scene, camera); return; }
    this.ensure();
    this.r.setRenderTarget(this.rt);
    this.r.render(scene, camera);
    const u = this.comp.uniforms;
    if (this.bloom) {
      this.bright.uniforms.tColor.value = this.rt.texture; this.pass(this.bright, this.rtBright);
      const bw = this.rtA.width, bh = this.rtA.height;
      this.blur.uniforms.tIn.value = this.rtBright.texture; this.blur.uniforms.uDir.value.set(1 / bw, 0); this.pass(this.blur, this.rtA);
      this.blur.uniforms.tIn.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(0, 1 / bh); this.pass(this.blur, this.rtB);
      this.blur.uniforms.tIn.value = this.rtB.texture; this.blur.uniforms.uDir.value.set(2 / bw, 0); this.pass(this.blur, this.rtA);
      this.blur.uniforms.tIn.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(0, 2 / bh); this.pass(this.blur, this.rtB);
      u.tBloom.value = this.rtB.texture;
    } else u.tBloom.value = this.black;
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uProj.value.copy(camera.projectionMatrix); u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamY.value = camera.position.y; u.uAO.value = this.ao ? 1 : 0;
    this.pass(this.comp, null);
  }
}

// Cielo físico + luz ambiental basada en imagen (se regenera cuando el sol se mueve).
export class SkySystem {
  constructor(scene, renderer) {
    this.sky = new PhysSky(); this.sky.scale.setScalar(2300); this.sky.frustumCulled = false;
    this.sky.material.depthWrite = false;
    scene.add(this.sky);
    const set = (s) => { const u = s.material.uniforms; u.turbidity.value = 2.8; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82; };
    set(this.sky);
    this.envSky = new PhysSky(); this.envSky.scale.setScalar(40); set(this.envSky);
    this.envScene = new THREE.Scene(); this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envIntensity = 0.32;
    this.scene = scene; this.lastSun = new THREE.Vector3(0, -1, 0); this.env = null; this.t = 0;
    // Nubes: racimos de esferas facetadas suaves
    const puff = new THREE.IcosahedronGeometry(1, 2);
    this.clouds = new THREE.InstancedMesh(puff, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, fog: false, transparent: true, opacity: 0.95, emissive: 0x9aa5b0, emissiveIntensity: 0.35 }), 220);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let c = 0; c < 36 && k < 220; c++) {
      const ang = Math.random() * Math.PI * 2, rad = 800 + Math.random() * 1300, h = 330 + Math.random() * 200;
      const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
      for (let i = 0; i < 6 && k < 220; i++, k++) {
        const sc = 22 + Math.random() * 26;
        m.compose(p.set(cx + (i - 2.5) * 34 + Math.random() * 16, h + Math.random() * 14 - (i % 2) * 6, cz + Math.random() * 30), q, s.set(sc * 1.5, sc * 0.6, sc));
        this.clouds.setMatrixAt(k, m);
      }
    }
    this.clouds.count = k; this.clouds.frustumCulled = false; this.clouds.castShadow = false;
    this.group = new THREE.Group(); this.group.add(this.clouds); scene.add(this.group);
  }
  update(dt, camPos, sunDir, night) {
    this.sky.position.copy(camPos);
    this.sky.material.uniforms.sunPosition.value.copy(sunDir);
    this.group.position.set(camPos.x, 0, camPos.z);
    this.group.rotation.y += dt * 0.003;
    this.clouds.material.color.setScalar(1 - night * 0.85);
    this.clouds.material.emissiveIntensity = 0.35 * (1 - night);
    this.t -= dt;
    if (this.t <= 0 && (!this.env || this.lastSun.angleTo(sunDir) > 0.03)) {
      this.t = 1.5;
      this.lastSun.copy(sunDir);
      this.envSky.material.uniforms.sunPosition.value.copy(sunDir);
      const old = this.env;
      this.env = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      this.scene.environment = this.env.texture;
      if (old) old.dispose();
      else this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) if (m.isMeshStandardMaterial) m.envMapIntensity = this.envIntensity; });
    }
  }
}

// Halo de los faroles: una nube de puntos aditiva que sólo se ve de noche.
export function makeLampGlow(scene, positions, yOf) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,150,1)'); grd.addColorStop(0.25, 'rgba(255,190,100,0.55)'); grd.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const arr = new Float32Array((positions.length / 2) * 3);
  for (let i = 0, j = 0; i < positions.length; i += 2, j += 3) { arr[j] = positions[i]; arr[j + 1] = yOf(positions[i], positions[i + 1]) + 3.9; arr[j + 2] = positions[i + 1]; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({ size: 4.5, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
}
