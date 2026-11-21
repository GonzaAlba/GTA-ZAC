"""Descarga el modelo digital de elevación (AWS Terrain Tiles, formato Terrarium, datos abiertos)
y genera js/world/demData.js: rejilla de alturas en metros relativa al zócalo.

Uso: python -I tools/dem_fetch.py <cache_dir> <salida.js>
Fuente: https://registry.opendata.aws/terrain-tiles/ (SRTM, GMTED y otros; ver atribución).
"""
import base64, io, json, math, os, struct, sys, urllib.request
from PIL import Image

CACHE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(CACHE, exist_ok=True)
LAT0, LON0 = 19.9325, -97.9606           # origen del juego (zócalo)
MX = 111320 * math.cos(math.radians(LAT0)); MZ = 110540
X0, X1, Z0, Z1, STEP = -1500, 1600, -4500, 1350, 10  # límites del mundo en metros
Z = 14

def tile_of(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

tiles = {}
def tile(tx, ty):
    k = (tx, ty)
    if k not in tiles:
        p = os.path.join(CACHE, f"{Z}_{tx}_{ty}.png")
        if not os.path.exists(p):
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
            req = urllib.request.Request(url, headers={"User-Agent": "dem-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r, open(p, "wb") as f:
                f.write(r.read())
        im = Image.open(p).convert("RGB")
        if im.size != (256, 256):
            raise ValueError("tile inesperado")
        tiles[k] = im.load()
    return tiles[k]

def elev_px(fx, fy):
    tx, ty = int(fx // 256), int(fy // 256)
    r, g, b = tile(tx, ty)[int(fx) % 256, int(fy) % 256]
    return r * 256 + g + b / 256 - 32768

def elev(lat, lon):
    x, y = tile_of(lat, lon)
    fx, fy = x * 256 - 0.5, y * 256 - 0.5
    ix, iy = math.floor(fx), math.floor(fy); tx, ty = fx - ix, fy - iy
    a = elev_px(ix, iy); b = elev_px(ix + 1, iy); c = elev_px(ix, iy + 1); d = elev_px(ix + 1, iy + 1)
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

nx = (X1 - X0) // STEP + 1; nz = (Z1 - Z0) // STEP + 1
base = elev(LAT0, LON0)
vals = []
for j in range(nz):
    z = Z0 + j * STEP
    for i in range(nx):
        x = X0 + i * STEP
        lat = LAT0 - z / MZ; lon = LON0 + x / MX
        vals.append(max(-32000, min(32000, round((elev(lat, lon) - base) * 10))))
raw = struct.pack(f"<{len(vals)}h", *vals)
meta = {"x0": X0, "z0": Z0, "step": STEP, "nx": nx, "nz": nz, "base": round(base, 1),
        "attribution": "Elevación: AWS Terrain Tiles (Mapzen/Tilezen; SRTM, GMTED y otros)"}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Generado por tools/dem_fetch.py: alturas en decímetros relativas al zócalo (Int16 LE, base64).\n")
    f.write("export const DEM = " + json.dumps(meta) + ";\n")
    f.write("export const DEM_B64 = '" + base64.b64encode(raw).decode() + "';\n")
print(f"rejilla {nx}x{nz}, zócalo {base:.1f} m, mín {min(vals)/10:.1f}, máx {max(vals)/10:.1f}, tiles {len(tiles)}")
