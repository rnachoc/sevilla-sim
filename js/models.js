import * as THREE from 'three';
import { part, merge, box, cyl, sph } from './geom.js';

// Todos los modelos miran hacia -z (adelante) con el suelo en y = 0.
export const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
export const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4 });

const SKIN = 0xd9a77e, DARK = 0x222222;

function mesh(geo, mat = vcMat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function pivot(geo, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(geo));
  return g;
}

export function makePerson({ shirt = 0x2e6fb5, pants = 0x2b2f3a, hair = 0x3a2618, hat = false } = {}) {
  const group = new THREE.Group();
  const body = [
    part(box(0.42, 0.6, 0.24), shirt, [0, 1.2, 0]),
    part(box(0.36, 0.14, 0.22), pants, [0, 0.88, 0]),
    part(box(0.1, 0.08, 0.1), SKIN, [0, 1.54, 0]),
    part(box(0.22, 0.25, 0.24), SKIN, [0, 1.68, 0]),
    part(box(0.24, 0.08, 0.26), hair, [0, 1.82, 0.01]),
    part(box(0.24, 0.16, 0.06), hair, [0, 1.72, 0.12]),
  ];
  if (hat) {
    body.push(part(cyl(0.33, 0.33, 0.025, 14), 0x111111, [0, 1.83, 0]));
    body.push(part(cyl(0.15, 0.17, 0.14, 12), 0x111111, [0, 1.9, 0]));
  }
  group.add(mesh(merge(body)));
  const leg = merge([part(box(0.16, 0.82, 0.18), pants, [0, -0.41, 0]), part(box(0.17, 0.08, 0.28), 0x1a1a1a, [0, -0.84, -0.05])]);
  const arm = merge([part(box(0.12, 0.6, 0.13), shirt, [0, -0.3, 0]), part(box(0.1, 0.1, 0.1), SKIN, [0, -0.64, 0])]);
  const legL = pivot(leg, -0.1, 0.9, 0), legR = pivot(leg, 0.1, 0.9, 0);
  const armL = pivot(arm, -0.28, 1.47, 0), armR = pivot(arm, 0.28, 1.47, 0);
  group.add(legL, legR, armL, armR);
  return { group, legL, legR, armL, armR };
}

export function animateWalk(p, phase, amp) {
  const s = Math.sin(phase) * amp;
  p.legL.rotation.x = s; p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8; p.armR.rotation.x = s * 0.8;
}

function wheel(r, tube, rim, spokes = 0, spokeCol = rim) {
  const parts = [part(new THREE.TorusGeometry(r, tube, 6, 18), rim, [0, 0, 0], [0, Math.PI / 2, 0])];
  for (let i = 0; i < spokes; i++) {
    parts.push(part(box(0.03, r * 2, 0.03), spokeCol, [0, 0, 0], [i / spokes * Math.PI, 0, 0]));
  }
  parts.push(part(cyl(r * 0.15, r * 0.15, 0.08, 8), spokeCol, [0, 0, 0], [0, 0, Math.PI / 2]));
  return merge(parts);
}

// Sevici: cuadro blanco y rojo con cesta delantera
export function makeBike(shirt = 0xd8452f) {
  const group = new THREE.Group();
  const RED = 0xc8102e, WH = 0xf2f2f2;
  const frame = merge([
    part(box(0.06, 0.06, 0.72), WH, [0, 0.62, -0.05], [-0.35, 0, 0]),
    part(box(0.06, 0.62, 0.06), WH, [0, 0.62, 0.2], [0.25, 0, 0]),
    part(box(0.05, 0.05, 0.55), RED, [0, 0.36, 0.3]),
    part(box(0.05, 0.62, 0.05), RED, [0, 0.68, -0.48], [-0.3, 0, 0]),
    part(box(0.22, 0.07, 0.28), DARK, [0, 0.95, 0.27]),
    part(box(0.6, 0.04, 0.04), DARK, [0, 1.0, -0.56]),
    part(box(0.38, 0.26, 0.32), 0x9a9a9a, [0, 0.86, -0.78]),
    part(box(0.12, 0.42, 0.14), RED, [0, 0.4, 0.62]),
  ]);
  group.add(mesh(frame));
  const wf = mesh(wheel(0.33, 0.035, 0x1d1d1d, 3, 0xbbbbbb)), wr = mesh(wheel(0.33, 0.035, 0x1d1d1d, 3, 0xbbbbbb));
  wf.position.set(0, 0.35, -0.56); wr.position.set(0, 0.35, 0.54);
  group.add(wf, wr);
  const rider = makePerson({ shirt });
  rider.group.position.set(0, 0.0, 0.25);
  rider.group.scale.setScalar(0.95);
  rider.group.children[0].rotation.x = -0.25;
  rider.legL.position.y = rider.legR.position.y = 0.95;
  rider.armL.rotation.x = rider.armR.rotation.x = -1.0;
  rider.group.position.y = 0.05;
  group.add(rider.group);
  return { group, wheels: [wf, wr], rider };
}

