import * as THREE from 'three';
import { makePerson, makeBike, makeCarriage, makeHeli, animateWalk, animateTrot } from './models.js';

// Modos: andar, Sevici, coche de caballos y helicóptero. Controles de tanque (W/S avanza, A/D gira).
export const MODES = {
  walk: { label: 'Andando', speed: 1.8, boost: 5.2, accel: 10, turn: 2.6, radius: 0.35, cam: [4.2, 1.7, 0.18] },
  bike: { label: 'En Sevici', speed: 6.5, boost: 10, accel: 3, turn: 1.9, radius: 0.5, cam: [5.5, 2.0, 0.2] },
  carriage: { label: 'En coche de caballos', speed: 3.6, boost: 6.5, accel: 1.4, turn: 0.9, radius: 1.2, cam: [10, 3.6, 0.22] },
  heli: { label: 'En helicóptero', speed: 28, boost: 55, accel: 9, turn: 1.1, radius: 4, cam: [20, 6, 0.28] },
};

export class Player {
  constructor(scene, world, camera, dom) {
    this.world = world;
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.y = 0;
    this.mode = 'walk';
    this.keys = new Set();
    this.touch = { x: 0, y: 0 };
    this.camYaw = 0;
    this.camPitch = 0;
    this.camZoom = 1;
    this.lastDrag = -10;
    this.time = 0;
    this.phase = 0;
    this.solids = [];

    this.models = {
      walk: makePerson({ shirt: 0x2f6db3 }),
      bike: makeBike(0xd8452f),
      carriage: makeCarriage(),
      heli: makeHeli(),
    };
    this.root = new THREE.Group();
    scene.add(this.root);
    for (const [k, m] of Object.entries(this.models)) { m.group.visible = k === 'walk'; this.root.add(m.group); }
    this.camPos = new THREE.Vector3();
    this.camTarget = new THREE.Vector3();
    this.bindInput(dom);
  }

