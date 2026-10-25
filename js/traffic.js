import * as THREE from 'three';
import { carGeometry, pedestrianGeometries, makeCarriage, makeBike, staticGeometry, vcMat, paintMat } from './models.js';
import { rng } from './geom.js';

// Agentes que recorren el grafo viario: coches, coches de caballos, Sevicis y peatones.
const KINDS = {
  car: { types: new Set([0, 1, 2, 3, 5]), speed: [7, 12], lane: 1.7, count: 220 },
  carriage: { types: new Set([0, 1, 2, 3, 4, 6]), speed: [2.5, 3.5], lane: 1.6, count: 18, near: 900 },
  bike: { types: new Set([1, 2, 3, 4, 8]), speed: [4, 6], lane: 0.6, count: 40 },
  walker: { types: new Set([3, 4, 6, 7]), speed: [1.1, 1.6], lane: 1.8, count: 450 },
};
const CAR_COLORS = [0xf5f5f5, 0xf5f5f5, 0xf5f5f5, 0xc0c4c8, 0x1d1d1f, 0x8a1c1c, 0x2a4f8f, 0x5e6a73, 0xe0d7c4, 0x3f5a3a];
const SHIRTS = [0xffffff, 0x2e6fb5, 0xc0392b, 0xf1c40f, 0x27ae60, 0x8e44ad, 0x1d1d1d, 0xe67e22, 0xecf0f1, 0x16a085, 0xd35400];

export class Traffic {
  constructor(scene, world) {
    this.world = world;
    this.r = rng(4242);
    this.groups = [];
    const dummy = new THREE.Object3D();
    this.dummy = dummy;

    const carriageGeo = staticGeometry(makeCarriage().group);
    const bikeGeo = staticGeometry(makeBike(0xffffff).group);
    const ped = pedestrianGeometries();

    this.add(scene, 'car', [[carGeometry(), paintMat]], CAR_COLORS);
    this.add(scene, 'carriage', [[carriageGeo, vcMat]]);
    this.add(scene, 'bike', [[bikeGeo, vcMat]], SHIRTS);
    this.add(scene, 'walker', [[ped.clothes, vcMat], [ped.skin, vcMat]], SHIRTS);
  }

  add(scene, kind, parts, colors) {
    const cfg = KINDS[kind];
    const world = this.world;
    // aristas válidas para este tipo de agente
    const starts = [];
    world.roads.forEach((r) => {
      if (!cfg.types.has(r.type)) return;
      if (cfg.near) {
        const [x, z] = world.node(r.nodes[0]);
        if (Math.hypot(x, z - 300) > cfg.near) return;
      }
      for (let i = 0; i < r.nodes.length - 1; i++) starts.push([r.nodes[i], r.nodes[i + 1]]);
    });
    if (!starts.length) return;
    const meshes = parts.map(([geo, mat], pi) => {
      const m = new THREE.InstancedMesh(geo, mat, cfg.count);
      m.castShadow = kind !== 'walker';
      m.frustumCulled = false;
      if (colors && pi === 0) {
        const c = new THREE.Color();
        for (let i = 0; i < cfg.count; i++) m.setColorAt(i, c.set(colors[(this.r() * colors.length) | 0]));
      }
      scene.add(m);
      return m;
    });
    const agents = [];
    for (let i = 0; i < cfg.count; i++) {
      const [a, b] = starts[(this.r() * starts.length) | 0];
      const ag = { a, b, t: this.r(), speed: cfg.speed[0] + this.r() * (cfg.speed[1] - cfg.speed[0]), phase: this.r() * 10, len: 1 };
      this.setEdge(ag, a, b);
      ag.t = this.r() * ag.len;
      agents.push(ag);
    }
    this.groups.push({ kind, cfg, meshes, agents });
  }

  setEdge(ag, a, b) {
    ag.a = a; ag.b = b;
    const [ax, az] = this.world.node(a), [bx, bz] = this.world.node(b);
    ag.ax = ax; ag.az = az;
    ag.dx = bx - ax; ag.dz = bz - az;
    ag.len = Math.hypot(ag.dx, ag.dz) || 0.01;
    ag.t = 0;
  }

  next(ag, cfg) {
    const opts = (this.world.adj.get(ag.b) || []).filter((e) => cfg.types.has(this.world.roads[e.road].type));
    let choices = opts.filter((e) => e.to !== ag.a);
    if (!choices.length) choices = opts;
    if (!choices.length) { this.setEdge(ag, ag.b, ag.a); return; }
    const e = choices[(this.r() * choices.length) | 0];
    this.setEdge(ag, ag.b, e.to);
  }

  update(dt, time) {
    const d = this.dummy;
    for (const g of this.groups) {
      const lane = g.cfg.lane;
      g.agents.forEach((ag, i) => {
        ag.t += ag.speed * dt;
        let guard = 0;
        while (ag.t > ag.len && guard++ < 8) {
          const over = ag.t - ag.len;
          this.next(ag, g.cfg);
          ag.t = over;
        }
        const k = ag.t / ag.len;
        const ux = ag.dx / ag.len, uz = ag.dz / ag.len;
        // circulan por la derecha
        const x = ag.ax + ag.dx * k - uz * lane, z = ag.az + ag.dz * k + ux * lane;
        d.position.set(x, 0, z);
        if (g.kind === 'walker') d.position.y = Math.abs(Math.sin(time * 7 * ag.speed + ag.phase)) * 0.05;
        d.rotation.set(0, Math.atan2(-ux, -uz), 0);
        d.updateMatrix();
        for (const m of g.meshes) m.setMatrixAt(i, d.matrix);
      });
      for (const m of g.meshes) m.instanceMatrix.needsUpdate = true;
    }
  }
}
