import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Acc, part, merge, box, cyl, hash, rng } from './geom.js';
import { ROAD_STYLE, ringArea, inPoly } from './world.js';

const CHUNK = 400;
const FLOOR = 3.3;   // alto de planta (m)
const BAY = 4.6;     // ancho de hueco de ventana (m)
const WATER_Y = -1.4;

const C = (hex) => new THREE.Color(hex);
const WALLS = [
  [0xf4f0e6, 40], [0xece4d2, 14], [0xe9b64c, 16], [0xf1cf7e, 9],
  [0xb8573c, 6], [0xe8ab8e, 5], [0xdcd5ca, 5], [0xf6e7b8, 5],
].flatMap(([h, w]) => Array(w).fill(C(h)));
const ROOF_FLAT = [0xd0c9bc, 0xc8c0b1, 0xbdb6aa, 0xd9d2c5].map(C);
const ROOF_TILE = [0xb0583a, 0xa14f33, 0xbd6a45, 0x9c5a3e].map(C);
const KIND_COLOR = { 1: C(0xd6c29a), 2: C(0xb9653f), 3: C(0xe8c27a), 4: C(0xe4cc96) };

function windowTextures() {
  const S = 64;
  const day = document.createElement('canvas');
  day.width = day.height = S;
  let g = day.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  // zócalo/cornisa de planta
  g.fillStyle = '#e9e2d4'; g.fillRect(0, 0, S, 3);
  // recercado de albero, hueco y reja
  const wx = 24, wy = 14, ww = 16, wh = 33;
  g.fillStyle = '#e2ad4c'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 6);
  g.fillStyle = '#39352f'; g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#5b6e58'; g.fillRect(wx + 1, wy + 1, ww - 2, 11); // persiana de librillo
    g.fillStyle = '#16181a';
  for (let x = wx + 3; x < wx + ww; x += 5) g.fillRect(x, wy + 14, 1.5, wh - 14);
  g.fillRect(wx - 2, wy + 14, ww + 4, 2);
  g.fillRect(wx - 2, wy + wh - 2, ww + 4, 3);

  const night = document.createElement('canvas');
  night.width = night.height = S * 4;
  g = night.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S * 4, S * 4);
  const r = rng(7);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (r() < 0.42) {
        const k = 0.6 + r() * 0.4;
        g.fillStyle = `rgb(${255 * k | 0},${185 * k | 0},${105 * k | 0})`;
        g.fillRect(i * S + wx, j * S + wy, ww, wh);
      }
    }
  }
  const mk = (cv, rep) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.repeat.set(rep, rep);
    // el canvas tiene el origen arriba; v crece hacia arriba en la fachada
    t.flipY = true;
    return t;
  };
  return { map: mk(day, 1), emissive: mk(night, 0.25) };
}

function addWalls(acc, r, y0, y1, col, sign, u0, skip) {
  const n = r.length / 2;
  const s = (ringArea(r) > 0 ? 1 : -1) * sign;
  let u = u0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01 || (skip && skip(ax, az, bx, bz))) continue;
    const nrm = [s * dz / len, 0, -s * dx / len];
    const u1 = u + len;
    acc.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], nrm, col,
      [u / BAY, y0 / FLOOR], [u1 / BAY, y0 / FLOOR], [u1 / BAY, y1 / FLOOR], [u / BAY, y1 / FLOOR]);
    u = u1;
  }
}

const toV2 = (r) => {
  const a = [];
  for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1]));
  return a;
};

export function addCap(acc, outer, holes, y, col, ny = 1) {
  const contour = toV2(outer), hs = holes.map(toV2);
  const all = contour.concat(...hs);
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const n = [0, ny, 0];
  for (const [a, b, c] of tris) {
    acc.tri([all[a].x, y, all[a].y], [all[b].x, y, all[b].y], [all[c].x, y, all[c].y], n, col);
  }
}

function upNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  if (y < 0) { x = -x; y = -y; z = -z; }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function isRectish(r) {
  if (r.length !== 8) return false;
  for (let i = 0; i < 4; i++) {
    const a = (i + 3) % 4, b = (i + 1) % 4;
    const ax = r[a * 2] - r[i * 2], az = r[a * 2 + 1] - r[i * 2 + 1];
    const bx = r[b * 2] - r[i * 2], bz = r[b * 2 + 1] - r[i * 2 + 1];
    if (Math.abs(ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz)) > 0.22) return false;
  }
  return true;
}

