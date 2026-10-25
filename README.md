# Sevilla Sim

Sevilla en 3D en el navegador (three.js): casco histórico y Triana generados desde OpenStreetMap. Andar, Sevici, coche de caballos y helicóptero; hora del día, tráfico, reflejos en el Guadalquivir y minimapa.

Inspirado en [Slop New York](https://github.com/mrdoob/slop-newyork) de mrdoob (MIT). Código propio.

## Local
    python -m http.server 8765
Abrir http://localhost:8765

## Datos
`python tools/build-data.py raw.json raw2.json data/sevilla.bin` (consultas Overpass en `tools/`).
Datos © OpenStreetMap contributors, ODbL 1.0.

## GitHub Pages
Sitio estático: publicar la rama principal desde la raíz (incluye `.nojekyll`).