// Coche de caballos sevillano con cochero y sombrero cordobés
export function makeCarriage() {
  const group = new THREE.Group();
  const BLACK = 0x161616, YEL = 0xe0b02a, RED = 0x9a1c1c, HORSE = 0x6b4226, MANE = 0x241710;
  const body = merge([
    part(box(1.3, 0.55, 1.9), BLACK, [0, 1.0, 0.75]),
    part(box(1.34, 0.06, 1.94), YEL, [0, 1.3, 0.75]),
    part(box(1.1, 0.12, 0.9), RED, [0, 1.32, 1.1]),
    part(box(1.1, 0.6, 0.12), RED, [0, 1.6, 1.62]),
    part(box(1.2, 0.5, 0.5), BLACK, [0, 1.95, 1.75], [0.5, 0, 0]),
    part(box(1.0, 0.5, 0.6), BLACK, [0, 1.25, -0.35]),
    part(box(1.0, 0.1, 0.5), RED, [0, 1.52, -0.3]),
    part(box(1.4, 0.08, 0.08), YEL, [0, 0.62, -0.15]),
    part(box(1.6, 0.08, 0.08), YEL, [0, 0.62, 1.25]),
    // varas y collera
    part(box(0.06, 0.06, 2.4), 0x3a2a1a, [-0.45, 1.05, -1.4]),
    part(box(0.06, 0.06, 2.4), 0x3a2a1a, [0.45, 1.05, -1.4]),
  ]);
  group.add(mesh(body, paintMat));
  const wheels = [];
  for (const [z, r] of [[-0.15, 0.45], [1.25, 0.62]]) {
    for (const x of [-0.78, 0.78]) {
      const w = mesh(wheel(r, 0.05, YEL, 6, YEL));
      w.position.set(x, r, z);
      w.userData.r = r;
      group.add(w); wheels.push(w);
    }
  }
  const horse = new THREE.Group();
  horse.add(mesh(merge([
    part(box(0.62, 0.68, 1.6), HORSE, [0, 1.38, -2.25]),
    part(box(0.32, 0.8, 0.38), HORSE, [0, 1.9, -3.0], [-0.55, 0, 0]),
    part(box(0.26, 0.3, 0.62), HORSE, [0, 2.2, -3.38], [0.25, 0, 0]),
    part(box(0.1, 0.6, 0.3), MANE, [0, 2.0, -2.9], [-0.55, 0, 0]),
    part(box(0.12, 0.6, 0.12), MANE, [0, 1.25, -1.4], [0.5, 0, 0]),
    part(box(0.08, 0.14, 0.06), HORSE, [-0.08, 2.42, -3.15]),
    part(box(0.08, 0.14, 0.06), HORSE, [0.08, 2.42, -3.15]),
    part(box(0.66, 0.08, 0.3), RED, [0, 1.74, -2.6]),
    part(box(0.66, 0.08, 0.08), YEL, [0, 1.5, -1.5]),
  ])));
  const leg = merge([part(box(0.14, 1.0, 0.16), HORSE, [0, -0.5, 0]), part(box(0.16, 0.1, 0.18), 0x111111, [0, -1.0, 0])]);
  const legs = [];
  for (const [x, z] of [[-0.2, -2.85], [0.2, -2.85], [-0.2, -1.65], [0.2, -1.65]]) {
    const l = pivot(leg, x, 1.08, z);
    horse.add(l); legs.push(l);
  }
  group.add(horse);
  const driver = makePerson({ shirt: 0x1d1d1d, pants: 0x1d1d1d, hat: true });
  driver.group.position.set(0, 0.6, -0.35);
  driver.legL.rotation.x = driver.legR.rotation.x = -1.3;
  driver.armL.rotation.x = driver.armR.rotation.x = -0.9;
  group.add(driver.group);
  return { group, wheels, legs, horse };
}

export function animateTrot(c, phase, amp) {
  const s = Math.sin(phase) * amp;
  c.legs[0].rotation.x = s; c.legs[3].rotation.x = s;
  c.legs[1].rotation.x = -s; c.legs[2].rotation.x = -s;
  c.horse.position.y = Math.abs(Math.sin(phase)) * amp * 0.08;
}