function isConvex(r) {
  const n = r.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = (i + 2) % n;
    const cr = (r[b * 2] - r[a * 2]) * (r[c * 2 + 1] - r[b * 2 + 1]) - (r[b * 2 + 1] - r[a * 2 + 1]) * (r[c * 2] - r[b * 2]);
    if (Math.abs(cr) < 1e-6) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
}

function addGable(acc, r, y, roofCol, wallCol) {
  let p = [0, 1, 2, 3].map((i) => [r[i * 2], r[i * 2 + 1]]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (d(p[1], p[2]) > d(p[0], p[1])) p = [p[1], p[2], p[3], p[0]];
  const rise = Math.min(d(p[1], p[2]) * 0.32, 3);
  const mid = (a, b) => [(a[0] + b[0]) / 2, y + rise, (a[1] + b[1]) / 2];
  const v = p.map((q) => [q[0], y, q[1]]);
  const R0 = mid(p[3], p[0]), R1 = mid(p[1], p[2]);
  let n = upNormal(v[0], v[1], R1);
  acc.quad(v[0], v[1], R1, R0, n, roofCol);
  n = upNormal(v[2], v[3], R0);
  acc.quad(v[2], v[3], R0, R1, n, roofCol);
  const cx = (R0[0] + R1[0]) / 2, cz = (R0[2] + R1[2]) / 2;
  for (const [a, b, R] of [[v[1], v[2], R1], [v[3], v[0], R0]]) {
    const nx = R[0] - cx, nz = R[2] - cz, l = Math.hypot(nx, nz) || 1;
    acc.tri(a, b, R, [nx / l, 0, nz / l], wallCol);
  }
}

function addHip(acc, r, y, roofCol) {
  const n = r.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += r[i * 2]; cz += r[i * 2 + 1]; }
  cx /= n; cz /= n;
  let minD = Infinity;
  for (let i = 0; i < n; i++) minD = Math.min(minD, Math.hypot(r[i * 2] - cx, r[i * 2 + 1] - cz));
  const apex = [cx, y + Math.min(minD * 0.45, 2.6), cz];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [r[i * 2], y, r[i * 2 + 1]], b = [r[j * 2], y, r[j * 2 + 1]];
    acc.tri(a, b, apex, upNormal(a, b, apex), roofCol);
  }
}

// cinta de calle con inglete y discos en los extremos para tapar los cruces
function addRibbon(acc, pts, hw, y, col) {
  const up = [0, 1, 0];
  const n = pts.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let nx = 0, nz = 0;
    if (i > 0) { const dx = p[0] - a[0], dz = p[1] - a[1], l = Math.hypot(dx, dz) || 1; nx += -dz / l; nz += dx / l; }
    if (i < n - 1) { const dx = b[0] - p[0], dz = b[1] - p[1], l = Math.hypot(dx, dz) || 1; nx += -dz / l; nz += dx / l; }
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const dx = b[0] - p[0], dz = b[1] - p[1], ll = Math.hypot(dx, dz) || 1;
      scale = 1 / Math.max(0.45, Math.abs(nx * -dz / ll + nz * dx / ll));
    }
    L.push([p[0] + nx * hw * scale, y, p[1] + nz * hw * scale]);
    R.push([p[0] - nx * hw * scale, y, p[1] - nz * hw * scale]);
  }
  for (let i = 0; i < n - 1; i++) acc.quad(L[i], L[i + 1], R[i + 1], R[i], up, col);
  for (const p of [pts[0], pts[n - 1]]) {
    const seg = 8;
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
      acc.tri([p[0], y - 0.002, p[1]], [p[0] + Math.cos(a0) * hw, y - 0.002, p[1] + Math.sin(a0) * hw],
        [p[0] + Math.cos(a1) * hw, y - 0.002, p[1] + Math.sin(a1) * hw], up, col);
    }
  }
}

