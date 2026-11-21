// Convierte el volcado de Overpass (OpenStreetMap, ODbL) en datos compactos del juego.
// Uso: node tools/osm-to-json.mjs tools/osm-raw.json js/world/mapData.js
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath = 'tools/osm-raw-v2.json', outPath = 'js/world/mapData.js'] = process.argv;
const raw = JSON.parse(readFileSync(inPath, 'utf8'));

// Origen: Zócalo de Zacatlán. x = este, z = sur (convención de Three.js con -z = norte).
const LAT0 = 19.9325, LON0 = -97.9606;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MZ = 110540;
const proj = (lat, lon) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
// Mundo rectangular: centro histórico + corredor de la carretera Interserrana al norte
const B = { x0: -1400, x1: 1500, z0: -4400, z1: 1250 };
const LIMIT = 1150;
const r1 = (v) => Math.round(v * 10) / 10;
const inside = ([x, z]) => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1;

const ROAD = {
  primary: [0, 11], secondary: [1, 10], tertiary: [2, 9], unclassified: [3, 8],
  residential: [3, 7.5], living_street: [4, 6], service: [5, 4.5],
  pedestrian: [6, 6], footway: [7, 2.6], path: [7, 2.2],
};

// --- Río y borde de la barranca (se calcula antes para recortar calles) ---
const riverPts = [];
for (const e of raw.elements) {
  if (e.type === 'way' && e.tags?.waterway === 'river') for (const g of e.geometry) riverPts.push(proj(g.lat, g.lon));
}
riverPts.sort((a, b) => a[1] - b[1]);
// Borde (ceja) de la barranca de los Jilgueros: trazado a mano a partir del límite urbano
// y de los miradores de OSM; se remuestrea cada 50 m en z.
const EDGE_CTRL = [[-1300, 560], [-300, 520], [-60, 640], [60, 560], [100, 485], [170, 310], [300, 140], [400, 40], [600, 50], [1300, 70]];
const edge = [];
for (let z = -LIMIT - 100; z <= LIMIT + 100; z += 50) {
  let i = 0; while (i < EDGE_CTRL.length - 2 && EDGE_CTRL[i + 1][0] < z) i++;
  const [z0, x0] = EDGE_CTRL[i], [z1, x1] = EDGE_CTRL[i + 1];
  edge.push([z, r1(x0 + ((x1 - x0) * (z - z0)) / (z1 - z0))]);
}
const edgeX = (z) => {
  const i = Math.max(0, Math.min(edge.length - 2, Math.floor((z - edge[0][0]) / 50)));
  const t = Math.max(0, Math.min(1, (z - edge[i][0]) / 50));
  return edge[i][1] * (1 - t) + edge[i + 1][1] * t;
};
const inWorld = (p) => inside(p); // la barranca ahora sale del modelo de elevación

// --- Grafo de calles ---
const nodeIndex = new Map();
const nodes = [];
const ways = [];
const getNode = (id, p) => {
  if (!nodeIndex.has(id)) { nodeIndex.set(id, nodes.length / 2); nodes.push(r1(p[0]), r1(p[1])); }
  return nodeIndex.get(id);
};
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.tags?.highway) continue;
  const spec = ROAD[e.tags.highway];
  if (!spec) continue;
  let run = [];
  const flush = () => { if (run.length >= 2) ways.push({ n: e.tags.name || '', t: spec[0], w: spec[1], ids: run }); run = []; };
  e.geometry.forEach((g, i) => {
    const p = proj(g.lat, g.lon);
    if (inWorld(p)) run.push(getNode(e.nodes[i], p)); else flush();
  });
  flush();
}

// --- Áreas, edificios OSM y puntos de interés ---
const poly = (geom) => geom.flatMap((g) => proj(g.lat, g.lon).map(r1));
const areas = [], buildings = [];
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const c = e.geometry.reduce((a, g) => { const p = proj(g.lat, g.lon); return [a[0] + p[0] / e.geometry.length, a[1] + p[1] / e.geometry.length]; }, [0, 0]);
  if (!inWorld(c)) continue;
  if (t.leisure === 'park' || t.leisure === 'playground') areas.push({ k: 'park', n: t.name || '', p: poly(e.geometry) });
  else if (t.landuse === 'cemetery') areas.push({ k: 'cemetery', n: t.name || '', p: poly(e.geometry) });
  else if (t.building) buildings.push({ n: t.name || '', k: t.amenity || t.shop || t.tourism || t.building, p: poly(e.geometry), lv: +(t['building:levels'] || 0) });
}

const pois = {};
const viewpoints = [];
for (const e of raw.elements) {
  if (e.type !== 'node' || !e.tags) continue;
  const p = proj(e.lat, e.lon).map(r1);
  if (e.tags.tourism === 'viewpoint') viewpoints.push(p);
  else if (e.tags.amenity === 'bank') pois['bank:' + e.tags.name] = p;
  else if (e.tags.name && (e.tags.amenity === 'restaurant' || e.tags.amenity === 'cafe')) (pois.food ||= []).push(p);
}

const out = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  origin: [LAT0, LON0], limit: LIMIT, bounds: B,
  nodes, ways, areas, buildings, pois, viewpoints,
  river: riverPts.filter((p) => p[1] > B.z0 - 300 && p[1] < B.z1 + 300).flatMap((p) => p.map(r1)),
  edge,
};
writeFileSync(outPath, '// Generado por tools/osm-to-json.mjs. Datos © OpenStreetMap contributors (ODbL).\nexport default ' + JSON.stringify(out) + ';\n');
console.log(`nodos ${nodes.length / 2}, calles ${ways.length}, áreas ${areas.length}, edificios ${buildings.length}, miradores ${viewpoints.length}`);
console.log('borde x en z=0:', edgeX(0), 'river pts', riverPts.length);
