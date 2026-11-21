# Zacatlán Libre

Juego de mundo abierto en HTML5 (Three.js) ambientado en Zacatlán, Puebla, con estilo caricaturesco. Se juega con un control Xbox (Bluetooth) mediante la Gamepad API.

## Cómo jugar
1. Necesitas Node.js. En esta carpeta ejecuta: `node tools/serve.mjs 8080`
2. Abre `http://localhost:8080` en Chrome o Edge.
3. Conecta el control Xbox por Bluetooth, presiona cualquier botón y luego **A**.

`?debug=1` activa un teclado de prueba (WASD, flechas, Espacio, F…) y el contador de FPS. Sólo sirve para desarrollo.

## Controles (Xbox)
| Botón | A pie | En auto |
|---|---|---|
| Stick izq. | moverse | volante |
| Stick der. | cámara | cámara |
| RT / LT | disparar / apuntar (fija objetivo) | acelerar / frenar-reversa |
| A | saltar (toque) / correr (mantener) | freno de mano |
| Y | subir al auto (o robarlo) | bajar |
| X | golpe | claxon |
| B | esquivar | mirar atrás |
| LB / RB | cambiar arma | cambiar estación de radio |
| ◀ ▶ | cambiar de protagonista | — |
| ▲ | teléfono | teléfono |
| ▼ o Vista | mapa | mapa |
| Menú | pausa (calidad, FPS, reiniciar) | pausa |

## Gráficos v2
- **Relieve real del centro**: `tools/panos-to-json.mjs` toma de la tabla de panorámicas sólo latitud, longitud, altitud y calle (no descarga ni usa imágenes) y genera `js/world/panoData.js`. Con esas 75 altitudes (2030–2058 m) el terreno sigue la pendiente real.
- **Fachadas por zona** (`js/world/streetStyles.js`, editable): colonial con balcones de herrería y portales frente al zócalo, comercial con toldos y letreros, popular con tinacos, antenas y postes con cables.
- Adoquín, guarniciones, pasos peatonales, árboles en racimo, jardineras y bancas.
- Contorno de tinta, neblina en la barranca, domo de cielo con nubes y brillo de faroles de noche.

## Estructura
- `tools/panos-to-json.mjs <tabla.md>`: extrae ubicaciones y altitudes a `js/world/panoData.js`.
- `tools/osm-to-json.mjs`: convierte `tools/osm-raw.json` (Overpass/OpenStreetMap) en `js/world/mapData.js`.
- `js/world`: terreno con la barranca, grafo vial con A*, ciudad procedural por chunks, monumentos.
- `js/entities`: personajes y vehículos con render instanciado y el jugador.
- `js/systems`: tráfico, peatones, policía y estrellas, combate, misiones y audio procedural.
- `js/ui`: HUD, minimapa y GPS.

Datos del mapa © OpenStreetMap contributors (ODbL). Personajes, marcas e historias son ficticios.
