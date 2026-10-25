"""Convierte la descarga de Overpass (tools/overpass-query.txt) en data/sevilla.bin compacto.

Uso:  python tools/build-data.py raw.json raw2.json data/sevilla.bin
(raw = tools/overpass-query.txt, raw2 = tools/overpass-query-relations.txt)
Datos © OpenStreetMap contributors, ODbL 1.0.

Formato de salida: [uint32 largo][cabecera JSON: nombres, monumentos, límites][varints zigzag]
Coordenadas enteras en medios metros, x = este, z = sur, origen en la Giralda. Flujo, en orden:
  nodos viarios:  N, x0, z0, dx1, dz1, ...
  calles:         R, y por calle: tipo, nombre, flags (bit0 = puente), n, i0, di1, ...
  edificios:      B, y por edificio: alturaDm, tipo, anillos, y por anillo: n, deltas
                  (el primer vértice del exterior es relativo al del edificio anterior)
  agua, parques:  P, y por polígono: anillos, y por anillo: n, deltas
"""
import json
import math
import sys
import zlib

LAT0, LON0 = 37.38619, -5.99259          # Giralda
BBOX = (37.370, -6.015, 37.405, -5.975)  # s, w, n, e
Q = 2                                    # unidades por metro
B_EPS = 0.5                              # simplificación de huellas (m)
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0

ROAD_TYPES = {
    'trunk': 0, 'primary': 0, 'primary_link': 0,
    'secondary': 1, 'secondary_link': 1,
    'tertiary': 2, 'tertiary_link': 2,
    'residential': 3, 'unclassified': 3,
    'living_street': 4, 'service': 5,
    'pedestrian': 6, 'footway': 7, 'cycleway': 8,
}
SKIP_IDS = {28112279}                    # Torre del Oro: modelo propio
SPECIAL = {4468922: (2, 20.0), 5641600: (1, 30.0), 138602581: (4, 26.0)}  # Plaza de España, Catedral, Setas


def proj(lat, lon):
    return ((lon - LON0) * KX, (LAT0 - lat) * KZ)


def in_bbox(lat, lon, pad=0.0):
    s, w, n, e = BBOX
    return s - pad <= lat <= n + pad and w - pad <= lon <= e + pad


def dp(pts, eps):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = pts[a]
        bx, bz = pts[b]
        dx, dz = bx - ax, bz - az
        ll = dx * dx + dz * dz
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            if ll == 0:
                d = math.hypot(px - ax, pz - az)
            else:
                d = abs(dx * (az - pz) - (ax - px) * dz) / math.sqrt(ll)
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def area(r):
    s = 0.0
    for i in range(len(r)):
        x0, z0 = r[i]
        x1, z1 = r[(i + 1) % len(r)]
        s += x0 * z1 - x1 * z0
    return s / 2