export function makeHeli() {
  const group = new THREE.Group();
  const WH = 0xf4f4f0, BLUE = 0x1f4f9a, GL = 0x1b2630;
  group.add(mesh(merge([
    part(sph(1, 14, 10), WH, [0, 1.75, 0], [0, 0, 0], [1.15, 1.05, 2.0]),
    part(sph(1, 14, 10), GL, [0, 1.95, -0.85], [0, 0, 0], [1.05, 0.85, 1.3]),
    part(box(2.32, 0.28, 3.4), BLUE, [0, 1.45, 0.25]),
    part(cyl(0.14, 0.32, 5.2, 8), WH, [0, 2.0, 3.9], [Math.PI / 2, 0, 0]),
    part(box(0.12, 1.4, 0.9), BLUE, [0, 2.6, 6.3], [0.3, 0, 0]),
    part(box(1.6, 0.08, 0.5), WH, [0, 2.05, 5.8]),
    part(box(0.12, 0.12, 3.4), DARK, [-0.95, 0.12, 0]),
    part(box(0.12, 0.12, 3.4), DARK, [0.95, 0.12, 0]),
    part(box(0.08, 0.9, 0.08), DARK, [-0.8, 0.55, -0.8], [0, 0, 0.3]),
    part(box(0.08, 0.9, 0.08), DARK, [0.8, 0.55, -0.8], [0, 0, -0.3]),
    part(box(0.08, 0.9, 0.08), DARK, [-0.8, 0.55, 0.8], [0, 0, 0.3]),
    part(box(0.08, 0.9, 0.08), DARK, [0.8, 0.55, 0.8], [0, 0, -0.3]),
    part(cyl(0.12, 0.12, 0.5, 8), DARK, [0, 2.95, 0]),
    part(box(0.9, 0.35, 1.2), WH, [0, 2.75, 0.4]),
  ]), paintMat));
  const rotor = mesh(merge([
    part(box(0.28, 0.04, 9.6), 0x2a2a2a, [0, 0, 0]),
    part(box(9.6, 0.04, 0.28), 0x2a2a2a, [0, 0, 0]),
    part(cyl(0.22, 0.22, 0.2, 8), 0x555555, [0, 0, 0]),
  ]));
  rotor.position.set(0, 3.25, 0);
  const tail = mesh(merge([part(box(0.04, 1.5, 0.14), 0x2a2a2a), part(box(0.04, 0.14, 1.5), 0x2a2a2a)]));
  tail.position.set(0.18, 2.55, 6.4);
  group.add(rotor, tail);
  return { group, rotor, tail };
}

// --- tráfico (geometrías únicas para InstancedMesh)
export function carGeometry() {
  return merge([
    part(box(1.78, 0.62, 4.2), 0xffffff, [0, 0.62, 0]),
    part(box(1.62, 0.56, 2.2), 0xffffff, [0, 1.2, 0.25]),
    part(box(1.66, 0.42, 2.0), 0x1b2027, [0, 1.2, 0.25]),
    part(box(1.5, 0.46, 2.24), 0x1b2027, [0, 1.2, 0.25]),
    part(box(1.82, 0.2, 0.2), 0x2a2a2a, [0, 0.4, -2.1]),
    part(box(1.82, 0.2, 0.2), 0x2a2a2a, [0, 0.4, 2.1]),
    part(box(0.36, 0.14, 0.05), 0xfff6d8, [-0.6, 0.72, -2.11]),
    part(box(0.36, 0.14, 0.05), 0xfff6d8, [0.6, 0.72, -2.11]),
    part(box(0.36, 0.12, 0.05), 0xd01010, [-0.6, 0.72, 2.11]),
    part(box(0.36, 0.12, 0.05), 0xd01010, [0.6, 0.72, 2.11]),
    ...[[-0.82, -1.35], [0.82, -1.35], [-0.82, 1.35], [0.82, 1.35]].map(([x, z]) =>
      part(cyl(0.33, 0.33, 0.24, 10), 0x151515, [x, 0.33, z], [0, 0, Math.PI / 2])),
  ]);
}

export function pedestrianGeometries() {
  const clothes = merge([
    part(box(0.42, 0.6, 0.24), 0xffffff, [0, 1.2, 0]),
    part(box(0.12, 0.58, 0.13), 0xffffff, [-0.28, 1.18, 0]),
    part(box(0.12, 0.58, 0.13), 0xffffff, [0.28, 1.18, 0]),
    part(box(0.16, 0.86, 0.18), 0x30343e, [-0.1, 0.45, 0]),
    part(box(0.16, 0.86, 0.18), 0x30343e, [0.1, 0.45, 0]),
  ]);
  const skin = merge([
    part(box(0.22, 0.25, 0.24), SKIN, [0, 1.68, 0]),
    part(box(0.24, 0.08, 0.26), 0x3a2618, [0, 1.82, 0.01]),
    part(box(0.1, 0.1, 0.1), SKIN, [-0.28, 0.84, 0]),
    part(box(0.1, 0.1, 0.1), SKIN, [0.28, 0.84, 0]),
  ]);
  return { clothes, skin };
}

// versiones estáticas fusionadas para tráfico
export function staticGeometry(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      parts.push(g);
    }
  });
  return merge(parts);
}
