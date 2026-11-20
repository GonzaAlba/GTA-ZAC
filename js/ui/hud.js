// HUD en DOM/CSS: estrellas, dinero, arma, vida, subtítulos, objetivos, avisos y menús.
import { fmtMoney } from '../util.js';
import { WEAPONS } from '../systems/combat.js';

const $ = (id) => document.getElementById(id);
const colorize = (t) => {
  const esc = t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  let open = false;
  return esc.replace(/~([ybrgwp])~/g, (_, c) => { const close = open ? '</span>' : ''; open = c !== 'w'; return close + (c === 'w' ? '' : `<span class="c-${c}">`); }) + (open ? '</span>' : '');
};

export class HUD {
  constructor(game) {
    this.g = game;
    this.el = {
      stars: $('stars'), money: $('money'), weapon: $('weapon'), hp: $('hpbar'), armor: $('armorbar'),
      notify: $('notify'), big: $('bigtext'), bigT: $('bigtitle'), bigS: $('bigsub'), obj: $('objective'), sub: $('subtitle'),
      timer: $('timer'), radio: $('radio'), street: $('street'), vignette: $('vignette'), fade: $('fade'), cross: $('crosshair'),
      race: $('race'), fps: $('fps'), phone: $('phone'), map: $('bigmap'), pause: $('pause'), hero: $('hero'),
    };
    this.subQ = []; this.subT = 0; this.notifyT = 0; this.bigT = 0; this.radioT = 0; this.streetT = 0; this.lastStreet = '';
    this.starFlash = 0; this.shownMoney = game.state.money;
    this.el.stars.innerHTML = '<span>★</span>'.repeat(5);
    this.starEls = [...this.el.stars.children];
  }

  notify(text, dur = 3.5) { this.el.notify.innerHTML = colorize(text); this.el.notify.classList.add('show'); this.notifyT = dur; }
  bigText(title, sub = '', dur = 3, color = '#fff') {
    this.el.bigT.textContent = title; this.el.bigT.style.color = color; this.el.bigS.textContent = sub;
    this.el.big.classList.add('show'); this.bigT = dur;
  }
  objective(text) { this.el.obj.innerHTML = text ? colorize(text) : ''; this.el.obj.classList.toggle('show', !!text); }
  say(lines) { for (const [who, text] of lines) this.subQ.push([who, text]); if (this.subT <= 0) this.nextSub(); }
  nextSub() {
    const s = this.subQ.shift();
    if (!s) { this.el.sub.classList.remove('show'); return; }
    const col = s[0] === 'Citlali' ? 'c-p' : s[0] === 'Mateo' ? 'c-b' : 'c-y';
    this.el.sub.innerHTML = `<span class="${col}">${s[0]}:</span> ${s[1]}`;
    this.el.sub.classList.add('show'); this.subT = 2.2 + s[1].length * 0.045;
  }
  timer(sec) {
    if (sec == null) { this.el.timer.classList.remove('show'); return; }
    const s = Math.max(0, Math.ceil(sec));
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.classList.add('show'); this.el.timer.classList.toggle('urgent', s <= 10);
  }
  racePos(pos, total, cp, cps) { this.el.race.innerHTML = `<b>${pos}º</b>/${total} &nbsp; Control ${Math.min(cp + 1, cps)}/${cps}`; this.el.race.classList.add('show'); this.raceT = 0.3; }
  radio(st) { this.el.radio.innerHTML = `<b>${st.name}</b><small>${st.genre}</small>`; this.el.radio.classList.add('show'); this.radioT = 2.5; }
  flashStars() { this.starFlash = 2; }
  hit() { this.el.vignette.classList.remove('hit'); void this.el.vignette.offsetWidth; this.el.vignette.classList.add('hit'); }
  fade(dur = 0.6) { const f = this.el.fade; f.style.transition = 'none'; f.style.opacity = 1; requestAnimationFrame(() => { f.style.transition = `opacity ${dur}s`; f.style.opacity = 0; }); }
  street(name) {
    if (!name || name === this.lastStreet) return;
    this.lastStreet = name; this.el.street.textContent = name; this.el.street.classList.add('show'); this.streetT = 3;
  }

  update(dt) {
    const g = this.g, P = g.player, h = P.hero;
    // Estrellas: parpadean cuando la policía no te ve (como en el género)
    const W = g.wanted, blink = Math.floor(performance.now() / 280) % 2;
    this.starFlash -= dt;
    this.starEls.forEach((s, i) => {
      const on = i < W.level;
      s.className = on ? (!W.seen && W.level ? (blink ? 'on' : 'dim') : 'on') : this.starFlash > 0 && blink ? 'flash' : '';
    });
    this.el.stars.classList.toggle('active', W.level > 0);
    // Dinero con conteo animado
    this.shownMoney += (g.state.money - this.shownMoney) * Math.min(1, dt * 6);
    if (Math.abs(g.state.money - this.shownMoney) < 1) this.shownMoney = g.state.money;
    this.el.money.textContent = fmtMoney(this.shownMoney);
    const w = WEAPONS[h.weapon];
    this.el.weapon.innerHTML = `<span class="wi">${w.icon}</span>${w.melee ? '' : `<b>${h.ammo[h.weapon]}</b>`}`;
    this.el.hp.style.width = `${Math.max(0, h.hp)}%`;
    this.el.hp.classList.toggle('low', h.hp < 30);
    this.el.armor.style.width = `${h.armor}%`;
    this.el.hero.textContent = h.name;
    this.el.cross.classList.toggle('show', P.aiming);
    this.el.cross.classList.toggle('lock', !!P.aimTarget);
    if ((this.notifyT -= dt) <= 0) this.el.notify.classList.remove('show');
    if ((this.bigT -= dt) <= 0) this.el.big.classList.remove('show');
    if ((this.radioT -= dt) <= 0) this.el.radio.classList.remove('show');
    if ((this.streetT -= dt) <= 0) this.el.street.classList.remove('show');
    if ((this.raceT -= dt) <= 0) this.el.race.classList.remove('show');
    if (this.subT > 0 && (this.subT -= dt) <= 0) this.nextSub();
  }
}
