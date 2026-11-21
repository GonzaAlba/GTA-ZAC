// Estilo de las fachadas por zona. Cada ubicación de panorámica del centro es un "ancla":
// las casas toman el estilo del ancla más cercana (≤ 140 m); fuera de eso, según la distancia al zócalo.
// Puedes editar paletas y reglas viendo las calles reales; no se usa ninguna imagen de terceros.
import panos from './panoData.js';

export const STYLE = { COLONIAL: 0, COMERCIAL: 1, POPULAR: 2 };

export const PALETTES = {
  // muros
  [STYLE.COLONIAL]: [0xf7f2e8, 0xf3e8d0, 0xf7f2e8, 0xefe0bf, 0xf9f6ef, 0xe9d7b4],
  [STYLE.COMERCIAL]: [0xf7f2e8, 0xf2dfb2, 0xeeb08f, 0xf2c84b, 0x9cc9d8, 0xe89bb0, 0xf3e8d0],
  [STYLE.POPULAR]: [0xf6f1e7, 0xf2dfb2, 0xeeb08f, 0xd9734e, 0xf2c84b, 0x9cc9d8, 0xe89bb0, 0xb9d27a, 0xe0a24a, 0xc9a6d8, 0xbfbab0],
};
// Rodapiés (índice 0..4 en el shader): rojo óxido, ladrillo, ocre, verde, gris piedra
export const RODAPIES = [0x9e3a2b, 0xb5532f, 0xc0883a, 0x4f7a52, 0x8a8178];
export const TEJAS = [0xb5532f, 0xa34a2c, 0xc2643a, 0x9a4229, 0x8f3d26];

// Calles comerciales del centro (tiendas con letrero y toldo en planta baja)
const COMERCIALES = /Cabrera|Ju[aá]rez|Hidalgo|Iturbide|Matamoros|119|2 de Abril|Libertad|Bravo|Dolores|Leandro|Independencia/i;

export const ANCHORS = panos.map((p) => {
  const r = Math.hypot(p.x, p.z);
  const style = r < 170 ? STYLE.COLONIAL : COMERCIALES.test(p.calle) ? STYLE.COMERCIAL : r < 320 ? STYLE.COLONIAL : STYLE.POPULAR;
  return { x: p.x, z: p.z, style };
});

export function styleAt(x, z) {
  let best = null, bd = 140 * 140;
  for (const a of ANCHORS) { const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; } }
  if (best) return best.style;
  const r = Math.hypot(x, z);
  return r < 300 ? STYLE.COLONIAL : r < 520 ? STYLE.COMERCIAL : STYLE.POPULAR;
}

// Letreros genéricos de comercios (atlas 4×4 generado en canvas)
export const SHOPS = ['ABARROTES', 'PAPELERÍA', 'FARMACIA', 'TORTILLERÍA', 'SIDRA Y FRUTA', 'PANADERÍA', 'FERRETERÍA', 'CARNICERÍA',
  'MERCERÍA', 'ESTÉTICA', 'TACOS', 'CAFÉ DE OLLA', 'REFACCIONES', 'DULCERÍA', 'ZAPATERÍA', 'MISCELÁNEA'];
