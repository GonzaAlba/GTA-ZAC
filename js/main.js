// Zacatlán Libre: bucle principal (física fija a 60 Hz + render interpolado), cámara y orquestación.
import * as THREE from 'three';
import { Input, BTN } from './input/gamepad.js';
import { World } from './world/cityBuilder.js';
import { Landmarks } from './world/landmarks.js';
import { shared } from './world/materials.js';
import { CrowdRenderer } from './entities/characters.js';
import { Vehicle, VehicleRenderer, PAINTS } from './entities/vehicle.js';
import { Player } from './entities/player.js';
import { Traffic } from './systems/traffic.js';
import { Peds } from './systems/peds.js';
import { Police, Wanted, Pickups } from './systems/police.js';
import { Combat } from './systems/combat.js';
import { Missions, STORY } from './systems/missions.js';
import { Audio } from './systems/audio.js';
import { HUD } from './ui/hud.js';
import { Minimap, GPS } from './ui/minimap.js';
import { clamp, damp, dampAngle, smoothstep, lerp, fmtMoney } from './util.js';

const STEP = 1 / 60;
const QUALITY = {
  Alta: { shadow: 2048, dpr: 1.5, far: 480, traffic: 20, peds: 36 },
  Media: { shadow: 1024, dpr: 1.0, far: 380, traffic: 16, peds: 28 },
  Baja: { shadow: 0, dpr: 0.75, far: 300, traffic: 11, peds: 18 },
};

class Game {
  constructor() {
    this.state = { money: 500 };
    this.quality = 'Alta';
    this.vehicles = [];
    this.fogBoost = 1;
    this.minutes = 9 * 60 + 30;
    this.paused = false; this.started = false; this.overlay = null; this.timeScale = 1;
    this.setupRenderer();
    this.input = new Input();
    this.audio = new Audio();

    const t0 = performance.now();
    this.landmarks = new Landmarks(this.scene);
    this.world = new World(this.scene);
    this.world.build(this.landmarks);
    this.world.allowMirador = this.landmarks.allowMirador;
    this.buildTime = Math.round(performance.now() - t0);

    this.crowd = new CrowdRenderer(this.scene, 96);
    this.vrender = new VehicleRenderer(this.scene, 48);
    this.hud = new HUD(this);
    this.gps = new GPS(this);
    this.combat = new Combat(this);
    this.wanted = new Wanted(this);
    this.police = new Police(this);
    this.pickups = new Pickups(this);
    this.traffic = new Traffic(this);
    this.peds = new Peds(this);
    const casa = this.world.places['Casa'] || [0, 30];
    this.player = new Player(this, casa[0], casa[1]);
    const merc = this.world.places['Mercado'];
    if (merc) { const m = this.player.heroes[1].ch; m.x = m.px = merc[0] + 6; m.z = m.pz = merc[1] + 6; }
    this.missions = new Missions(this);
    this.minimap = new Minimap(this, document.getElementById('minimap'), document.getElementById('bigmapcv'));
    this.charLists = [this.peds.list, this.police.cops, this.player.bodies()];
    this.cam = { yaw: 0, pitch: 0.28, dist: 5.5, idle: 0, x: casa[0], y: 4, z: casa[1] - 6, fov: 62, snap: true };
    this.camera.snap = false;
    this.seedPickups();
    // Auto de cortesía frente a la casa
    const spot = this.missions.roadSpot(casa[0], casa[1]);
    const car = new Vehicle('compacto', spot.x, spot.z, spot.yaw, 0xe53935); car.owner = 'parked'; this.addVehicle(car);
    this.applyQuality(this.quality);
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4(); this._sph = new THREE.Sphere(new THREE.Vector3(), 6);
    this.fps = { frames: 0, t: 0, value: 60, show: this.input.debug, low: 0 };
    this.streetT = 0;
    this.acc = 0; this.last = performance.now();
    this.setupMenus();
    addEventListener('resize', () => this.resize());
    this.resize();
    document.getElementById('loading').remove();
    requestAnimationFrame((t) => this.tick(t));
  }