function addBridge(acc, pts, hw, col, railCol) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    for (const s of [1, -1]) {
      const o = (hw + 0.4) * s;
      const ax = a[0] + nx * o, az = a[1] + nz * o, bx = b[0] + nx * o, bz = b[1] + nz * o;
      const n = [nx * s, 0, nz * s];
      acc.quad([ax, -1.1, az], [bx, -1.1, bz], [bx, 0.15, bz], [ax, 0.15, az], n, col);
      acc.quad([ax, 0.15, az], [bx, 0.15, bz], [bx, 1.05, bz], [ax, 1.05, az], n, railCol);
      const ni = [-nx * s, 0, -nz * s];
      const ix = -nx * s * 0.3, iz = -nz * s * 0.3;
      acc.quad([ax + ix, 0.1, az + iz], [bx + ix, 0.1, bz + iz], [bx + ix, 1.05, bz + iz], [ax + ix, 1.05, az + iz], ni, railCol);
      acc.quad([ax, 1.05, az], [bx, 1.05, bz], [bx + ix, 1.05, bz + iz], [ax + ix, 1.05, az + iz], [0, 1, 0], railCol);
    }
    // tablero
    const o = hw + 0.4;
    acc.quad([a[0] + nx * o, -1.1, a[1] + nz * o], [b[0] + nx * o, -1.1, b[1] + nz * o],
      [b[0] - nx * o, -1.1, b[1] - nz * o], [a[0] - nx * o, -1.1, a[1] - nz * o], [0, -1, 0], col);
    acc.quad([a[0] + nx * o, 0.06, a[1] + nz * o], [b[0] + nx * o, 0.06, b[1] + nz * o],
      [b[0] - nx * o, 0.06, b[1] - nz * o], [a[0] - nx * o, 0.06, a[1] - nz * o], [0, 1, 0], col);
  }
}

