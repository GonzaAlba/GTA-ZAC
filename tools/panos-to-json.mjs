// Extrae de la tabla de panorámicas sólo datos de ubicación (lat, lon, altitud, rumbo, calle)
// y los proyecta al sistema del juego. No descarga ni usa imágenes.
import { readFileSync, writeFileSync } from 'node:fs';

// Uso: node tools/panos-to-json.mjs salida.js tabla1.md [tabla2.md ...]
const [, , outPath, ...inPaths] = process.argv;
if (!inPaths.length) { console.error('Uso: node tools/panos-to-json.mjs <salida.js> <tabla.md> [...]'); process.exit(1); }

const LAT0 = 19.9325, LON0 = -97.9606; // mismo origen que tools/osm-to-json.mjs
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MZ = 110540;
const ROW = /^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*[A-Za-z0-9_-]{22,32}\s*\|\s*(\S+)\s*\|/;
const AT = /@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)a,[\d.]+y,([\d.]+)h/;

const points = [], seen = new Set();
for (const line of inPaths.flatMap((p) => readFileSync(p, 'utf8').split(/\r?\n/))) {
  const m = ROW.exec(line.trim());
  if (!m) continue;
  const a = AT.exec(m[3]);
  if (!a) continue;
  const lat = +a[1], lon = +a[2], alt = +a[3];
  const key = lat.toFixed(6) + ',' + lon.toFixed(6);
  if (seen.has(key)) continue; seen.add(key);
  points.push({
    x: Math.round((lon - LON0) * MX * 10) / 10,
    z: Math.round(-(lat - LAT0) * MZ * 10) / 10,
    alt: alt > 500 ? alt : null, // "3a" en algunas URL no es altitud
    h: Math.round(+a[4]),
    calle: m[2].replace(/\s*\(.*?\)\s*/g, '').replace(/^\d+\s+/, '').trim(),
  });
}
writeFileSync(outPath, '// Generado por tools/panos-to-json.mjs: ubicaciones y altitudes (sin imágenes).\nexport default ' + JSON.stringify(points) + ';\n');
const alts = points.map((p) => p.alt).filter(Boolean);
console.log(`${points.length} puntos · altitud ${Math.min(...alts)}–${Math.max(...alts)} m`);