  setupRenderer() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.sky = new THREE.Color(0x9fd4ff);
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(0xcfe3ee, 60, 480);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 2600);
    this.hemi = new THREE.HemisphereLight(0xdff1ff, 0x5f7a45, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -75; sc.right = sc.top = 75; sc.near = 10; sc.far = 400;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    // Faros del auto del jugador (siempre existe para no recompilar shaders)
    this.headlight = new THREE.SpotLight(0xfff2c8, 0, 60, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight, this.headlight.target);
  }

  applyQuality(name) {
    const q = QUALITY[name]; this.quality = name; this.q = q;
    this.maxDpr = Math.min(devicePixelRatio, q.dpr); this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    const shadows = q.shadow > 0;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
    if (shadows) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.traffic.target = q.traffic; this.peds.target = q.peds;
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  seedPickups() {
    const P = this.world.places, d = (n, kind, amount, respawn = 60, ox = 0, oz = 0) => { if (P[n]) this.pickups.drop(P[n][0] + ox, P[n][1] + oz, kind, amount, 1e9, respawn); };
    d('Clínica', 'health', 0, 45);
    d('Palacio Municipal', 'armor', 0, 120, 0, 0);
    d('Casa', 'pistola', 36, 90, 1.5, 0);
    d('Parque Hundido', 'subfusil', 90, 120);
    d('Ex-Convento', 'armor', 0, 120, 0, 0);
    d('Plazuela Santa Cecilia', 'cash', 250, 300);
  }

  addVehicle(v) { this.vehicles.push(v); return v; }
  removeVehicle(v) {
    const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1);
    if (v.driver && !v.driver.isPlayer) v.driver.vehicle = null;
  }
  addMoney(n) { this.state.money = Math.max(0, this.state.money + n); this.missions?.save(); }

  inView(x, z) { this._sph.center.set(x, 2, z); return this.frustum.intersectsSphere(this._sph); }

  // ---------------------------- Bucle ----------------------------
  tick(now) {
    requestAnimationFrame((t) => this.tick(t));
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const I = this.input;
    I.update(dt);
    if (!this.started) { this.updateStart(); I.consume(); this.render(1, dt); return; }
    if (this.handleMenus() || this.paused) I.consume();
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.acc >= STEP && n < 5) { this.step(STEP); I.consume(); this.acc -= STEP; n++; }
      if (n === 5) this.acc = 0;
      this.hud.update(dt);
      this.minimap.update(this.cam.yaw);
      this.audio.update();
    }
    this.render(this.acc / STEP, dt);
    this.measure(dt);
  }

  step(dt) {
    const P = this.player;
    for (const v of this.vehicles) v.savePrev();
    for (const l of this.charLists) for (const c of l) c.savePrev();
    P.update(dt, this.input, this.cam);
    this.traffic.update(dt);
    this.police.update(dt);
    this.peds.update(dt);
    // IA de vehículos de misión (rivales de carrera, objetivos que huyen)
    for (const v of this.vehicles) if (v.owner === 'mission' && v.ai && v.driver && !v.driver.isPlayer) v.ai.update(dt);
    for (const v of this.vehicles) v.step(dt, this.world, this.onImpact);
    this.collideVehicles();
    this.collideCharsWithVehicles();
    for (const v of this.vehicles) if (v.hp <= 0 && !v.dead) this.destroyVehicle(v);
    this.wanted.update(dt);
    this.missions.update(dt);
    this.pickups.update(dt);
    this.combat.update(dt);
    this.gps.update(dt);
    this.services(dt);
    this.landmarks.update(dt, this.minutes);
    this.minutes = (this.minutes + dt) % 1440;
    shared.uTime.value += dt;
    if (P.inVehicle) { const v = P.vehicle; this.audio.setEngine(true, Math.abs(v.vf), v.input.throttle); }
    if ((this.streetT -= dt) <= 0) {
      this.streetT = 0.6;
      const p = P.pos(), w = this.world.graph.nearestWay(p.x, p.z);
      if (w >= 0 && this.world.graph.ways[w].n) this.hud.street(this.world.graph.ways[w].n);
    }
  }

  onImpact = (v, impact, amount) => {
    if (v === this.player.vehicle) {
      this.audio.crash(impact);
      this.input.rumble(clamp(impact / 15, 0.2, 1), clamp(impact / 10, 0.2, 1), 140);
      this.combat.shake = Math.max(this.combat.shake, clamp(impact / 25, 0, 0.6));
    }
  };

  collideVehicles() {
    const V = this.vehicles;
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const a = V[i], b = V[j];
      if (Math.abs(a.x - b.x) > 9 || Math.abs(a.z - b.z) > 9) continue;
      const before = a.hp + b.hp;
      Vehicle.collide(a, b, this.onImpact);
      const P = this.player.vehicle;
      if (P && (a === P || b === P) && before - (a.hp + b.hp) > 4) {
        const other = a === P ? b : a;
        if (other.owner === 'police') this.wanted.report('shootCop', other.x, other.z);
        if (other.driver && !other.driver.isPlayer && other.ai && other.owner === 'traffic' && Math.random() < 0.3) this.audio.horn();
      }
    }
  }

  collideCharsWithVehicles() {
    const box = this._box || (this._box = { x: 0, z: 0, hw: 0, hd: 0, c: 0, s: 0 });
    const hit = this._hit || (this._hit = { nx: 0, nz: 0, depth: 0 });
    for (const v of this.vehicles) {
      const sp = v.speed, R = v.spec.len / 2 + 1;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      for (const list of this.charLists) for (const c of list) {
        if (!c.onFoot) continue;
        const dx = c.x - v.x, dz = c.z - v.z;
        if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
        const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;
        const hw = v.spec.wid / 2 + 0.35, hd = v.spec.len / 2 + 0.35;
        if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
        if (sp > 3 && !c.isDown) {
          const k = 1.1;
          if (c.isPlayer) { if (c === this.player.ch) this.player.hurt(sp * 2.5); c.knock(v.vx * k, v.vz * k, 0); }
          else c.knock(v.vx * k + (Math.random() - 0.5) * 3, v.vz * k + (Math.random() - 0.5) * 3, sp * 7);
          v.vx *= 0.92; v.vz *= 0.92;
          this.audio.punch();
          if (v.driver?.isPlayer) {
            this.wanted.report(c.kind === 'cop' ? 'shootCop' : c.alive ? 'hitPed' : 'killPed', c.x, c.z);
            this.input.rumble(0.5, 0.3, 100);
          }
          this.peds.panic(c.x, c.z, 25);
        } else {
          // Empujar fuera de la carrocería
          box.x = v.x; box.z = v.z; box.hw = v.spec.wid / 2; box.hd = v.spec.len / 2; box.c = -fz; box.s = fx;
          const cdx = c.x - box.x, cdz = c.z - box.z;
          const ux = cdx * box.c + cdz * box.s, uz = -cdx * box.s + cdz * box.c;
          const pxp = box.hw + 0.35 - Math.abs(ux), pzp = box.hd + 0.35 - Math.abs(uz);
          if (pxp > 0 && pzp > 0) {
            if (pxp < pzp) { const s = Math.sign(ux) || 1; c.x += box.c * s * pxp; c.z += box.s * s * pxp; }
            else { const s = Math.sign(uz) || 1; c.x += -box.s * s * pzp; c.z += box.c * s * pzp; }
          }
        }
      }
    }
  }

  destroyVehicle(v) {
    v.dead = true; v.burn = 0; v.hp = 0;
    this.combat.explode(v.x, v.z, v.playerHit || v === this.player.vehicle ? 'player' : null);
    if (v.driver?.isPlayer) this.player.hurt(250);
    else if (v.driver) { v.driver.alive = false; v.driver.hp = 0; }
  }

  services(dt) {
    const P = this.player, W = this.wanted;
    const t = this.world.places['Taller:road'];
    if (t && P.inVehicle) {
      const v = P.vehicle, d = Math.hypot(v.x - t[0], v.z - t[1]);
      if (d < 7 && v.speed < 4 && !this.tallerBusy) {
        if (W.level && W.seen) { if (!this.tallerWarn) { this.hud.notify('La policía te está viendo: ¡piérdela primero!'); this.tallerWarn = true; } }
        else if (W.level || v.hp < v.spec.hp) {
          const cost = W.level ? 300 : 100;
          if (this.state.money < cost) this.hud.notify(`Pinta y Listo: necesitas ${fmtMoney(cost)}`);
          else {
            this.addMoney(-cost); v.hp = v.spec.hp; v.burn = -1;
            if (W.level) { v.paint = PAINTS[Math.floor(Math.random() * PAINTS.length)]; W.level = 0; this.police.units.forEach((u) => (u.veh.sirenOn = false)); }
            this.hud.fade(0.8); this.hud.notify(`Pinta y Listo: ${fmtMoney(cost)}. ¡Como nuevo!`); this.audio.pickup();
          }
          this.tallerBusy = true;
        }
      }
      if (d > 12) { this.tallerBusy = false; this.tallerWarn = false; }
    }
  }

  onPlayerDown(kind) {
    this.player.deathKind = kind;
    this.timeScale = 0.35;
    this.hud.bigText(kind === 'wasted' ? 'ELIMINADO' : 'ARRESTADO', kind === 'wasted' ? 'Cuenta de la clínica: $400' : 'Multa y decomiso de armas: $300', 4, kind === 'wasted' ? '#ef5350' : '#64b5f6');
    this.audio.jingle(false);
    setTimeout(() => {
      const P = this.player, W = this.world.places;
      const at = kind === 'wasted' ? W['Clínica'] : W['Palacio Municipal'] || W['Clínica'];
      this.addMoney(kind === 'wasted' ? -400 : -300);
      if (kind === 'busted') P.hero.ammo = P.hero.ammo.map(() => 0);
      P.hero.weapon = 0;
      this.wanted.level = 0; this.police.clearAll();
      P.respawn(at[0] + 1.5, at[1] + 1.5);
      this.cam.snap = true; this.timeScale = 1; this.hud.fade(1);
    }, 3800);
  }

  // ---------------------------- Cámara y render ----------------------------
  updateCamera(alpha, dt) {
    const P = this.player, I = this.input, C = this.cam;
    let tx, tz, ty, follow = null;
    if (P.inVehicle) { const v = P.vehicle; tx = lerp(v.px, v.x, alpha); tz = lerp(v.pz, v.z, alpha); ty = 1.6 + v.spec.hgt * 0.5; follow = v; }
    else { const c = P.ch; tx = lerp(c.px, c.x, alpha); tz = lerp(c.pz, c.z, alpha); ty = 1.55 + c.y * 0.6; }
    if (!this.paused && this.started) {
      C.yaw -= I.rx * 2.7 * dt; C.pitch = clamp(C.pitch + I.ry * 1.6 * dt, -0.25, 1.1);
      const moved = Math.abs(I.rx) + Math.abs(I.ry) > 0.05;
      C.idle = moved ? 0 : C.idle + dt;
      if (follow && C.idle > 1 && follow.speed > 3) {
        const dirYaw = follow.vf >= 0 ? Math.atan2(follow.vx, follow.vz) : follow.yaw;
        C.yaw = dampAngle(C.yaw, dirYaw, 2.4, dt);
        C.pitch = damp(C.pitch, 0.22, 1.5, dt);
      }
    }
    const aim = P.aiming && !P.inVehicle;
    let dist = follow ? 7 + follow.spec.len * 0.6 + Math.min(follow.speed, 40) * 0.06 : aim ? 2.4 : 5.2;
    const lookBack = follow && I.held(BTN.B);
    const yaw = lookBack ? C.yaw + Math.PI : C.yaw;
    C.dist = C.snap ? dist : damp(C.dist, dist, 5, dt);
    const fx = Math.sin(yaw), fz = Math.cos(yaw), cp = Math.cos(C.pitch), sp = Math.sin(C.pitch);
    const sh = aim ? 0.75 : 0; // cámara al hombro
    const ox = tx - fz * sh, oz = tz + fx * sh;
    let cx = ox - fx * cp * C.dist, cz = oz - fz * cp * C.dist, cy = ty + sp * C.dist;
    // Evitar que la cámara atraviese edificios
    const o = this._co || (this._co = { t: 1 });
    if (this.world.segmentBlocked(ox, oz, cx, cz, Math.min(ty, cy), o)) {
      const t = Math.max(0.15, o.t - 0.08);
      cx = ox + (cx - ox) * t; cz = oz + (cz - oz) * t; cy = ty + (cy - ty) * t;
    }
    cy = Math.max(cy, 0.6);
    const k = C.snap ? 1 : 1 - Math.exp(-18 * dt);
    C.x += (cx - C.x) * k; C.y += (cy - C.y) * k; C.z += (cz - C.z) * k;
    C.snap = false;
    const s = this.combat.shake;
    this.camera.position.set(C.x + (Math.random() - 0.5) * s, C.y + (Math.random() - 0.5) * s, C.z + (Math.random() - 0.5) * s);
    this.camera.lookAt(ox + fx * (aim ? 4 : 0), ty + (aim ? -sp * 2 : 0), oz + fz * (aim ? 4 : 0));
    const fov = aim ? 48 : 62 + (follow ? Math.min(follow.speed, 45) * 0.35 : 0);
    C.fov = damp(C.fov, fov, 4, dt);
    if (Math.abs(this.camera.fov - C.fov) > 0.05) { this.camera.fov = C.fov; this.camera.updateProjectionMatrix(); }
    return [tx, tz];
  }

  updateSky() {
    const m = this.minutes;
    const elev = Math.sin(((m - 360) / 1440) * Math.PI * 2); // 1 al mediodía, -1 a medianoche
    const day = smoothstep(-0.12, 0.25, elev), night = 1 - smoothstep(-0.2, 0.05, elev);
    const dusk = clamp(1 - Math.abs(elev) * 4, 0, 1) * (1 - night * 0.5);
    const cDay = this._cDay || (this._cDay = new THREE.Color(0x9fd4ff)), cDusk = this._cDusk || (this._cDusk = new THREE.Color(0xffa36b)), cNight = this._cNight || (this._cNight = new THREE.Color(0x101a36));
    const mist = this._mist || (this._mist = new THREE.Color(0xc9d6dc));
    this.sky.copy(cNight).lerp(cDay, day).lerp(cDusk, dusk * 0.6);
    const fogMist = clamp(0.35 + (this.fogBoost - 1) * 0.4, 0, 0.9);
    this.scene.fog.color.copy(this.sky).lerp(mist, fogMist * (1 - night * 0.7));
    const far = this.q.far / this.fogBoost;
    this.scene.fog.far = far; this.scene.fog.near = Math.min(60, far * 0.15);
    this.hemi.intensity = 0.35 + day * 0.85;
    this.hemi.color.setHSL(0.58, 0.5, 0.55 + day * 0.3);
    this.sun.intensity = 0.25 + day * 1.5;
    this.sun.color.copy(this._sunC || (this._sunC = new THREE.Color())).setRGB(1, 0.85 + day * 0.1, 0.7 + day * 0.2);
    if (night > 0.5) this.sun.color.setRGB(0.55, 0.65, 1);
    shared.uNight.value = night;
    if (this.world.lampMat) this.world.lampMat.emissiveIntensity = night * 2.2;
    this.nightF = night;
    const ang = ((m - 360) / 1440) * Math.PI * 2;
    this.sunDir = this.sunDir || new THREE.Vector3();
    const up = elev > 0 ? 1 : -1; // de noche la luz principal es la luna (opuesta)
    this.sunDir.set(Math.cos(ang) * up * 0.8, Math.max(0.35, Math.abs(elev)), 0.45).normalize();
  }

  render(alpha, dt) {
    const [tx, tz] = this.updateCamera(alpha, dt);
    this.updateSky();
    // Sombras siguiendo al jugador, ajustadas a la rejilla de texels (sin parpadeo)
    const snap = 150 / (this.q.shadow || 1024);
    const sx = Math.round(tx / snap) * snap, sz = Math.round(tz / snap) * snap;
    this.sun.position.set(sx + this.sunDir.x * 150, this.sunDir.y * 150, sz + this.sunDir.z * 150);
    this.sun.target.position.set(sx, 0, sz);
    // Faros de noche
    const P = this.player;
    if (P.inVehicle && this.nightF > 0.3) {
      const v = P.vehicle, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      this.headlight.intensity = 60 * this.nightF;
      this.headlight.position.set(v.x + fx * 2, 1.1, v.z + fz * 2);
      this.headlight.target.position.set(v.x + fx * 22, 0, v.z + fz * 22);
    } else this.headlight.intensity = 0;
    this.world.updateVisibility(this.cam.x, this.cam.z, this.scene.fog.far);
    this.vrender.render(this.vehicles, alpha, this.cam.x, this.cam.z, dt, this.scene.fog.far);
    this.crowd.render(this.charLists, alpha, this.cam.x, this.cam.z, Math.min(150, this.scene.fog.far));
    this.renderer.render(this.scene, this.camera);
    this.pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
  }

  // Resolución adaptativa: sostener ~60 FPS bajando/subiendo el pixel ratio.
  measure(dt) {
    const F = this.fps; F.frames++; F.t += dt;
    if (F.t < 1) return;
    F.value = F.frames / F.t; F.frames = 0; F.t = 0;
    if (F.value < 52) F.low++; else F.low = Math.max(0, F.low - 1);
    if (F.low >= 2 && this.dpr > 0.6) { this.dpr = Math.max(0.6, this.dpr - 0.1); this.renderer.setPixelRatio(this.dpr); F.low = 0; }
    else if (F.value > 58.5 && this.dpr < this.maxDpr) { this.dpr = Math.min(this.maxDpr, this.dpr + 0.05); this.renderer.setPixelRatio(this.dpr); }
    const el = document.getElementById('fps');
    el.style.display = F.show ? 'block' : 'none';
    if (F.show) {
      const info = this.renderer.info.render;
      el.textContent = `${F.value.toFixed(0)} FPS · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · DPR ${this.dpr.toFixed(2)} · ${this.vehicles.length} autos · ${this.peds.list.length} peatones`;
    }
  }

  // ---------------------------- Menús ----------------------------
  setupMenus() {
    this.menuItems = [
      { label: 'Continuar', act: () => this.closeOverlay() },
      { label: () => `Calidad: ${this.quality}`, act: () => { const ks = Object.keys(QUALITY); this.applyQuality(ks[(ks.indexOf(this.quality) + 1) % ks.length]); } },
      { label: () => `Contador de FPS: ${this.fps.show ? 'Sí' : 'No'}`, act: () => { this.fps.show = !this.fps.show; } },
      { label: 'Reiniciar historia', act: () => { this.missions.cleanup(); this.missions.reset(); this.hud.notify('Historia reiniciada'); this.closeOverlay(); } },
    ];
    this.menuSel = 0;
  }
  openOverlay(name) {
    this.overlay = name; this.paused = name !== 'phone';
    for (const id of ['pause', 'bigmap', 'phone']) document.getElementById(id).classList.toggle('show', id === (name === 'map' ? 'bigmap' : name));
    if (name === 'map') this.minimap.drawBig();
    if (name === 'pause') this.renderMenu();
    if (name === 'phone') this.renderPhone();
    this.audio.click();
  }
  closeOverlay() {
    this.overlay = null; this.paused = false;
    for (const id of ['pause', 'bigmap', 'phone']) document.getElementById(id).classList.remove('show');
  }
  renderMenu() {
    document.getElementById('menuitems').innerHTML = this.menuItems.map((m, i) => `<li class="${i === this.menuSel ? 'sel' : ''}">${typeof m.label === 'function' ? m.label() : m.label}</li>`).join('');
  }
  renderPhone() {
    const m = this.missions.next, M = this.missions;
    const done = M.index;
    document.getElementById('phonebody').innerHTML = `
      <div class="ph-h">Zacatlán Libre</div>
      <div class="ph-card"><b>${M.active ? 'En curso' : m ? 'Siguiente misión' : 'Historia terminada'}</b><br>${M.active ? M.active.title : m ? `${m.title}<br><small>Con ${m.giver} · ${m.start}</small>` : '¡Zacatlán es tuyo!'}</div>
      <div class="ph-card">Progreso: <b>${done}/${STORY.length}</b><br>Dinero: <b>${fmtMoney(this.state.money)}</b></div>
      <div class="ph-card"><small>Ⓐ marcar ruta GPS · ◀ ▶ cambiar personaje · Ⓑ cerrar</small></div>`;
  }
  handleMenus() {
    const I = this.input;
    if (I.held(BTN.VIEW) && I.pressed(BTN.MENU)) { this.fps.show = !this.fps.show; return true; }
    if (this.overlay === 'pause') {
      const n = this.menuItems.length;
      if (I.pressed(BTN.DOWN) || (I.ly > 0.6 && !this.stickLock)) { this.menuSel = (this.menuSel + 1) % n; this.stickLock = true; this.audio.click(); this.renderMenu(); }
      if (I.pressed(BTN.UP) || (I.ly < -0.6 && !this.stickLock)) { this.menuSel = (this.menuSel + n - 1) % n; this.stickLock = true; this.audio.click(); this.renderMenu(); }
      if (Math.abs(I.ly) < 0.3) this.stickLock = false;
      if (I.pressed(BTN.A)) { this.menuItems[this.menuSel].act(); if (this.overlay === 'pause') this.renderMenu(); }
      if (I.pressed(BTN.B) || I.pressed(BTN.MENU)) this.closeOverlay();
      return true;
    }
    if (this.overlay === 'map') { if (I.pressed(BTN.VIEW) || I.pressed(BTN.B) || I.pressed(BTN.MENU) || I.pressed(BTN.DOWN)) this.closeOverlay(); return true; }
    if (this.overlay === 'phone') {
      if (I.pressed(BTN.A)) { const m = this.missions.next; if (m && !this.missions.active) { const [x, z] = this.missions.startSpot(m); this.gps.set(x, z, '#f06292', false); this.missions.gpsForced = true; this.hud.notify('Ruta marcada en el GPS'); } this.closeOverlay(); }
      else if (I.pressed(BTN.B) || I.pressed(BTN.UP)) { this.closeOverlay(); return true; }
      return false;
    }
    if (I.pressed(BTN.MENU)) { this.menuSel = 0; this.openOverlay('pause'); return true; }
    if (I.pressed(BTN.VIEW) || I.pressed(BTN.DOWN)) { this.openOverlay('map'); return true; }
    if (I.pressed(BTN.UP)) { this.openOverlay('phone'); return true; }
    return false;
  }

  updateStart() {
    const I = this.input, st = document.getElementById('padstatus');
    st.textContent = I.connected ? `🎮 Control listo: ${I.id.split('(')[0].trim() || 'Xbox'}` : I.debug ? '⌨ Modo depuración (teclado activo)' : 'Conecta tu control Xbox por Bluetooth y presiona cualquier botón';
    st.classList.toggle('ok', I.connected || I.debug);
    if (I.pressed(BTN.A)) {
      this.started = true;
      document.getElementById('start').classList.add('hide');
      this.audio.unlock().then((ok) => { if (!ok) this.hud.notify('Haz clic una vez en la pantalla para activar el sonido', 6); });
      addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
      this.hud.bigText('ZACATLÁN LIBRE', 'Pueblo Mágico · Sierra Norte de Puebla', 4, '#ffd54f');
      setTimeout(() => this.hud.notify('Sigue el marcador ~p~rosa~w~ o ~b~azul~w~ para empezar una misión. ⬆ teléfono · ⧉ mapa', 7), 4200);
      this.cam.snap = true;
    }
  }
}

try { window.game = new Game(); }
catch (e) { console.error(e); document.getElementById('loading').textContent = 'Error al iniciar: ' + e.message; }
