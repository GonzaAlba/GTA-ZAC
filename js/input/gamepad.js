// Entrada por control Xbox (Gamepad API, mapeo "standard").
// El teclado sólo existe como pad virtual de depuración con ?debug=1 en la URL.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const NB = 17;
const DEADZONE = 0.16;

function radial(x, y, out, i) {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) { out[i] = 0; out[i + 1] = 0; return; }
  const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  out[i] = x * s; out[i + 1] = y * s;
}

export class Input {
  constructor() {
    this.axes = new Float32Array(4); // lx, ly, rx, ry
    this.lt = 0; this.rt = 0;
    this.cur = new Uint8Array(NB); this.prev = new Uint8Array(NB);
    this.heldTime = new Float32Array(NB);
    this.index = -1; this.id = ''; this.connected = false;
    this.debug = new URLSearchParams(location.search).has('debug');
    this.keys = new Set(); this.latch = new Set();
    this.mouse = { l: false, r: false };
    window.addEventListener('gamepadconnected', (e) => { if (this.index < 0) this.index = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.index === this.index) this.index = -1; });
    if (this.debug) {
      addEventListener('keydown', (e) => { this.keys.add(e.code); this.latch.add(e.code); if (e.code === 'Tab') e.preventDefault(); });
      addEventListener('keyup', (e) => this.keys.delete(e.code));
      addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true; });
      addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
      addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  get lx() { return this.axes[0]; } get ly() { return this.axes[1]; }
  get rx() { return this.axes[2]; } get ry() { return this.axes[3]; }
  held(b) { return this.cur[b] === 1; }
  pressed(b) { return this.cur[b] === 1 && this.prev[b] === 0; }
  released(b) { return this.cur[b] === 0 && this.prev[b] === 1; }
  // Se soltó tras una pulsación corta (para distinguir "toque" de "mantener").
  tapped(b, max = 0.22) { return this.released(b) && this.lastHeld[b] < max; }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.index >= 0 && pads[this.index]?.connected) return pads[this.index];
    for (const p of pads) if (p && p.connected) { this.index = p.index; return p; }
    return null;
  }

  update(dt) {
    if (!this.lastHeld) { this.lastHeld = new Float32Array(NB); this.raw = new Uint8Array(NB); }
    const p = this.pad();
    this.connected = !!p;
    this.id = p ? p.id : '';
    this.cur.fill(0); this.axes.fill(0); this.lt = 0; this.rt = 0;
    if (p) {
      radial(p.axes[0] || 0, p.axes[1] || 0, this.axes, 0);
      radial(p.axes[2] || 0, p.axes[3] || 0, this.axes, 2);
      for (let i = 0; i < NB && i < p.buttons.length; i++) this.cur[i] = p.buttons[i].pressed ? 1 : 0;
      this.lt = p.buttons[6]?.value || 0; this.rt = p.buttons[7]?.value || 0;
      if (this.lt < 0.08) this.lt = 0; if (this.rt < 0.08) this.rt = 0;
    }
    if (this.debug) this.applyKeyboard();
    for (let i = 0; i < NB; i++) {
      if (this.cur[i]) this.heldTime[i] += dt;
      else { if (this.raw[i]) this.lastHeld[i] = this.heldTime[i]; this.heldTime[i] = 0; }
    }
    this.raw.set(this.cur);
  }

  applyKeyboard() {
    const k = { has: (c) => this.keys.has(c) || this.latch.has(c) }, ax = this.axes;
    const v = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    if (!ax[0] && !ax[1]) { ax[0] = v('KeyD', 'KeyA'); ax[1] = v('KeyS', 'KeyW'); }
    if (!ax[2] && !ax[3]) { ax[2] = v('KeyL', 'KeyJ'); ax[3] = v('KeyK', 'KeyI'); }
    const set = (b, ...codes) => { if (codes.some((c) => k.has(c))) this.cur[b] = 1; };
    set(BTN.A, 'Space'); set(BTN.Y, 'KeyF'); set(BTN.X, 'KeyR'); set(BTN.B, 'KeyC');
    set(BTN.LB, 'KeyZ'); set(BTN.RB, 'KeyX'); set(BTN.VIEW, 'Tab'); set(BTN.MENU, 'Escape', 'KeyP');
    set(BTN.UP, 'Digit1'); set(BTN.DOWN, 'Digit2'); set(BTN.LEFT, 'Digit3'); set(BTN.RIGHT, 'Digit4');
    if (k.has('ArrowUp') || this.mouse.l) { this.rt = 1; this.cur[BTN.RT] = 1; }
    if (k.has('ArrowDown') || this.mouse.r) { this.lt = 1; this.cur[BTN.LT] = 1; }
    if (k.has('ArrowLeft')) ax[0] = -1; if (k.has('ArrowRight')) ax[0] = 1;
    this.latch.clear();
  }

  // Marca los flancos (pressed/released) como consumidos. Se llama tras cada paso de simulación
  // o cuando un menú usa la entrada, así ninguna pulsación se pierde ni se procesa dos veces.
  consume() { this.prev.set(this.cur); }

  // Vibración de ambos motores (Chrome/Edge: vibrationActuator "dual-rumble").
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const p = this.pad();
    const va = p?.vibrationActuator;
    if (va?.playEffect) va.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