  bindInput(dom) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.clientX < 180 && e.clientY > window.innerHeight - 220) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.camYaw -= (e.clientX - drag.x) * 0.006;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + (e.clientY - drag.y) * 0.004, -0.15, 1.2);
      drag.x = e.clientX; drag.y = e.clientY;
      this.lastDrag = this.time;
    });
    const end = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      this.camZoom = THREE.MathUtils.clamp(this.camZoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.4, 4);
      e.preventDefault();
    }, { passive: false });
  }

  key(...codes) { return codes.some((c) => this.keys.has(c)); }

  // obstáculos: edificios (salvo bajo las Setas), monumentos y agua fuera de los puentes
  blocked(x, z, r) {
    const w = this.world;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const b = w.buildingAt(x + ox, z + oz);
      if (b && !(b.k === 4 && this.y < 19)) return true;
    }
    for (const s of this.solids) if (Math.hypot(x - s.x, z - s.z) < s.r + r) return true;
    if (w.waterAt(x, z) && !w.onBridge(x, z)) return true;
    return false;
  }

  setMode(mode) {
    if (!MODES[mode] || mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    for (const [k, m] of Object.entries(this.models)) m.group.visible = k === mode;
    this.speed = 0;
    this.vy = 0;
    if (mode === 'heli') {
      this.y = Math.max(this.y, 0);
    } else if (from === 'heli' || this.blocked(this.pos.x, this.pos.z, MODES[mode].radius)) {
      this.y = 0;
      if (this.blocked(this.pos.x, this.pos.z, MODES[mode].radius)) this.snapToRoad();
    }
    this.camZoom = 1;
    document.body.className = document.body.className.replace(/mode-\w+/g, '') + ` mode-${mode}`;
  }

  snapToRoad() {
    const filter = this.mode === 'walk' ? null : (r) => r.type <= 6;
    const n = this.world.nearestNode(this.pos.x, this.pos.z, filter);
    if (n >= 0) {
      const [x, z] = this.world.node(n);
      this.pos.set(x, 0, z);
      // orienta hacia la calle
      const e = (this.world.adj.get(n) || [])[0];
      if (e) {
        const [bx, bz] = this.world.node(e.to);
        this.heading = Math.atan2(-(bx - x), -(bz - z));
      }
    }
    this.y = 0;
  }

  teleport(x, z) {
    this.pos.set(x, 0, z);
    if (this.mode === 'heli') {
      this.y = Math.max(60, this.world.groundHeight(x, z) + 20);
    } else {
      this.y = 0;
      if (this.blocked(x, z, MODES[this.mode].radius)) this.snapToRoad();
    }
    this.snapCamera = true;
  }

  update(dt) {
    this.time += dt;
    const cfg = MODES[this.mode];
    const boost = this.key('ShiftLeft', 'ShiftRight');
    let fwd = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    let turn = (this.key('KeyA', 'ArrowLeft') ? 1 : 0) - (this.key('KeyD', 'ArrowRight') ? 1 : 0);
    if (this.touch.active) { fwd = -this.touch.y; turn = -this.touch.x; }
    const max = boost ? cfg.boost : cfg.speed;
    const target = fwd > 0 ? max * fwd : fwd < 0 ? -max * 0.4 * -fwd : 0;
    const acc = (fwd === 0 ? cfg.accel * 0.8 : cfg.accel) * (Math.sign(target - this.speed) !== Math.sign(this.speed) && this.speed !== 0 ? 1.8 : 1);
    this.speed += THREE.MathUtils.clamp(target - this.speed, -acc * dt, acc * dt);

    let turnRate = cfg.turn;
    if (this.mode === 'bike' || this.mode === 'carriage') turnRate *= Math.min(1, Math.abs(this.speed) / 2 + 0.15) * Math.sign(this.speed || 1);
    this.heading += turn * turnRate * dt;

    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const nx = this.pos.x + fx * this.speed * dt, nz = this.pos.z + fz * this.speed * dt;

    if (this.mode === 'heli') {
      const up = (this.key('Space', 'KeyE') ? 1 : 0) - (this.key('KeyC', 'KeyQ', 'ControlLeft') ? 1 : 0);
      this.vy += THREE.MathUtils.clamp(up * 10 - this.vy, -12 * dt, 12 * dt);
      this.y += this.vy * dt;
      this.pos.x = nx; this.pos.z = nz;
      const ground = this.world.groundHeight(this.pos.x, this.pos.z);
      let floor = ground;
      for (const s of this.solids) if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < s.r + 3) floor = Math.max(floor, s.h);
      if (this.y < floor) { this.y = floor; this.vy = Math.max(0, this.vy); }
      this.y = Math.min(this.y, 600);
      const b = this.world.bounds;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, b[0] - 1500, b[2] + 1500);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, b[1] - 1500, b[3] + 1500);
    } else {
      const r = cfg.radius;
      if (!this.blocked(nx, nz, r)) { this.pos.x = nx; this.pos.z = nz; }
      else if (!this.blocked(nx, this.pos.z, r)) { this.pos.x = nx; this.speed *= 0.9; }
      else if (!this.blocked(this.pos.x, nz, r)) { this.pos.z = nz; this.speed *= 0.9; }
      else this.speed *= this.mode === 'walk' ? 0 : -0.2;
      // salto al andar
      if (this.mode === 'walk' && this.key('Space') && this.y <= 0.001) this.vy = 4.2;
      this.vy -= 12 * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }

    this.animate(dt, turn);
    this.updateCamera(dt);
  }

  animate(dt, turn) {
    const m = this.models[this.mode];
    const ground = this.mode === 'heli' ? this.y : this.y + (this.world.onBridge(this.pos.x, this.pos.z) ? 0.1 : 0);
    this.root.position.set(this.pos.x, ground, this.pos.z);
    this.root.rotation.set(0, this.heading, 0);
    const v = Math.abs(this.speed);
    this.phase += dt * (this.mode === 'walk' ? v * 3.6 : this.mode === 'carriage' ? 3 + v * 1.6 : v * 2.2);
    if (this.mode === 'walk') {
      animateWalk(m, this.phase, Math.min(0.9, v * 0.3) * (this.y > 0 ? 0.3 : 1));
    } else if (this.mode === 'bike') {
      for (const w of m.wheels) w.rotation.x -= this.speed * dt / 0.33;
      const s = Math.sin(this.phase) * 0.7;
      m.rider.legL.rotation.x = -0.6 + s; m.rider.legR.rotation.x = -0.6 - s;
      m.group.rotation.z = THREE.MathUtils.lerp(m.group.rotation.z, turn * Math.min(1, v / 5) * 0.25, 1 - Math.exp(-dt * 6));
    } else if (this.mode === 'carriage') {
      for (const w of m.wheels) w.rotation.x -= this.speed * dt / w.userData.r;
      animateTrot(m, this.phase, v > 0.2 ? Math.min(0.6, v * 0.18) : 0);
    } else {
      const spin = this.y > 0.5 || this.speed > 0.5 ? 1 : 0.4;
      m.rotor.rotation.y += dt * 28 * spin;
      m.tail.rotation.x += dt * 40 * spin;
      m.group.rotation.x = THREE.MathUtils.lerp(m.group.rotation.x, -this.speed / MODES.heli.boost * 0.35, 1 - Math.exp(-dt * 3));
      m.group.rotation.z = THREE.MathUtils.lerp(m.group.rotation.z, turn * 0.25, 1 - Math.exp(-dt * 3));
    }
  }

  // cámara de persecución con órbita del ratón y sin atravesar fachadas
  updateCamera(dt) {
    const [dist0, height, pitch0] = MODES[this.mode].cam;
    if (this.time - this.lastDrag > 2.5) {
      this.camYaw *= Math.exp(-dt * 1.5);
      this.camPitch *= Math.exp(-dt * 1.5);
    }
    const dist = dist0 * this.camZoom;
    const pitch = pitch0 + this.camPitch;
    const yaw = this.heading + this.camYaw;
    const tgt = new THREE.Vector3(this.pos.x, this.root.position.y + height * 0.7, this.pos.z);
    let d = dist;
    const bx = Math.sin(yaw), bz = Math.cos(yaw);
    if (this.mode !== 'heli') {
      for (let s = 1; s <= dist; s += 0.5) {
        const px = tgt.x + bx * s * Math.cos(pitch), pz = tgt.z + bz * s * Math.cos(pitch);
        const py = tgt.y + Math.sin(pitch) * s;
        const b = this.world.buildingAt(px, pz);
        if (b && b.h > py && b.k !== 4) { d = Math.max(1.2, s - 0.6); break; }
      }
    }
    const want = new THREE.Vector3(
      tgt.x + bx * d * Math.cos(pitch),
      tgt.y + Math.sin(pitch) * d + height * 0.3,
      tgt.z + bz * d * Math.cos(pitch)
    );
    if (this.snapCamera || this.camPos.lengthSq() === 0) { this.camPos.copy(want); this.camTarget.copy(tgt); this.snapCamera = false; }
    const k = 1 - Math.exp(-dt * (this.mode === 'heli' ? 4 : 8));
    this.camPos.lerp(want, k);
    // al acortarse por una fachada, la cámara se acerca de golpe
    if (d < dist && this.camPos.distanceTo(tgt) > d + 0.5) this.camPos.lerp(want, 0.5);
    this.camTarget.lerp(tgt, 1 - Math.exp(-dt * 12));
    this.camera.position.copy(this.camPos);
    if (this.mode !== 'heli') this.camera.position.y = Math.max(0.4, this.camera.position.y);
    this.camera.lookAt(this.camTarget);
  }
}
