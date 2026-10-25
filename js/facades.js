import * as THREE from 'three';
import { part, merge, box, hash, rng } from './geom.js';
import { ringArea } from './world.js';

// Fachadas sevillanas procedurales: planta baja con portales, comercios y zócalo; plantas altas con huecos
// recercados y persianas; cornisas, impostas y pretiles en 3D; balcones con reja, balcones a la francesa,
// cierros y macetas como instancias. Las alturas siguen a tools/build-data.py.
export const GROUND = 4.0, FLOOR = 3.2, PARAPET = 0.9, BAY = 4.0;
const DETAIL_RADIUS = 420;
export const DETAIL_LAYER = 1; // fuera del reflejo del río (su cámara solo ve la capa 0)

const C = (h) => new THREE.Color(h);
const WALLS = [[0xf6f2e8, 58], [0xefe6d0, 10], [0xedbd55, 13], [0xf3d68c, 8], [0xb5533a, 5], [0xe9b39a, 3], [0xf1e8c8, 3]]
  .flatMap(([h, w]) => Array(w).fill(h));
const TRIMS_ON_WHITE = [[0xe0a83e, 66], [0xa64a30, 20], [0xbdb5a6, 14]].flatMap(([h, w]) => Array(w).fill(h));

export function buildingColors(id, kind) {
  if (kind === 2) return { wall: C(0xb9653f), trim: C(0xeee3c8) };
  if (kind === 3) return { wall: C(0xe9c27a), trim: C(0xf5efe2) };
  const w = WALLS[(hash(id * 7 + 1) * WALLS.length) | 0];
  const light = w === 0xf6f2e8 || w === 0xefe6d0 || w === 0xf1e8c8;
  const t = light ? TRIMS_ON_WHITE[(hash(id * 7 + 2) * TRIMS_ON_WHITE.length) | 0] : 0xf6f2e8;
  return { wall: C(w), trim: C(t) };
}

// --- texturas máscara: R = recercado/zócalo, G = vidrio, B = madera/persiana (verde)
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  return [c, g];
}
const R = 'rgb(255,0,0)', G = 'rgb(0,255,0)', B = 'rgb(0,0,255)';

function masks() {
  // planta alta: hueco de balcón (1,25 x 2,2 m) con recercado y persiana de librillo arriba
  const [up, gu] = canvas(64, 64);
  gu.fillStyle = R; gu.fillRect(16, 13, 32, 51);
  gu.fillStyle = G; gu.fillRect(22, 18, 20, 44);
  gu.fillStyle = B; gu.fillRect(22, 18, 20, 11);
  gu.fillStyle = R; gu.fillRect(14, 11, 36, 3); // guardapolvo

  // planta baja (4 huecos de 4 m): portal con arco, comercio, ventana con reja y paño ciego; zócalo corrido
  const [gr, gg] = canvas(256, 64);
  gg.fillStyle = R;
  gg.fillRect(12, 6, 40, 58);
  gg.fillStyle = B;
  gg.beginPath(); gg.moveTo(18, 64); gg.lineTo(18, 22); gg.arc(32, 22, 14, Math.PI, 0); gg.lineTo(46, 64); gg.fill();
  gg.fillStyle = R; gg.fillRect(70, 10, 52, 54);
  gg.fillStyle = G; gg.fillRect(74, 14, 44, 42);
  gg.fillStyle = R; gg.fillRect(146, 12, 28, 34);
  gg.fillStyle = G; gg.fillRect(150, 16, 20, 28);
  gg.fillStyle = R; gg.fillRect(214, 16, 20, 22);
  gg.fillStyle = G; gg.fillRect(217, 19, 14, 17);
  gg.fillStyle = R; gg.fillRect(0, 51, 256, 13);       // zócalo
  gg.fillStyle = B; gg.fillRect(18, 51, 28, 13);       // el portal corta el zócalo
  gg.fillStyle = G; gg.fillRect(74, 51, 44, 5);        // el escaparate llega casi al suelo

  // noche: huecos encendidos al azar (4x4 celdas) y comercios iluminados
  const [nu, gn] = canvas(256, 256);
  const r = rng(99);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (r() < 0.4) {
        const k = 0.55 + r() * 0.45;
        gn.fillStyle = `rgb(${255 * k | 0},${180 * k | 0},${100 * k | 0})`;
        gn.fillRect(i * 64 + 22, j * 64 + 29, 20, 33);
      }
    }
  }
  const [ng, gq] = canvas(256, 64);
  gq.fillStyle = 'rgb(255,214,150)'; gq.fillRect(74, 14, 44, 42);
  gq.fillStyle = 'rgb(200,140,70)'; gq.fillRect(150, 16, 20, 28);

  const tex = (c, srgb, rep = 1) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.repeat.set(rep, rep);
    return t;
  };
  return {
    upper: tex(up, false), ground: tex(gr, false),
    upperNight: tex(nu, true, 0.25), groundNight: tex(ng, true),
  };
}