def clip_rect(poly, xmin, zmin, xmax, zmax):
    """Sutherland-Hodgman contra un rectángulo."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out

    def ix(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def iz(z):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]), z)

    for inside, inter in (
        (lambda p: p[0] >= xmin, ix(xmin)), (lambda p: p[0] <= xmax, ix(xmax)),
        (lambda p: p[1] >= zmin, iz(zmin)), (lambda p: p[1] <= zmax, iz(zmax)),
    ):
        if not poly:
            break
        poly = clip(poly, inside, inter)
    return poly


def join_rings(segs):
    """Une tramos de way (listas de (lat,lon)) en anillos cerrados."""
    segs = [s[:] for s in segs if len(s) > 1]
    rings = []
    while segs:
        cur = segs.pop()
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(cur) > 3:
            rings.append(cur)
    return rings


def ring_xz(latlon, eps, clip_box=None):
    pts = [proj(a, b) for a, b in latlon]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if clip_box:
        pts = clip_rect(pts, *clip_box)
    pts = dp(pts + [pts[0]], eps)[:-1] if len(pts) > 2 else pts
    return pts


def enc_ring(pts, ccw):
    """Anillo -> deltas enteros, con orientación fija (ccw en pantalla x-este/z-sur)."""
    if (area(pts) > 0) != ccw:
        pts = pts[::-1]
    out, px, pz = [], 0, 0
    for x, z in pts:
        qx, qz = round(x * Q), round(z * Q)
        out += [qx - px, qz - pz]
        px, pz = qx, qz
    return out


def polygons(el, eps, clip_box):
    """Devuelve [(outer_pts, [holes_pts])] de un way cerrado o multipolígono."""
    if el['type'] == 'way':
        g = [(p['lat'], p['lon']) for p in el.get('geometry', [])]
        if len(g) < 4 or g[0] != g[-1]:
            return []
        return [(ring_xz(g, eps, clip_box), [])]
    outers, inners = [], []
    for m in el.get('members', []):
        if m['type'] != 'way' or 'geometry' not in m:
            continue
        seg = [(p['lat'], p['lon']) for p in m['geometry'] if p]
        (inners if m.get('role') == 'inner' else outers).append(seg)
    res = []
    holes = [ring_xz(r, eps, clip_box) for r in join_rings(inners)]
    for r in join_rings(outers):
        o = ring_xz(r, eps, clip_box)
        if len(o) < 3:
            continue
        mine = [h for h in holes if len(h) > 2 and point_in(h[0], o)]
        res.append((o, mine))
    return res


def point_in(p, poly):
    x, z = p
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def h32(n):
    return zlib.crc32(str(n).encode()) & 0xffffffff


def building_height(t, a, wid):
    def num(v):
        try:
            return float(str(v).replace(',', '.').split()[0])
        except (ValueError, IndexError):
            return None
    h = num(t.get('height'))
    if h is None and t.get('building:levels'):
        lv = num(t['building:levels'])
        if lv is not None:
            h = lv * 3.3 + 0.8
    if h is None:
        r = h32(wid) % 100
        if a > 1500:
            lv = 3 + r % 4
        elif a < 60:
            lv = 1 + r % 2
        else:
            lv = 2 + (r % 10 > 3) + (r % 10 > 8)
        h = lv * 3.3 + 0.8
    return max(3.0, min(h, 60.0))


def building_kind(t):
    b = t.get('building', '')
    if b in ('cathedral', 'church', 'chapel', 'basilica') or t.get('amenity') == 'place_of_worship':
        return 1
    if b in ('palace', 'castle') or t.get('historic') in ('castle', 'palace', 'monument'):
        return 3
    return 0


LANDMARK_IDS = {28112279: 'torreDelOro', 4468922: 'plazaEspana', 5641600: 'catedral'}


def landmark_info(el):
    """Centro, orientación del lado más largo y extremos (para las torres de la Plaza de España)."""
    o = polygons(el, 0.3, None)[0][0]
    cx = sum(p[0] for p in o) / len(o)
    cz = sum(p[1] for p in o) / len(o)
    best, ang = 0, 0
    for i in range(len(o)):
        dx, dz = o[(i + 1) % len(o)][0] - o[i][0], o[(i + 1) % len(o)][1] - o[i][1]
        if math.hypot(dx, dz) > best:
            best, ang = math.hypot(dx, dz), math.atan2(dz, dx)
    d, ea, eb = 0, o[0], o[0]
    for a in o:
        for b in o:
            dd = math.hypot(a[0] - b[0], a[1] - b[1])
            if dd > d:
                d, ea, eb = dd, a, b
    r = lambda v: round(v, 1)
    return {'c': [r(cx), r(cz)], 'ang': round(ang, 4), 'r': r(max(math.hypot(p[0] - cx, p[1] - cz) for p in o)),
            'ends': [r(ea[0]), r(ea[1]), r(eb[0]), r(eb[1])]}


def proj_inv(p):
    return (LAT0 - p[1] / KZ, LON0 + p[0] / KX)


def main(srcs, dst):
    els = []
    for src in srcs:
        els += json.load(open(src, encoding='utf-8'))['elements']
    s, w, n, e = BBOX
    x0, z0 = proj(n, w)
    x1, z1 = proj(s, e)
    box = (x0, z0, x1, z1)

    names, name_idx = [''], {'': 0}
    node_idx, rn = {}, []
    roads, bldgs, bholes, water, parks = [], [], [], [], []

    def name_id(nm):
        if nm not in name_idx:
            name_idx[nm] = len(names)
            names.append(nm)
        return name_idx[nm]

    lm = {}
    for el in els:
        t = el.get('tags', {})
        if el['id'] in LANDMARK_IDS and 'building' in t:
            lm[LANDMARK_IDS[el['id']]] = landmark_info(el)
        if el['type'] == 'way' and 'highway' in t and t['highway'] in ROAD_TYPES:
            if t.get('area') == 'yes' or t.get('access') == 'private':
                continue
            geom, ids = el.get('geometry', []), el.get('nodes', [])
            if len(geom) < 2 or len(ids) != len(geom):
                continue
            ty = ROAD_TYPES[t['highway']]
            if ty == 7 and t.get('footway') in ('sidewalk', 'crossing'):
                continue
            pts = [proj(p['lat'], p['lon']) for p in geom]
            idxs = []
            for nid, (x, z), p in zip(ids, pts, geom):
                if not in_bbox(p['lat'], p['lon'], 0.002):
                    if idxs:
                        roads.append([ty, name_id(t.get('name', '')), int(t.get('bridge') == 'yes')] + idxs)
                    idxs = []
                    continue
                if nid not in node_idx:
                    node_idx[nid] = len(rn) // 2
                    rn += [round(x * Q), round(z * Q)]
                idxs.append(node_idx[nid])
            if len(idxs) > 1:
                roads.append([ty, name_id(t.get('name', '')), int(t.get('bridge') == 'yes')] + idxs)
        elif 'building' in t:
            if el['id'] in SKIP_IDS:
                continue
            for o, holes in polygons(el, B_EPS, None):
                if len(o) < 3 or not in_bbox(*proj_inv(o[0])):
                    continue
                a = abs(area(o))
                if a < 12:
                    continue
                k = building_kind(t)
                hgt = building_height(t, a, el['id'])
                if el['id'] in SPECIAL:
                    k, hgt = SPECIAL[el['id']]
                head = [round(hgt * 10), k]
                holes = [h for h in holes if len(h) > 2 and abs(area(h)) > 8]
                if holes:
                    bholes.append(head + [enc_ring(o, True)] + [enc_ring(h, False) for h in holes])
                else:
                    bldgs.append(head + enc_ring(o, True))
        elif t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('leisure') in ('park', 'garden'):
            target = parks if t.get('leisure') in ('park', 'garden') else water
            for o, holes in polygons(el, 1.0 if target is water else 0.8, box):
                if len(o) < 3 or abs(area(o)) < 40:
                    continue
                target.append([enc_ring(o, True)] + [enc_ring(h, False) for h in holes if len(h) > 2])

    # binario: [uint32 largo cabecera][cabecera JSON UTF-8][flujo de varints zigzag]
    blds = [(b[0], b[1], [b[2:]]) for b in bldgs] + [(b[0], b[1], b[2:]) for b in bholes]
    blds.sort(key=lambda b: morton(b[2][0][0], b[2][0][1]))  # orden espacial: deltas pequeños entre edificios
    st = []
    st.append(len(rn) // 2)
    st += rn[:2] + [rn[i] - rn[i - 2] for i in range(2, len(rn))]
    st.append(len(roads))
    for r in roads:
        idx = r[3:]
        st += [r[0], r[1], r[2], len(idx), idx[0]] + [idx[i] - idx[i - 1] for i in range(1, len(idx))]
    st.append(len(blds))
    px = pz = 0
    for h, k, rings in blds:
        st += [h, k, len(rings)]
        for ri, ring in enumerate(rings):
            st.append(len(ring) // 2)
            if ri == 0:  # primer vértice relativo al del edificio anterior
                st += [ring[0] - px, ring[1] - pz] + ring[2:]
                px, pz = ring[0], ring[1]
            else:
                st += ring
    for polys in (water, parks):
        st.append(len(polys))
        for rings in polys:
            st.append(len(rings))
            for ring in rings:
                st += [len(ring) // 2] + ring
    head = json.dumps({
        'v': 3, 'origin': [LAT0, LON0], 'q': Q,
        'bounds': [round(x0), round(z0), round(x1), round(z1)],
        'attribution': '© OpenStreetMap contributors, ODbL 1.0',
        'names': names, 'lm': lm,
    }, ensure_ascii=False, separators=(',', ':')).encode()
    body = varints(st)
    blob = len(head).to_bytes(4, 'little') + head + body
    open(dst, 'wb').write(blob)
    print(f'{dst}: {len(blob)/1024:.0f} KB  (gzip ~{len(zlib.compress(blob, 9))/1024:.0f} KB)')
    print(f'roads {len(roads)}  nodes {len(rn)//2}  buildings {len(blds)}  water {len(water)}  parks {len(parks)}  names {len(names)}')


def morton(x, z):
    x, z = (x + 32768) >> 6, (z + 32768) >> 6  # celdas de 32 m
    r = 0
    for i in range(12):
        r |= ((x >> i) & 1) << (2 * i) | ((z >> i) & 1) << (2 * i + 1)
    return r


def varints(nums):
    out = bytearray()
    for n in nums:
        z = (n << 1) ^ (n >> 63)
        while z >= 0x80:
            out.append((z & 0x7f) | 0x80)
            z >>= 7
        out.append(z)
    return bytes(out)

if __name__ == '__main__':
    main(sys.argv[1:-1], sys.argv[-1])
