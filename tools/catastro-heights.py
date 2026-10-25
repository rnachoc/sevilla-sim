"""Extrae del Catastro (INSPIRE, edificios de Sevilla) las plantas sobre rasante de cada parte de edificio
dentro del área del simulador y las deja en un JSON intermedio para tools/build-data.py.

Descarga (gratis, sin clave, ~35 MB):
  https://www.catastro.hacienda.gob.es/INSPIRE/Buildings/41/41900-SEVILLA/A.ES.SDGC.BU.41900.zip
Uso:  python tools/catastro-heights.py A.ES.SDGC.BU.41900.zip catastro.json
Datos © Dirección General del Catastro.
"""
import json
import math
import re
import sys
import zipfile

BBOX = (37.368, -6.017, 37.407, -5.973)  # s, w, n, e (algo mayor que el de OSM)
LAT0, LON0 = 37.38619, -5.99259
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0

# UTM huso 30 (ETRS89 ~ WGS84) -> lat/lon
A, F = 6378137.0, 1 / 298.257222101
E2 = F * (2 - F)
K0, LON_C = 0.9996, math.radians(-3)


def utm_to_ll(x, y):
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    m = y / K0
    mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256))
    p = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
         + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    ep2 = E2 / (1 - E2)
    c1 = ep2 * math.cos(p) ** 2
    t1 = math.tan(p) ** 2
    n1 = A / math.sqrt(1 - E2 * math.sin(p) ** 2)
    r1 = A * (1 - E2) / (1 - E2 * math.sin(p) ** 2) ** 1.5
    d = (x - 500000) / (n1 * K0)
    lat = p - (n1 * math.tan(p) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                                         + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = LON_C + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / math.cos(p)
    return math.degrees(lat), math.degrees(lon)


def main(src, dst):
    z = zipfile.ZipFile(src)
    name = next(n for n in z.namelist() if n.endswith('buildingpart.gml'))
    pos_re = re.compile(r'<gml:posList[^>]*>([^<]+)</gml:posList>')
    fl_re = re.compile(r'<bu-ext2d:numberOfFloorsAboveGround>(\d*)<')
    s, w, n, e = BBOX
    out, ring, floors, total = [], None, None, 0
    with z.open(name) as f:
        for raw in f:
            line = raw.decode('latin-1')
            if '<bu-ext2d:BuildingPart ' in line:
                ring, floors = None, None
                continue
            if ring is None:
                m = pos_re.search(line)
                if m:
                    ring = [float(v) for v in m.group(1).split()]
                    continue
            m = fl_re.search(line)
            if m:
                floors = int(m.group(1) or 0)
                continue
            if '</bu-ext2d:BuildingPart>' in line:
                total += 1
                if not ring or not floors:
                    continue
                lat, lon = utm_to_ll(ring[0], ring[1])
                if not (s <= lat <= n and w <= lon <= e):
                    continue
                pts = []
                for i in range(0, len(ring) - 2, 2):
                    la, lo = utm_to_ll(ring[i], ring[i + 1])
                    pts += [round((lo - LON0) * KX, 1), round((LAT0 - la) * KZ, 1)]
                out.append([floors] + pts)
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(f'{dst}: {len(out)} partes con plantas (de {total})')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
