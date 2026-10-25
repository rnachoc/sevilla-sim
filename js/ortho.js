import * as THREE from 'three';

// Ortofoto PNOA del IGN (CC BY 4.0, scne.es) sobre suelo y tejados.
// Cada tesela del mundo (CHUNK m) tiene su textura, que se recompone con más zoom cuanto más cerca está el jugador.
const URL = (z, x, y) => 'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg' +
  `&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&tilematrix=${z}&tilerow=${y}&tilecol=${x}`;
const REF = 18;      // zoom de referencia para las coordenadas de píxel
const MARGIN = 40;   // margen (m) para tejados que se salen de su tesela
const LEVELS = [[150, 19], [600, 18], [1400, 17], [Infinity, 16]];
const PARALLEL = 8;

function merc(lat, lon) {
  const n = 256 * 2 ** REF, s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

let active = 0;
const waiting = [];
async function loadTile(z, x, y) {
  if (active >= PARALLEL) await new Promise((r) => waiting.push(r));
  active++;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = URL(z, x, y);
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    active--;
    if (waiting.length) waiting.shift()();
  }
}

export class Ortho {
  constructor(world, chunkSize) {
    this.world = world;
    this.size = chunkSize;
    this.chunks = new Map();
    this.anisotropy = 8;
  }

  chunk(cx, cz) {
    const key = `${cx},${cz}`;
    let c = this.chunks.get(key);
    if (c) return c;
    const S = this.size;
    const x0 = cx * S - MARGIN, z0 = cz * S - MARGIN, x1 = (cx + 1) * S + MARGIN, z1 = (cz + 1) * S + MARGIN;
    const [px0, py0] = merc(...this.world.unproject(x0, z0));
    const [px1, py1] = merc(...this.world.unproject(x1, z1));
    const blank = document.createElement('canvas');
    blank.width = blank.height = 4;
    const g = blank.getContext('2d');
    g.fillStyle = '#9d927f';
    g.fillRect(0, 0, 4, 4);
    const tex = this.texture(blank);
    c = {
      key, cx, cz, px0, py0, px1, py1, level: 0, loading: false,
      rect: [cx * S, cz * S, (cx + 1) * S, (cz + 1) * S],
      roofMat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }),
      groundMat: null,
    };
    this.chunks.set(key, c);
    return c;
  }

  texture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.anisotropy;
    return t;
  }

  // uv de un punto del mundo dentro de la textura de su tesela
  uv(c, x, z) {
    const [px, py] = merc(...this.world.unproject(x, z));
    return [(px - c.px0) / (c.px1 - c.px0), 1 - (py - c.py0) / (c.py1 - c.py0)];
  }

  setUv(c, geo) {
    const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = this.uv(c, p.getX(i), p.getZ(i));
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  async load(c, z) {
    c.loading = true;
    const s = 2 ** (z - REF);
    const ax = c.px0 * s, ay = c.py0 * s, bx = c.px1 * s, by = c.py1 * s;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(bx - ax);
    cv.height = Math.ceil(by - ay);
    const g = cv.getContext('2d');
    g.fillStyle = '#9d927f';
    g.fillRect(0, 0, cv.width, cv.height);
    const jobs = [];
    for (let tx = Math.floor(ax / 256); tx <= Math.floor(bx / 256); tx++) {
      for (let ty = Math.floor(ay / 256); ty <= Math.floor(by / 256); ty++) {
        jobs.push(loadTile(z, tx, ty).then((img) => img && g.drawImage(img, tx * 256 - ax, ty * 256 - ay)));
      }
    }
    await Promise.all(jobs);
    const old = c.roofMat.map;
    const tex = this.texture(cv);
    c.roofMat.map = tex;
    if (c.groundMat) c.groundMat.map = tex;
    old.dispose();
    c.level = z;
    c.loading = false;
  }

  want(c, x, z, slack = 1) {
    const [x0, z0, x1, z1] = c.rect;
    const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) / slack;
    return LEVELS.find(([lim]) => d < lim)[1];
  }

  // carga inicial a zoom bajo (en la pantalla de carga)
  async preload(onProgress) {
    const list = [...this.chunks.values()];
    let done = 0;
    await Promise.all(list.map((c) => this.load(c, 16).then(() => onProgress(++done / list.length))));
  }

  // mejora el detalle alrededor del jugador; como mucho unas pocas teselas a la vez
  update(pos) {
    let busy = 0;
    for (const c of this.chunks.values()) if (c.loading) busy++;
    if (busy >= 3) return;
    let best = null, bestGain = 0;
    for (const c of this.chunks.values()) {
      if (c.loading) continue;
      const up = this.want(c, pos.x, pos.z);
      const down = this.want(c, pos.x, pos.z, 1.3);
      let gain = 0;
      if (up > c.level) gain = (up - c.level) * 10 - Math.hypot(c.rect[0] + this.size / 2 - pos.x, c.rect[1] + this.size / 2 - pos.z) / 1000;
      else if (down < c.level) gain = 0.5;
      if (gain > bestGain) { bestGain = gain; best = c; }
    }
    if (best) {
      const up = this.want(best, pos.x, pos.z);
      this.load(best, up > best.level ? up : this.want(best, pos.x, pos.z, 1.3));
    }
  }
}
