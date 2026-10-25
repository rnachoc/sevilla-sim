// Carga data/sevilla.json (generado por tools/build-data.py) y ofrece consultas espaciales:
// edificio en un punto, agua, calle más cercana y grafo viario para el tráfico.
// Mundo: 1 unidad = 1 m, x = este, z = sur, origen en la Giralda.

const EMPTY = [];

export class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return (i + 2048) * 4096 + (j + 2048); }
  insert(minX, minZ, maxX, maxZ, item) {
    const c = this.cell;
    for (let i = Math.floor(minX / c); i <= Math.floor(maxX / c); i++) {
      for (let j = Math.floor(minZ / c); j <= Math.floor(maxZ / c); j++) {
        const k = this.key(i, j);
        let a = this.map.get(k);
        if (!a) this.map.set(k, a = []);
        a.push(item);
      }
    }
  }
  at(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY; }
}

export function ringBox(r) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < a) a = r[i];
    if (r[i] > c) c = r[i];
    if (r[i + 1] < b) b = r[i + 1];
    if (r[i + 1] > d) d = r[i + 1];
  }
  return [a, b, c, d];
}

export function inRing(r, x, z) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += r[j] * r[i + 1] - r[i] * r[j + 1];
  return s / 2;
}

export function inPoly(p, x, z) {
  if (!inRing(p.outer, x, z)) return false;
  for (const h of p.holes) if (inRing(h, x, z)) return false;
  return true;
}

// lat/lon -> mundo, con la misma proyección que tools/build-data.py
export function makeProjector(origin) {
  const [lat0, lon0] = origin;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, kz = 110574;
  return (lat, lon) => [(lon - lon0) * kx, (lat0 - lat) * kz];
}

export async function loadWorld(url, onProgress) {
  const res = await fetch(url);
  const total = +res.headers.get('content-length') || 0;
  let text;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got / total);
    }
    text = await new Blob(chunks).text();
  } else {
    text = await res.text();
  }
  return new World(JSON.parse(text));
}

export const CAR_TYPES = new Set([0, 1, 2, 3, 4, 5]);
export const ROAD_STYLE = [
  // [semiancho, altura, color, nombre]
  [7.0, 0.110, 0x58585c, 'avenida'],
  [5.5, 0.105, 0x5d5d61, 'calle principal'],
  [4.5, 0.100, 0x636366, 'calle'],
  [3.2, 0.095, 0x69686a, 'calle'],
  [2.8, 0.090, 0x9a9187, 'calle de convivencia'],
  [2.2, 0.085, 0x67666a, 'vía de servicio'],
  [3.4, 0.080, 0xcfc6b8, 'calle peatonal'],
  [1.3, 0.075, 0xd9d0c0, 'paseo'],
  [1.1, 0.118, 0x3f9160, 'carril bici'],
];

class World {
  constructor(d) {
    const q = d.q;
    this.bounds = d.bounds;
    this.origin = d.origin;
    this.lm = d.lm;
    this.project = makeProjector(d.origin);
    const dec = (a, off = 0) => {
      const out = new Float32Array(a.length - off);
      let x = 0, z = 0;
      for (let i = off, j = 0; i < a.length; i += 2, j += 2) {
        x += a[i]; z += a[i + 1];
        out[j] = x / q; out[j + 1] = z / q;
      }
      return out;
    };
    this.rn = Float32Array.from(d.rn, (v) => v / q);
    this.buildings = [];
    for (const b of d.b) this.buildings.push({ h: b[0] / 10, k: b[1], outer: dec(b, 2), holes: [] });
    for (const b of d.bh) this.buildings.push({ h: b[0] / 10, k: b[1], outer: dec(b[2]), holes: b.slice(3).map((r) => dec(r)) });
    this.roads = d.roads.map((r) => ({ type: r[0], name: d.names[r[1]], bridge: !!(r[2] & 1), nodes: r.slice(3) }));
    const poly = (p) => ({ outer: dec(p[0]), holes: p.slice(1).map((r) => dec(r)) });
    this.water = d.water.map(poly);
    this.parks = d.parks.map(poly);

    this.bGrid = new Grid(32);
    this.buildings.forEach((b, i) => {
      b.box = ringBox(b.outer);
      b.id = i;
      this.bGrid.insert(...b.box, b);
    });
    this.wGrid = new Grid(64);
    for (const w of this.water) { w.box = ringBox(w.outer); this.wGrid.insert(...w.box, w); }
    this.pGrid = new Grid(64);
    for (const p of this.parks) { p.box = ringBox(p.outer); this.pGrid.insert(...p.box, p); }

    // segmentos viarios: [carretera, nodoA, nodoB]
    this.sGrid = new Grid(40);
    const rn = this.rn;
    this.roads.forEach((r, ri) => {
      for (let i = 0; i < r.nodes.length - 1; i++) {
        const a = r.nodes[i], b = r.nodes[i + 1];
        const ax = rn[a * 2], az = rn[a * 2 + 1], bx = rn[b * 2], bz = rn[b * 2 + 1];
        this.sGrid.insert(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), [ri, a, b]);
      }
    });

