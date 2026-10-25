# Sevilla Sim

Sevilla en 3D en el navegador (three.js): casco histórico y Triana generados desde OpenStreetMap, con la ortofoto PNOA del IGN en suelo y tejados. Andar, Sevici, coche de caballos y helicóptero; hora del día, tráfico, reflejos en el Guadalquivir y minimapa.

Inspirado en [Slop New York](https://github.com/mrdoob/slop-newyork) de mrdoob (MIT). Código propio.

## Local
    python -m http.server 8765
Abrir http://localhost:8765

## Datos
1. Descargas de Overpass con las consultas de `tools/` (raw.json, raw2.json).
2. Alturas: `python tools/catastro-heights.py A.ES.SDGC.BU.41900.zip catastro.json` (ZIP INSPIRE de edificios de Sevilla del Catastro).
3. `python tools/build-data.py raw.json raw2.json catastro.json data/sevilla.bin`
Datos © OpenStreetMap contributors, ODbL 1.0. Ortofoto PNOA CC BY 4.0 scne.es (IGN), cargada en directo desde su WMTS. Alturas © Dirección General del Catastro.

## GitHub Pages
Sitio estático: publicar la rama principal desde la raíz (incluye `.nojekyll`).
