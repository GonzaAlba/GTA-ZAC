// Audio 100% procedural con WebAudio: motor, efectos, sirena y 3 estaciones de radio originales.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const STATIONS = [
  { name: 'La Serrana 98.1', genre: 'Cumbia', bpm: 96 },
  { name: 'Banda Manzanera 101.5', genre: 'Banda', bpm: 118 },
  { name: 'Neblina FM 88.8', genre: 'Electrónica', bpm: 124 },
  { name: 'Radio apagada', genre: '', bpm: 0 },
];

export class Audio {
  constructor() { this.ctx = null; this.station = 0; this.radioOn = false; this.step = 0; this.nextTime = 0; }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.8;
      const comp = c.createDynamicsCompressor(); this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.gain.value = 0.0; this.music.connect(this.master);
      // Ruido blanco reutilizable
      const len = c.sampleRate * 1.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // Motor
      this.eng = c.createOscillator(); this.eng.type = 'sawtooth';
      this.eng2 = c.createOscillator(); this.eng2.type = 'square';
      this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600;
      this.engG = c.createGain(); this.engG.gain.value = 0;
      const g2 = c.createGain(); g2.gain.value = 0.35;
      this.eng.connect(this.engF); this.eng2.connect(g2).connect(this.engF); this.engF.connect(this.engG).connect(this.sfx);
      this.eng.start(); this.eng2.start();
      // Sirena
      this.sir = c.createOscillator(); this.sir.type = 'square';
      this.sirF = c.createBiquadFilter(); this.sirF.type = 'lowpass'; this.sirF.frequency.value = 1800;
      this.sirG = c.createGain(); this.sirG.gain.value = 0;
      this.sir.connect(this.sirF).connect(this.sirG).connect(this.sfx); this.sir.start();
      this.sirPh = 0;
    }
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* sin gesto de usuario */ } }
    return this.ctx.state === 'running';
  }
  get ok() { return this.ctx && this.ctx.state === 'running'; }

  // ---------- Efectos ----------
  burst(dur, freq, q, gain, type = 'bandpass', attack = 0.002) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, type = 'square', gain = 0.15, when = 0, dest = this.sfx, slideTo = 0) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  shot(dist = 0) { const v = 0.9 / (1 + dist * 0.05); this.burst(0.18, 1400, 0.8, v); this.tone(160, 0.12, 'triangle', v * 0.5, 0, this.sfx, 60); }
  explosion(dist = 0) { const v = 1.2 / (1 + dist * 0.02); this.burst(1.6, 300, 0.5, v, 'lowpass', 0.01); this.tone(80, 1, 'sine', v * 0.6, 0, this.sfx, 30); }
  crash(intensity) { this.burst(0.35, 500 + intensity * 30, 0.7, Math.min(0.9, intensity * 0.06)); }
  punch() { this.burst(0.12, 250, 1, 0.5, 'lowpass'); }
  horn() { this.tone(392, 0.35, 'square', 0.12); this.tone(494, 0.35, 'square', 0.1); }
  pickup() { [72, 76, 79, 84].forEach((n, i) => this.tone(NOTE(n), 0.15, 'triangle', 0.12, i * 0.07)); }
  jingle(ok = true) {
    const seq = ok ? [67, 72, 76, 79, 84, 79, 84] : [64, 60, 57, 52];
    seq.forEach((n, i) => this.tone(NOTE(n), 0.32, 'square', 0.08, i * 0.12, this.master));
  }
  click() { this.tone(1200, 0.04, 'square', 0.05); }

  setEngine(active, speed, throttle) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const rpm = 40 + (speed % 14) * 6 + speed * 1.6 + throttle * 25;
    this.eng.frequency.setTargetAtTime(rpm, t, 0.05);
    this.eng2.frequency.setTargetAtTime(rpm * 0.5, t, 0.05);
    this.engF.frequency.setTargetAtTime(300 + throttle * 900 + speed * 15, t, 0.08);
    this.engG.gain.setTargetAtTime(active ? 0.07 + throttle * 0.05 : 0, t, 0.1);
  }
  setSiren(volume, dt) {
    if (!this.ok) return;
    this.sirPh += dt;
    const f = 650 + Math.sin(this.sirPh * 2.2) * 280;
    const t = this.ctx.currentTime;
    this.sir.frequency.setTargetAtTime(f, t, 0.02);
    this.sirG.gain.setTargetAtTime(volume * 0.06, t, 0.15);
  }

  // ---------- Radio ----------
  setRadio(on) {
    if (!this.ok) return;
    this.radioOn = on;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(on && STATIONS[this.station].bpm ? 0.55 : 0, t, 0.3);
    if (on && this.nextTime < t) this.nextTime = t + 0.05;
  }
  nextStation(dir) {
    this.station = (this.station + dir + STATIONS.length) % STATIONS.length;
    this.step = 0;
    this.burst(0.25, 3000, 0.3, 0.15, 'highpass');
    this.setRadio(this.radioOn);
    return STATIONS[this.station];
  }
  update() {
    if (!this.ok || !this.radioOn) return;
    const st = STATIONS[this.station];
    if (!st.bpm) return;
    const c = this.ctx, spb = 60 / st.bpm / 4; // semicorcheas
    if (this.nextTime < c.currentTime - 0.5) this.nextTime = c.currentTime + 0.05;
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.station, this.step, this.nextTime - c.currentTime, spb);
      this.step++; this.nextTime += spb;
    }
  }
  drum(kind, when) {
    const c = this.ctx, t = c.currentTime + when, d = this.music;
    if (kind === 'kick') { const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = c.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g).connect(d); o.start(t); o.stop(t + 0.3); return; }
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); const g = c.createGain();
    const [type, fr, dur, vol] = kind === 'hat' ? ['highpass', 7000, 0.04, 0.15] : kind === 'guiro' ? ['bandpass', 4000, 0.06, 0.18] : ['bandpass', 1800, 0.12, 0.3];
    f.type = type; f.frequency.value = fr;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(d); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  playStep(st, i, w, spb) {
    const bar = Math.floor(i / 16) % 4, s = i % 16, d = this.music;
    const prog = [[57, 64], [52, 59], [55, 62], [52, 59]][bar]; // Am - Em - G - Em
    const scaleM = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
    const mel = (seed) => scaleM[Math.floor(Math.abs(Math.sin(seed * 12.9898) * 43758.5) % scaleM.length)];
    if (st === 0) { // Cumbia
      if (s % 4 === 0) this.tone(NOTE(prog[(s / 4) % 2 ? 1 : 0] - 12), spb * 3, 'triangle', 0.3, w, d);
      if (s % 2 === 1) this.drum('guiro', w);
      if (s === 4 || s === 12) this.drum('snare', w);
      if (s % 8 === 0) this.drum('kick', w);
      if (s % 3 === 0 && s < 14) this.tone(NOTE(mel(bar * 7 + s) + 12), spb * 2.2, 'square', 0.05, w, d);
    } else if (st === 1) { // Banda
      if (s % 8 === 0) this.tone(NOTE(prog[0] - 24), spb * 3, 'sawtooth', 0.22, w, d);
      if (s % 8 === 4) this.tone(NOTE(prog[1] - 24), spb * 3, 'sawtooth', 0.2, w, d);
      if (s % 8 === 4 || s % 8 === 6) { this.tone(NOTE(prog[0] + 3), spb * 1.2, 'sawtooth', 0.04, w, d); this.tone(NOTE(prog[1]), spb * 1.2, 'sawtooth', 0.04, w, d); }
      if (s % 4 === 0) this.drum('kick', w);
      if (s % 4 === 2) this.drum('snare', w);
      if (s % 2 === 0) this.tone(NOTE(mel(bar * 5 + s * 3) + 12), spb * 1.8, 'square', 0.05, w, d);
    } else if (st === 2) { // Electrónica
      if (s % 4 === 0) this.drum('kick', w);
      if (s % 4 === 2) this.drum('hat', w);
      if (s === 4 || s === 12) this.drum('snare', w);
      this.tone(NOTE(prog[s % 3 === 0 ? 1 : 0] - 12), spb * 0.9, 'sawtooth', 0.09, w, d);
      if (s % 8 === 0) this.tone(NOTE(mel(bar + s) + 12), spb * 6, 'triangle', 0.06, w, d);
    }
  }
}