    // grafo para el tráfico: adyacencia por nodo
    this.adj = new Map();
    this.roads.forEach((r, ri) => {
      for (let i = 0; i < r.nodes.length - 1; i++) {
        const a = r.nodes[i], b = r.nodes[i + 1];
        if (a === b) continue;
        this.link(a, b, ri);
        this.link(b, a, ri);
      }
    });
  }

  link(a, b, ri) {
    let l = this.adj.get(a);
    if (!l) this.adj.set(a, l = []);
    l.push({ to: b, road: ri });
  }

  node(i) { return [this.rn[i * 2], this.rn[i * 2 + 1]]; }

  buildingAt(x, z) {
    for (const b of this.bGrid.at(x, z)) {
      if (x < b.box[0] || x > b.box[2] || z < b.box[1] || z > b.box[3]) continue;
      if (inRing(b.outer, x, z)) {
        let inHole = false;
        for (const h of b.holes) if (inRing(h, x, z)) { inHole = true; break; }
        if (!inHole) return b;
      }
    }
    return null;
  }

  waterAt(x, z) {
    for (const w of this.wGrid.at(x, z)) {
      if (x < w.box[0] || x > w.box[2] || z < w.box[1] || z > w.box[3]) continue;
      if (inPoly(w, x, z)) return true;
    }
    return false;
  }

  parkAt(x, z) {
    for (const p of this.pGrid.at(x, z)) {
      if (x < p.box[0] || x > p.box[2] || z < p.box[1] || z > p.box[3]) continue;
      if (inPoly(p, x, z)) return true;
    }
    return false;
  }

  // calle más cercana; filter(road) opcional
  nearestRoad(x, z, filter) {
    let best = null, bd = Infinity;
    const rn = this.rn;
    const seen = this.sGrid.at(x, z);
    for (const s of seen) {
      const r = this.roads[s[0]];
      if (filter && !filter(r)) continue;
      const ax = rn[s[1] * 2], az = rn[s[1] * 2 + 1], bx = rn[s[2] * 2], bz = rn[s[2] * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const ll = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / ll));
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = { road: r, roadIndex: s[0], dist: d, x: px, z: pz, dx, dz }; }
    }
    return best;
  }

  nearestNamedRoad(x, z) {
    let r = this.nearestRoad(x, z, (r) => r.name);
    if (!r) {
      // busca en las celdas vecinas
      for (const [ox, oz] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) {
        const c = this.nearestRoad(x + ox, z + oz, (r) => r.name);
        if (c && (!r || c.dist < r.dist)) r = c;
      }
    }
    return r;
  }

  onBridge(x, z) {
    const r = this.nearestRoad(x, z, (r) => r.bridge);
    return !!r && r.dist < ROAD_STYLE[r.road.type][0] + 1.5;
  }

  // nodo viario más cercano (para teletransportes y para salir de un edificio)
  nearestNode(x, z, filter) {
    let best = -1, bd = Infinity;
    for (let rad = 40; rad <= 640 && best < 0; rad *= 2) {
      for (let ox = -rad; ox <= rad; ox += 40) {
        for (let oz = -rad; oz <= rad; oz += 40) {
          for (const s of this.sGrid.at(x + ox, z + oz)) {
            if (filter && !filter(this.roads[s[0]])) continue;
            for (const n of [s[1], s[2]]) {
              const d = Math.hypot(this.rn[n * 2] - x, this.rn[n * 2 + 1] - z);
              if (d < bd) { bd = d; best = n; }
            }
          }
        }
      }
    }
    return best;
  }

  // altura del suelo para el helicóptero (azoteas incluidas)
  groundHeight(x, z) {
    const b = this.buildingAt(x, z);
    return b ? b.h : 0;
  }
}
