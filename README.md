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

## Estructura
- `tools/osm-to-json.mjs`: convierte `tools/osm-raw.json` (Overpass/OpenStreetMap) en `js/world/mapData.js`.
- `js/world`: terreno con la barranca, grafo vial con A*, ciudad procedural por chunks, monumentos.
- `js/entities`: personajes y vehículos con render instanciado y el jugador.
- `js/systems`: tráfico, peatones, policía y estrellas, combate, misiones y audio procedural.
- `js/ui`: HUD, minimapa y GPS.

Datos del mapa © OpenStreetMap contributors (ODbL). Personajes, marcas e historias son ficticios.
