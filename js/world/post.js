// Post-proceso en una sola pasada: contorno de tinta (bordes de profundidad), neblina baja que
// llena la barranca, leve realce de color y viñeta. Más cielo con domo y nubes, y brillo de faroles.
import * as THREE from 'three';
import { gradientMap } from './materials.js';

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.enabled = true;
    this.size = new THREE.Vector2();
    this.rt = null;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.4 }, uFar: { value: 2600 },
        uInk: { value: 0.85 }, uInkFar: { value: 260 },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uMist: { value: new THREE.Color(0xdfe8ee) }, uMistAmt: { value: 1 }, uCamY: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uInk, uInkFar, uMistAmt, uCamY;
        uniform mat4 uProjInv, uCamWorld; uniform vec3 uMist; varying vec2 vUv;
        float lin(float d){ return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
        float D(vec2 o){ return lin(texture2D(tDepth, vUv + o / uRes).r); }
        void main(){
          vec3 c = texture2D(tColor, vUv).rgb;
          float raw = texture2D(tDepth, vUv).r;
          float d = lin(raw);
          // Contorno: diferencia de profundidad relativa en cruz (2 px)
          float e = 0.0;
          e = max(e, abs(D(vec2(1.5, 0.0)) - d)); e = max(e, abs(D(vec2(-1.5, 0.0)) - d));
          e = max(e, abs(D(vec2(0.0, 1.5)) - d)); e = max(e, abs(D(vec2(0.0, -1.5)) - d));
          float edge = smoothstep(0.035, 0.09, e / d) * (1.0 - smoothstep(uInkFar * 0.5, uInkFar, d)) * step(raw, 0.9999);
          c = mix(c, c * 0.18, edge * uInk);
          // Neblina baja: más densa en lo que está por debajo de la cámara (barranca) y lejos
          if (raw < 0.9999) {
            vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0); vp /= vp.w;
            vec3 wp = (uCamWorld * vp).xyz;
            float below = smoothstep(-8.0, -70.0, wp.y - uCamY);
            float m = (1.0 - exp(-d / 650.0)) * below * 0.6 * uMistAmt;
            c = mix(c, uMist, clamp(m, 0.0, 0.65));
          }
          // Realce de color y viñeta suave
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(l), c, 1.12);
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.35;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  ensure(samples) {
    this.r.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    if (this.rt && this.rt.width === w && this.rt.height === h && this.rt.samples === samples) return;
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.rt = new THREE.WebGLRenderTarget(w, h, { samples, depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(w, h);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.mat.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera, samples = 4) {
    if (!this.enabled) { this.r.setRenderTarget(null); this.r.render(scene, camera); return; }
    this.ensure(samples);
    this.r.setRenderTarget(this.rt);
    this.r.render(scene, camera);
    this.r.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamY.value = camera.position.y;
    this.r.render(this.scene, this.cam);
  }
}

// Domo de cielo con degradado y nubes low-poly que se desplazan.
export class Sky {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color(0x4f9fe0) }, uHor: { value: new THREE.Color(0xcfe3ee) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uHor; varying vec3 vP;
        void main(){ float t = smoothstep(-0.05, 0.55, vP.y); gl_FragColor = vec4(mix(uHor, uTop, t), 1.0);
        #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 24, 12), this.mat);
    this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);
    // Nubes: racimos de esferas facetadas, instanciadas
    const puff = new THREE.IcosahedronGeometry(1, 1);
    this.clouds = new THREE.InstancedMesh(puff, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap, fog: false, transparent: true, opacity: 0.92 }), 140);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let c = 0; c < 28 && k < 140; c++) {
      const ang = Math.random() * Math.PI * 2, rad = 700 + Math.random() * 1300, h = 260 + Math.random() * 220;
      const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
      for (let i = 0; i < 5 && k < 140; i++, k++) {
        const sc = 28 + Math.random() * 30;
        m.compose(p.set(cx + (i - 2) * 50 + Math.random() * 20, h + Math.random() * 20, cz + Math.random() * 40), q, s.set(sc * 1.4, sc * 0.7, sc));
        this.clouds.setMatrixAt(k, m);
      }
    }
    this.clouds.count = k;
    this.clouds.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(this.clouds);
    scene.add(this.group);
  }
  update(dt, camPos, top, horizon, night) {
    this.dome.position.copy(camPos);
    this.mat.uniforms.uTop.value.copy(top); this.mat.uniforms.uHor.value.copy(horizon);
    this.group.position.set(camPos.x, 0, camPos.z);
    this.group.rotation.y += dt * 0.004;
    this.clouds.material.color.setScalar(1 - night * 0.72);
  }
}

// Halo de los faroles: una sola nube de puntos aditiva que sólo se ve de noche.
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