const WaterShader = {
  name: 'GuadalquivirShader',
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    color: { value: new THREE.Color(0x3d5f5c) },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    time: { value: 0 },
    mixRefl: { value: 0.6 },
  }]),
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vP;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vP = position.xy;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float mixRefl;
    varying vec4 vUv;
    varying vec2 vP;
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 w = vec2(
        sin(vP.x * 0.31 + time * 1.2) + sin(vP.y * 0.57 - time * 0.8) + 0.5 * sin((vP.x - vP.y) * 1.3 + time * 2.1),
        cos(vP.y * 0.27 + time * 1.0) + sin((vP.x + vP.y) * 0.19 + time * 0.7) + 0.5 * cos((vP.x + vP.y) * 1.1 - time * 1.7)
      );
      vec4 uv = vUv;
      uv.xy += w * 0.18;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      float sparkle = pow(max(0.0, sin(vP.x * 2.1 + time * 2.0) * sin(vP.y * 1.7 - time * 1.6)), 12.0) * 0.25;
      gl_FragColor = vec4(mix(color, refl, mixRefl) + sparkle * refl, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

export function buildCity(scene, world) {
  const tex = windowTextures();
  const facadeMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.88,
  });
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  // el suelo, los parques y las calles no se pintan donde hay agua (máscara de stencil)
  const notWater = {
    stencilWrite: true, stencilWriteMask: 0, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
  };
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, ...notWater });
  const bridgeRoadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

  const chunks = new Map();
  const chunk = (x, z) => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, c = { facade: new Acc(true), plain: new Acc(), road: new Acc(), bridgeRoad: new Acc() });
    return c;
  };

  // --- edificios
  for (const b of world.buildings) {
    const h1 = hash(b.id * 3 + 1), h2 = hash(b.id * 3 + 2), h3 = hash(b.id * 3 + 3);
    const ch = chunk(b.outer[0], b.outer[1]);
    let col = WALLS[(h1 * WALLS.length) | 0];
    let acc = ch.facade, y0 = 0;
    if (b.k === 1) { col = KIND_COLOR[1]; acc = ch.plain; }
    else if (b.k === 2) col = KIND_COLOR[2];
    else if (b.k === 3) col = KIND_COLOR[3];
    else if (b.k === 4) { col = KIND_COLOR[4]; acc = ch.plain; y0 = 20; }
    const u0 = h2 * 16;
    addWalls(acc, b.outer, y0, b.h, col, 1, u0);
    for (const h of b.holes) addWalls(acc, h, y0, b.h, col, -1, u0);
    const area = Math.abs(ringArea(b.outer));
    const tile = ROOF_TILE[(h3 * 97 | 0) % ROOF_TILE.length];
    if (b.k === 0 && !b.holes.length && area < 520 && b.h < 15 && h3 < 0.42 && isRectish(b.outer)) {
      addGable(ch.plain, b.outer, b.h, tile, col);
    } else if (b.k === 0 && !b.holes.length && area < 300 && b.h < 15 && h3 < 0.42 && b.outer.length <= 16 && isConvex(b.outer)) {
      addHip(ch.plain, b.outer, b.h, tile);
    } else {
      const roof = b.k === 2 ? tile : b.k === 1 ? C(0xcab48a) : ROOF_FLAT[(h3 * 61 | 0) % ROOF_FLAT.length];
      addCap(ch.plain, b.outer, b.holes, b.h, roof);
      if (y0 > 0) addCap(ch.plain, b.outer, b.holes, y0, col, -1);
    }
  }

  // --- calles
  const rn = world.rn;
  const bridgeAcc = new Acc();
  const bridgeCol = C(0xe2dacb), railCol = C(0xd8d0c0), ironCol = C(0x2f2f33);
  for (const r of world.roads) {
    const st = ROAD_STYLE[r.type];
    const pts = r.nodes.map((n) => [rn[n * 2], rn[n * 2 + 1]]);
    let col = C(st[2]);
    if (r.type === 7) {
      const m = pts[pts.length >> 1];
      if (world.parkAt(m[0], m[1])) col = C(0xd9b56d); // albero de parque
    }
    const ch = chunk(pts[0][0], pts[0][1]);
    addRibbon(r.bridge ? ch.bridgeRoad : ch.road, pts, st[0], r.bridge ? st[1] + 0.05 : st[1], col);
    if (r.bridge && r.type <= 3) addBridge(bridgeAcc, pts, st[0], bridgeCol, /triana|isabel/i.test(r.name) ? ironCol : railCol);
  }

  const groups = { buildings: new THREE.Group(), roads: new THREE.Group() };
  for (const c of chunks.values()) {
    for (const [acc, mat, grp] of [[c.facade, facadeMat, 'buildings'], [c.plain, plainMat, 'buildings'], [c.road, roadMat, 'roads'], [c.bridgeRoad, bridgeRoadMat, 'roads']]) {
      if (acc.empty) continue;
      const m = new THREE.Mesh(acc.geometry(), mat);
      m.castShadow = grp === 'buildings';
      m.receiveShadow = true;
      groups[grp].add(m);
    }
  }
  if (!bridgeAcc.empty) {
    const m = new THREE.Mesh(bridgeAcc.geometry(), plainMat);
    m.castShadow = m.receiveShadow = true;
    groups.roads.add(m);
  }
  scene.add(groups.buildings, groups.roads);

  // --- suelo: casco en piedra, alrededores en albero
  const [bx0, bz0, bx1, bz1] = world.bounds;
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xcbbb9f, roughness: 1, ...notWater });
  const outerMat = new THREE.MeshStandardMaterial({ color: 0xbfa577, roughness: 1, ...notWater });
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, bz1 - bz0), groundMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.set((bx0 + bx1) / 2, 0, (bz0 + bz1) / 2);
  const outerShape = new THREE.Shape([[-9000, -9000], [9000, -9000], [9000, 9000], [-9000, 9000]].map(([x, y]) => new THREE.Vector2(x, y)));
  outerShape.holes.push(new THREE.Path([[bx0, -bz0], [bx0, -bz1], [bx1, -bz1], [bx1, -bz0]].map(([x, y]) => new THREE.Vector2(x, y))));
  const outer = new THREE.Mesh(new THREE.ShapeGeometry(outerShape), outerMat);
  outer.rotation.x = -Math.PI / 2;
  for (const m of [inner, outer]) { m.receiveShadow = true; m.renderOrder = -1; scene.add(m); }

  // --- parques
  const parkAcc = new Acc();
  const grass = [0x7f9a4c, 0x88a052, 0x76924a].map(C);
  world.parks.forEach((p, i) => addCap(parkAcc, p.outer, p.holes, 0.03, grass[i % grass.length]));
  const parks = new THREE.Mesh(parkAcc.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, ...notWater }));
  parks.receiveShadow = true;
  scene.add(parks);

  // --- agua: máscara, muros de muelle y superficie con reflejos
  const shapes = world.water.map((w) => {
    const s = new THREE.Shape(toV2(w.outer).map((v) => new THREE.Vector2(v.x, -v.y)));
    for (const h of w.holes) s.holes.push(new THREE.Path(toV2(h).map((v) => new THREE.Vector2(v.x, -v.y))));
    return s;
  });
  const waterGeo = new THREE.ShapeGeometry(shapes);
  const mask = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  }));
  mask.rotation.x = -Math.PI / 2;
  mask.position.y = 0.0;
  mask.renderOrder = -10;
  scene.add(mask);

  const quay = new Acc();
  const quayCol = C(0xc9b28a);
  // sin muro en los bordes del recorte del bbox (quedaría una pared en mitad del río)
  const near = (v, e) => Math.abs(v - e) < 1.5;
  const onCut = (ax, az, bx, bz) => (near(ax, bx0) && near(bx, bx0)) || (near(ax, bx1) && near(bx, bx1)) ||
    (near(az, bz0) && near(bz, bz0)) || (near(az, bz1) && near(bz, bz1));
  for (const w of world.water) {
    addWalls(quay, w.outer, WATER_Y - 0.6, 0.0, quayCol, -1, 0, onCut);
    for (const h of w.holes) addWalls(quay, h, WATER_Y - 0.6, 0.0, quayCol, 1, 0);
  }
  const quayMesh = new THREE.Mesh(quay.geometry(), plainMat);
  quayMesh.receiveShadow = true;
  scene.add(quayMesh);

  const water = new Reflector(waterGeo, {
    shader: WaterShader,
    textureWidth: Math.min(1024, window.innerWidth * 0.5) | 0,
    textureHeight: Math.min(1024, window.innerHeight * 0.5) | 0,
    clipBias: 0.003,
  });
  water.material.fog = true;
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  const vegetation = buildVegetation(scene, world);
  const lamps = buildLamps(scene, world);

  return {
    facadeMat,
    plainMat,
    water,
    update(time, night) {
      water.material.uniforms.time.value = time;
      facadeMat.emissiveIntensity = night * 1.1;
      lamps.material.emissiveIntensity = 0.25 + night * 3.0;
    },
    vegetation,
  };
}

