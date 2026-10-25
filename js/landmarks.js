import * as THREE from 'three';
import { part, merge, box, cyl } from './geom.js';
import { inRing } from './world.js';

const BRICK = 0xc98a5c, BRICK_D = 0xa86d45, STONE = 0xe6d6b2, WHITE = 0xf2ece0, GOLD = 0xe2b54a, BRONZE = 0x8a6a3a;
const DARK = 0x3a2c22;

// Giralda: alminar almohade de ladrillo (≈50 m) + campanario renacentista hasta ≈97 m + Giraldillo
function giralda() {
  const p = [];
  const W = 13.6;
  p.push(part(box(W, 50, W), BRICK, [0, 25, 0]));
  // paños de sebka y ventanas ajimezadas en las cuatro caras
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2;
    const s = Math.sin(a), c = Math.cos(a);
    for (const y of [14, 25, 36]) {
      p.push(part(box(5.2, 8, 0.4), BRICK_D, [s * (W / 2 + 0.1), y, c * (W / 2 + 0.1)], [0, a, 0]));
    }
    for (const y of [8, 19, 30, 41]) p.push(part(box(1.4, 3, 0.5), DARK, [s * (W / 2 + 0.05), y, c * (W / 2 + 0.05)], [0, a, 0]));
  }
  // cuerpo de campanas
  p.push(part(box(W - 0.6, 1, W - 0.6), STONE, [0, 50.5, 0]));
  p.push(part(box(11.6, 11, 11.6), WHITE, [0, 56.5, 0]));
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2;
    for (const o of [-3.3, 0, 3.3]) {
      p.push(part(box(2.2, 7, 0.6), DARK, [Math.sin(a) * 5.85 + Math.cos(a) * o, 56, Math.cos(a) * 5.85 - Math.sin(a) * o], [0, a, 0]));
    }
  }
  p.push(part(box(12.6, 0.8, 12.6), GOLD, [0, 62.4, 0]));
  p.push(part(box(10, 7, 10), STONE, [0, 66.3, 0]));
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2;
    p.push(part(cyl(1.7, 1.7, 0.3, 16), 0x2a2a2a, [Math.sin(a) * 5.05, 66.5, Math.cos(a) * 5.05], [Math.PI / 2, 0, a, 'YXZ']));
  }
  p.push(part(box(8.2, 6, 8.2), WHITE, [0, 72.8, 0]));
  p.push(part(cyl(3.6, 3.9, 6, 8), STONE, [0, 78.8, 0]));
  p.push(part(cyl(2.6, 3.4, 5, 8), WHITE, [0, 84.3, 0]));
  p.push(part(new THREE.SphereGeometry(2.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), GOLD, [0, 86.8, 0]));
  p.push(part(cyl(0.4, 0.6, 4, 6), BRONZE, [0, 90.5, 0]));
  // Giraldillo (veleta)
  p.push(part(box(0.9, 3.4, 0.7), BRONZE, [0, 94.2, 0]));
  p.push(part(box(0.15, 3.0, 2.2), BRONZE, [0, 94.5, 1.2]));
  p.push(part(cyl(0.05, 0.05, 3, 4), BRONZE, [0.7, 95, 0]));
  return merge(p);
}

// Torre del Oro: dodecágono almohade + segundo cuerpo + cúpula dorada
function torreDelOro(r) {
  const p = [];
  const R = Math.max(6.5, r - 0.6);
  p.push(part(cyl(R, R, 18, 12), 0xd9b16a, [0, 9, 0]));
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * Math.PI * 2;
    p.push(part(box(1.4, 1.6, 0.8), 0xd9b16a, [Math.cos(a) * (R - 0.2), 18.8, Math.sin(a) * (R - 0.2)], [0, -a + Math.PI / 2, 0]));
    p.push(part(box(0.9, 2.2, 0.3), DARK, [Math.cos(a) * (R + 0.02), 12, Math.sin(a) * (R + 0.02)], [0, -a + Math.PI / 2, 0]));
  }
  p.push(part(cyl(R * 0.55, R * 0.55, 8, 12), 0xdcb878, [0, 22, 0]));
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * Math.PI * 2;
    p.push(part(box(0.9, 1.2, 0.6), 0xdcb878, [Math.cos(a) * R * 0.53, 26.6, Math.sin(a) * R * 0.53], [0, -a + Math.PI / 2, 0]));
  }
  p.push(part(cyl(2.2, 2.2, 4, 12), 0xe8cf95, [0, 28, 0]));
  p.push(part(new THREE.SphereGeometry(2.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xf2c94c, [0, 30, 0]));
  p.push(part(cyl(0.08, 0.15, 2.5, 4), BRONZE, [0, 33.2, 0]));
  return merge(p);
}