function facadeMaterial(mask, night) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, map: mask, emissiveMap: night, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute vec3 trim;\nvarying vec3 vTrim;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvTrim = trim;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nvarying vec3 vTrim;')
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', [
        'vec4 fm = texture2D(map, vMapUv);',
        'vec3 fc = mix(vColor.rgb, vTrim, fm.r);',
        'fc = mix(fc, vec3(0.045, 0.1, 0.055), fm.b);',
        'fc = mix(fc, vec3(0.02, 0.024, 0.03), fm.g);',
        'diffuseColor.rgb *= fc;',
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, fm.g);');
  };
  return m;
}

function railTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 5);
  g.fillRect(0, 58, 64, 6);
  g.fillRect(0, 22, 64, 3);
  for (let x = 2; x < 64; x += 8) g.fillRect(x, 0, 2.5, 64);
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  for (let x = 6; x < 64; x += 16) { g.beginPath(); g.arc(x + 4, 13, 5, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function railGeometry() {
  // frente y laterales; el frente se repite 2 veces en u para que los barrotes queden a ~20 cm
  const W = 0.85, D = 0.6, Y0 = 0.14, Y1 = 1.12;
  const p = [
    -W, Y0, D, W, Y0, D, W, Y1, D, -W, Y1, D,
    -W, Y0, 0, -W, Y0, D, -W, Y1, D, -W, Y1, 0,
    W, Y0, D, W, Y0, 0, W, Y1, 0, W, Y1, D,
  ];
  const uv = [0, 0, 2, 0, 2, 1, 0, 1, 0, 0, 0.7, 0, 0.7, 1, 0, 1, 0, 0, 0.7, 0, 0.7, 1, 0, 1];
  const n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  return g;
}

export class Facades {
  constructor(world) {
    this.world = world;
    const t = masks();
    this.upperMat = facadeMaterial(t.upper, t.upperNight);
    this.groundMat = facadeMaterial(t.ground, t.groundNight);
    this.detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    this.railMat = new THREE.MeshStandardMaterial({
      color: 0x151515, alphaMap: railTexture(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5,
    });
    this.geo = {
      slab: merge([part(box(1.8, 0.14, 0.64), 0xeae4d8, [0, 0.07, 0.32])]),
      rail: railGeometry(),
      cierro: merge([
        part(box(1.9, 0.2, 0.66), 0xf2eee6, [0, 0.1, 0.33]),
        part(box(1.66, 2.0, 0.54), 0x1a2026, [0, 1.2, 0.28]),
        part(box(0.07, 2.0, 0.07), 0x141414, [-0.82, 1.2, 0.56]),
        part(box(0.07, 2.0, 0.07), 0x141414, [0.82, 1.2, 0.56]),
        part(box(0.05, 2.0, 0.05), 0x141414, [0, 1.2, 0.56]),
        part(box(1.7, 0.05, 0.05), 0x141414, [0, 0.75, 0.56]),
        part(box(1.96, 0.16, 0.72), 0xf2eee6, [0, 2.28, 0.34]),
        part(box(2.0, 0.08, 0.55), 0xa9512f, [0, 2.45, 0.32], [-0.35, 0, 0]),
      ]),
      pots: merge([
        ...[-0.55, 0, 0.55].map((x) => part(box(0.24, 0.22, 0.24), 0xb35a35, [x, 0.25, 0.46])),
        ...[[-0.55, 0xd2213a], [0, 0xe8558a], [0.55, 0xd2213a]].map(([x, col]) =>
          part(new THREE.IcosahedronGeometry(0.2, 0), col, [x, 0.48, 0.46], [0, 0, 0], [1, 0.7, 1])),
        ...[-0.55, 0, 0.55].map((x) => part(new THREE.IcosahedronGeometry(0.16, 0), 0x3d7a2c, [x, 0.42, 0.36])),
      ]),
    };
    this.groups = [];
  }

  // muros, impostas, cornisas y pretiles; devuelve instancias de balcones en det
  addBuilding(b, ch, cols) {
    const world = this.world;
    const top = b.h - PARAPET;
    const style = hash(b.id * 7 + 3);
    const rnd = rng((b.id * 2654435761) >>> 0 || 1);
    const { facade, ground, plain, det } = ch;
    facade.trim = ground.trim = cols.trim;
    let u = hash(b.id * 7 + 4) * 64;
    const rings = [[b.outer, 1], ...b.holes.map((h) => [h, -1])];
    for (const [r, sign] of rings) {
      const s = (ringArea(r) > 0 ? 1 : -1) * sign;
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = s * dz / len, nz = -s * dx / len, nrm = [nx, 0, nz];
        const u1 = u + len;
        const A = (y) => [ax, y, az], Bp = (y) => [bx, y, bz];
        // medianera: pegada a otro edificio, muro liso
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const party = sign > 0 && world.buildingAt(mx + nx * 1.2, mz + nz * 1.2);
        if (party || len < 1.2) {
          plain.quad(A(0), Bp(0), Bp(b.h), A(b.h), nrm, cols.wall);
          u = u1;
          continue;
        }
        const gTop = Math.min(GROUND, top);
        ground.quad(A(0), Bp(0), Bp(gTop), A(gTop), nrm, cols.wall,
          [u / (BAY * 4), 0], [u1 / (BAY * 4), 0], [u1 / (BAY * 4), gTop / GROUND], [u / (BAY * 4), gTop / GROUND]);
        if (top > GROUND) {
          const v1 = (top - GROUND) / FLOOR;
          facade.quad(A(GROUND), Bp(GROUND), Bp(top), A(top), nrm, cols.wall,
            [u / BAY, 0], [u1 / BAY, 0], [u1 / BAY, v1], [u / BAY, v1]);
        }
        // pretil liso (zona sin huecos de la máscara)
        facade.quad(A(top), Bp(top), Bp(b.h), A(b.h), nrm, cols.wall,
          [u / BAY, 0.84], [u1 / BAY, 0.84], [u1 / BAY, 0.97], [u / BAY, 0.97]);
        if (sign > 0) {
          const t = [dx / len, dz / len];
          if (top > GROUND + 0.6) ledge(plain, ax, az, bx, bz, t, nrm, GROUND - 0.1, 0.12, 0.2, cols.trim);
          ledge(plain, ax, az, bx, bz, t, nrm, top - 0.05, 0.32, 0.24, cols.trim);
          ledge(plain, ax, az, bx, bz, t, nrm, b.h, 0.08, 0.1, cols.trim);
          if (b.k !== 2) this.windows(det, ax, az, t, nrm, len, u, top, style, rnd, b.k);
        }
        u = u1;
      }
    }
  }

  windows(det, ax, az, t, n, len, u, top, style, rnd, kind) {
    const floors = Math.floor((top - GROUND) / FLOOR + 0.25);
    if (floors < 1) return;
    const x = [n[2], 0, -n[0]];
    for (let m = Math.ceil((u + 1.0) / BAY - 0.5); (m + 0.5) * BAY - u <= len - 1.0; m++) {
      const d = (m + 0.5) * BAY - u;
      const px = ax + t[0] * d, pz = az + t[1] * d;
      for (let f = 1; f <= floors; f++) {
        if (rnd() < 0.12) continue;
        const y = GROUND + (f - 1) * FLOOR;
        let kindW;
        if (kind === 3) kindW = f === 1 ? 'balcony' : 'french';
        else if (floors >= 5) kindW = style < 0.5 ? 'balcony' : 'french';
        else if (style < 0.35) kindW = f === 1 ? (rnd() < 0.15 ? 'cierro' : 'balcony') : 'french';
        else if (style < 0.6) kindW = 'balcony';
        else if (style < 0.8) kindW = f === 1 ? 'cierro' : 'french';
        else kindW = 'french';
        const mat = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n));
        mat.setPosition(px, y, pz);
        if (kindW === 'cierro') { det.cierro.push(mat); continue; }
        if (kindW === 'balcony') {
          det.slab.push(mat);
          det.rail.push(mat);
          if (rnd() < 0.3) det.pots.push(mat);
        } else {
          det.rail.push(mat.clone().multiply(new THREE.Matrix4().makeScale(0.82, 0.95, 0.22)));
        }
      }
    }
  }

  // instancias por tesela, visibles solo cerca de la cámara
  build(scene, det, cx, cz, size) {
    const group = new THREE.Group();
    for (const [k, mat, shadow] of [['slab', this.detailMat, true], ['rail', this.railMat, true], ['cierro', this.detailMat, true], ['pots', this.detailMat, false]]) {
      const list = det[k];
      if (!list.length) continue;
      const m = new THREE.InstancedMesh(this.geo[k], mat, list.length);
      list.forEach((mx, i) => m.setMatrixAt(i, mx));
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      m.layers.set(DETAIL_LAYER);
      group.add(m);
    }
    if (!group.children.length) return;
    group.userData.center = new THREE.Vector3((cx + 0.5) * size, 0, (cz + 0.5) * size);
    scene.add(group);
    this.groups.push(group);
  }

  update(night, cam) {
    this.upperMat.emissiveIntensity = night * 1.1;
    this.groundMat.emissiveIntensity = night * 1.3;
    const far = cam.y > 220;
    for (const g of this.groups) {
      const c = g.userData.center;
      g.visible = !far && Math.hypot(c.x - cam.x, c.z - cam.z) < DETAIL_RADIUS;
    }
  }
}

// moldura corrida (imposta, cornisa o albardilla) a lo largo de un muro
function ledge(acc, ax, az, bx, bz, t, n, y, out, thick, col) {
  const ex = t[0] * out, ez = t[1] * out;
  const a = [ax - ex, az - ez], b = [bx + ex, bz + ez];
  const ao = [a[0] + n[0] * out, a[1] + n[2] * out], bo = [b[0] + n[0] * out, b[1] + n[2] * out];
  const y1 = y + thick;
  acc.quad([a[0], y, a[1]], [b[0], y, b[1]], [bo[0], y, bo[1]], [ao[0], y, ao[1]], [0, -1, 0], col);
  acc.quad([ao[0], y, ao[1]], [bo[0], y, bo[1]], [bo[0], y1, bo[1]], [ao[0], y1, ao[1]], n, col);
  acc.quad([a[0], y1, a[1]], [b[0], y1, b[1]], [bo[0], y1, bo[1]], [ao[0], y1, ao[1]], [0, 1, 0], col);
}