// naranjos en calles y parques, palmeras en parques y paseos
function buildVegetation(scene, world) {
  const orange = merge([
    part(cyl(0.12, 0.17, 1.8, 5), 0x6b4a33, [0, 0.9, 0]),
    part(new THREE.IcosahedronGeometry(1.6, 0), 0x3f6e30, [0, 2.7, 0], [0, 0, 0], [1, 0.85, 1]),
    part(new THREE.IcosahedronGeometry(1.0, 0), 0x4d7c36, [0.5, 3.3, 0.3], [0.5, 0.3, 0], [1, 0.8, 1]),
    ...[[1.35, 2.6, 0.5], [-1.15, 2.9, 0.7], [0.3, 2.3, -1.45], [-0.6, 3.2, -0.95]]
      .map((p) => part(new THREE.TetrahedronGeometry(0.2), 0xf08a1c, p)),
  ]);
  const palm = merge([
    part(cyl(0.22, 0.35, 9, 5), 0x7d6448, [0, 4.5, 0]),
    ...Array.from({ length: 7 }, (_, i) => {
      const a = i / 7 * Math.PI * 2;
      return part(box(0.7, 0.08, 3.6), 0x557d34, [Math.cos(a) * 1.5, 8.6, Math.sin(a) * 1.5], [0.45, -a + Math.PI / 2, 0, 'YXZ']);
    }),
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  const oranges = [], palms = [];
  const r = rng(12345);
  const freeSpot = (x, z) => {
    if (world.buildingAt(x, z) || world.waterAt(x, z)) return false;
    const nr = world.nearestRoad(x, z);
    return !nr || nr.dist > ROAD_STYLE[nr.road.type][0] + 0.6;
  };
  const rn = world.rn;
  for (const road of world.roads) {
    const t = road.type;
    if (!(t <= 2 || t === 6)) continue;
    const st = ROAD_STYLE[t];
    const step = t === 6 ? 15 : 11;
    for (let i = 0; i < road.nodes.length - 1; i++) {
      const ax = rn[road.nodes[i] * 2], az = rn[road.nodes[i] * 2 + 1];
      const bx = rn[road.nodes[i + 1] * 2], bz = rn[road.nodes[i + 1] * 2 + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 4) continue;
      const nx = -dz / l, nz = dx / l;
      for (let s = step / 2; s < l; s += step) {
        for (const side of t === 6 ? [1] : [1, -1]) {
          const off = st[0] + 1.6;
          const x = ax + dx / l * s + nx * off * side, z = az + dz / l * s + nz * off * side;
          if (oranges.length < 7000 && freeSpot(x, z)) oranges.push([x, z, r()]);
        }
      }
    }
  }
  for (const p of world.parks) {
    const [x0, z0, x1, z1] = p.box;
    const area = Math.abs(ringArea(p.outer));
    const n = Math.min(500, area / 170);
    for (let i = 0; i < n * 2 && (oranges.length + palms.length) < 12000; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!inPoly(p, x, z) || !freeSpot(x, z)) continue;
      (r() < 0.18 ? palms : oranges).push([x, z, r()]);
    }
  }
  const dummy = new THREE.Object3D();
  const toMatrix = ([x, z, k]) => {
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, k * 6.28, 0);
    dummy.scale.setScalar(0.8 + k * 0.45);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  instancedChunks(scene, orange, mat, oranges, toMatrix, true);
  instancedChunks(scene, palm, mat, palms, toMatrix, true);
  return { count: oranges.length + palms.length };
}

// farolas fernandinas
function buildLamps(scene, world) {
  const post = merge([
    part(new THREE.CylinderGeometry(0.06, 0.09, 3.9, 4, 1, true), 0x1c1c1e, [0, 1.95, 0]),
    part(new THREE.CylinderGeometry(0.02, 0.24, 0.25, 4, 1, true), 0x1c1c1e, [0, 4.75, 0], [0, Math.PI / 4, 0]),
  ]);
  const head = new THREE.CylinderGeometry(0.2, 0.13, 0.55, 4);
  head.translate(0, 4.35, 0);
  const postMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffb860, emissiveIntensity: 0.3, roughness: 0.4 });
  const spots = [];
  const rn = world.rn;
  for (const road of world.roads) {
    if (road.type < 1 || road.type > 6 || road.type === 5) continue;
    const off = ROAD_STYLE[road.type][0] + 0.4;
    let acc = 0, side = 1;
    for (let i = 0; i < road.nodes.length - 1 && spots.length < 6000; i++) {
      const ax = rn[road.nodes[i] * 2], az = rn[road.nodes[i] * 2 + 1];
      const bx = rn[road.nodes[i + 1] * 2], bz = rn[road.nodes[i + 1] * 2 + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1) continue;
      for (let s = 30 - acc; s < l; s += 30) {
        side = -side;
        let x = ax + dx / l * s - dz / l * off * side, z = az + dz / l * s + dx / l * off * side;
        if (world.buildingAt(x, z)) { x = ax + dx / l * s - dz / l * (off - 0.9) * side; z = az + dz / l * s + dx / l * (off - 0.9) * side; }
        if (!world.buildingAt(x, z) && !world.waterAt(x, z)) spots.push([x, z]);
      }
      acc = (acc + l) % 30;
    }
  }
  const toMatrix = ([x, z]) => new THREE.Matrix4().makeTranslation(x, 0, z);
  instancedChunks(scene, post, postMat, spots, toMatrix, false);
  instancedChunks(scene, head, headMat, spots, toMatrix, false);
  return { material: headMat };
}

// instancias repartidas por teselas para que el recorte por frustum funcione (también en sombras y reflejos)
function instancedChunks(scene, geo, mat, items, toMatrix, shadow) {
  const tiles = new Map();
  for (const it of items) {
    const k = `${Math.floor(it[0] / CHUNK)},${Math.floor(it[1] / CHUNK)}`;
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(it);
  }
  for (const list of tiles.values()) {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => m.setMatrixAt(i, toMatrix(it)));
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  }
}