// torres de la Plaza de España (≈74 m)
function plazaTower() {
  const p = [];
  p.push(part(box(10, 46, 10), 0xb9653f, [0, 23, 0]));
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2;
    for (const y of [10, 20, 30, 40]) p.push(part(box(1.6, 3, 0.4), DARK, [Math.sin(a) * 5.05, y, Math.cos(a) * 5.05], [0, a, 0]));
    for (const y of [5, 15, 25, 35]) p.push(part(box(10.2, 0.5, 0.3), 0xe9dcc0, [Math.sin(a) * 5.05, y, Math.cos(a) * 5.05], [0, a, 0]));
  }
  p.push(part(box(11, 1.2, 11), 0xe9dcc0, [0, 46.6, 0]));
  p.push(part(box(8, 9, 8), 0xe9dcc0, [0, 51.7, 0]));
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2;
    p.push(part(box(3, 6, 0.5), DARK, [Math.sin(a) * 4.0, 52, Math.cos(a) * 4.0], [0, a, 0]));
  }
  p.push(part(box(6.4, 6, 6.4), 0xb9653f, [0, 59.2, 0]));
  p.push(part(cyl(2.6, 3.2, 5, 8), 0xe9dcc0, [0, 64.7, 0]));
  p.push(part(cyl(0.1, 2.6, 6, 8), 0x3e7a8a, [0, 70.2, 0]));
  p.push(part(cyl(0.05, 0.05, 2.5, 4), BRONZE, [0, 74.4, 0]));
  return merge(p);
}

function plazaCenter() {
  const p = [];
  p.push(part(box(34, 26, 16), 0xb9653f, [0, 13, 0]));
  p.push(part(box(18, 8, 14), 0xe9dcc0, [0, 30, 0]));
  p.push(part(box(22, 1, 17), 0xe9dcc0, [0, 26.2, 0]));
  for (const x of [-12, -6, 0, 6, 12]) p.push(part(box(3.4, 7, 0.4), DARK, [x, 4, 8.05]));
  p.push(part(cyl(0.1, 5, 5, 8), 0x3e7a8a, [0, 36.5, 0]));
  return merge(p);
}

export function buildLandmarks(scene, world) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const group = new THREE.Group();
  const solids = [];
  const add = (geo, x, z, rotY = 0, r = 0, h = 0) => {
    if (r) solids.push({ x, z, r, h });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const lm = world.lm;
  const info = [];

  // Giralda en el origen, alineada con la Catedral
  const catAng = lm.catedral ? -lm.catedral.ang : 0;
  add(giralda(), 0, 0, catAng, 7.5, 97);
  info.push({ name: 'Giralda', x: 0, z: 0, r: 9 });

  // Catedral: pináculos sobre el perímetro y cimborrio
  const cat = world.buildings.filter((b) => b.k === 1 && b.h >= 29 && Math.abs(b.box[0]) < 300 && Math.abs(b.box[1]) < 300);
  const pin = [];
  for (const b of cat) {
    const r = b.outer;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], l = Math.hypot(dx, dz);
      for (let s = 0; s < l; s += 9) pin.push([r[i] + dx * s / l, r[i + 1] + dz * s / l, b.h]);
    }
  }
  if (pin.length) {
    const g = merge([part(cyl(0.05, 0.7, 5, 4), STONE, [0, 2.5, 0]), part(box(1.2, 1.2, 1.2), STONE, [0, 0.3, 0])]);
    const inst = new THREE.InstancedMesh(g, mat, pin.length);
    const m4 = new THREE.Matrix4();
    pin.forEach(([x, z, h], i) => inst.setMatrixAt(i, m4.makeTranslation(x, h, z)));
    inst.castShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  if (lm.catedral) {
    const [cx, cz] = lm.catedral.c;
    const cim = merge([part(box(18, 12, 18), STONE, [0, 36, 0]), part(cyl(1, 6, 6, 8), STONE, [0, 45, 0])]);
    add(cim, cx, cz, catAng);
    info.push({ name: 'Catedral de Sevilla', x: cx, z: cz, r: 90 });
  }

  if (lm.torreDelOro) {
    const [x, z] = lm.torreDelOro.c;
    add(torreDelOro(lm.torreDelOro.r), x, z, 0, Math.max(6.5, lm.torreDelOro.r - 0.6), 33);
    info.push({ name: 'Torre del Oro', x, z, r: 10 });
  }

  if (lm.plazaEspana) {
    const [ax, az, bx, bz] = lm.plazaEspana.ends;
    const [cx, cz] = lm.plazaEspana.c;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const R = Math.hypot(ax - bx, az - bz) / 2;
    let ux = cx - mx, uz = cz - mz;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    // torres algo hacia dentro de los extremos del arco
    for (const [ex, ez] of [[ax, az], [bx, bz]]) {
      const tx = ex + (mx - ex) * 0.04 + ux * 6, tz = ez + (mz - ez) * 0.04 + uz * 6;
      add(plazaTower(), tx, tz, Math.atan2(ux, uz), 6.5, 75);
    }
    // edificio central en el vértice del arco, mirando a la plaza
    const apexX = mx + ux * (R - 12), apexZ = mz + uz * (R - 12);
    add(plazaCenter(), apexX, apexZ, Math.atan2(-ux, -uz), 12, 37);
    info.push({ name: 'Plaza de España', x: mx + ux * R * 0.4, z: mz + uz * R * 0.4, r: 120 });
  }

  // Metropol Parasol (Setas): columnas bajo la cubierta
  for (const b of world.buildings.filter((b) => b.k === 4)) {
    const [x0, z0, x1, z1] = b.box;
    const colGeo = merge([part(cyl(2.2, 3.2, 20, 8), 0xe4cc96, [0, 10, 0])]);
    let n = 0;
    for (let x = x0 + 12; x < x1 && n < 8; x += 30) {
      for (let z = z0 + 12; z < z1 && n < 8; z += 30) {
        if (inRing(b.outer, x, z)) { add(colGeo, x, z, 0, 3, 20); n++; }
      }
    }
    info.push({ name: 'Las Setas', x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: 60 });
  }

  scene.add(group);
  return { group, info, solids };
}
