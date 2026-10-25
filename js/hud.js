import { ROAD_STYLE } from './world.js';
import { MODES } from './player.js';

const MAP_SCALE = 0.5; // px por metro en el mapa pre-renderizado

export const PLACES = [
  ['Giralda y Catedral', 37.38665, -5.99215],
  ['Torre del Oro', 37.38265, -5.99595],
  ['Plaza de España', 37.37688, -5.98745],
  ['Puente de Triana', 37.38590, -6.00140],
  ['Calle Betis (Triana)', 37.38290, -6.00080],
  ['Real Maestranza', 37.38610, -5.99810],
  ['Calle Sierpes', 37.39170, -5.99500],
  ['Las Setas', 37.39320, -5.99150],
  ['Alameda de Hércules', 37.39960, -5.99430],
  ['Parque de María Luisa', 37.37480, -5.98820],
  ['Barrio de Santa Cruz', 37.38440, -5.98880],
];

function renderMap(world) {
  const [x0, z0, x1, z1] = world.bounds;
  const W = Math.ceil((x1 - x0) * MAP_SCALE), H = Math.ceil((z1 - z0) * MAP_SCALE);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (x) => (x - x0) * MAP_SCALE, Z = (z) => (z - z0) * MAP_SCALE;
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, H);
  const fillPoly = (p, color) => {
    g.beginPath();
    for (const r of [p.outer, ...(p.holes || [])]) {
      g.moveTo(X(r[0]), Z(r[1]));
      for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Z(r[i + 1]));
      g.closePath();
    }
    g.fillStyle = color;
    g.fill('evenodd');
  };
  for (const p of world.parks) fillPoly(p, '#a8bd7c');
  for (const w of world.water) fillPoly(w, '#6f9db0');
  for (const b of world.buildings) fillPoly(b, b.k === 1 ? '#b98f55' : b.k === 2 ? '#b9653f' : '#d3bf98');
  g.lineCap = 'round'; g.lineJoin = 'round';
  const rn = world.rn;
  for (const order of [[7, 8, 6], [5, 4, 3], [2, 1, 0]]) {
    for (const r of world.roads) {
      if (!order.includes(r.type)) continue;
      g.beginPath();
      r.nodes.forEach((n, i) => (i ? g.lineTo : g.moveTo).call(g, X(rn[n * 2]), Z(rn[n * 2 + 1])));
      g.strokeStyle = r.type <= 1 ? '#fff4c8' : r.type === 8 ? '#3f9160' : r.type >= 6 ? '#f7f1e4' : '#ffffff';
      g.lineWidth = Math.max(0.8, ROAD_STYLE[r.type][0] * 2 * MAP_SCALE * (r.type <= 2 ? 1.1 : 0.9));
      g.stroke();
    }
  }
  return { canvas: cv, X, Z };
}

export class HUD {
  constructor(world, player, env, landmarks) {
    this.world = world;
    this.player = player;
    this.env = env;
    this.map = renderMap(world);
    this.landmarks = landmarks;
    this.el = (id) => document.getElementById(id);
    this.mini = this.el('minimap').getContext('2d');
    this.frames = 0; this.fpsStart = performance.now();
    this.streetTimer = 0;
    this.playing = false;
    this.places = PLACES.map(([name, lat, lon]) => [name, ...world.project(lat, lon)]);

    document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => { this.setMode(b.dataset.mode); b.blur(); }));
    const slider = this.el('time-slider');
    slider.addEventListener('input', () => this.setHour(+slider.value));
    this.el('time-play').addEventListener('click', () => this.togglePlay());
    const sel = this.el('goto');
    for (const [name] of this.places) sel.add(new Option(name, name));
    sel.addEventListener('change', () => {
      const p = this.places.find((q) => q[0] === sel.value);
      if (p) {
        player.teleport(p[1], p[2]);
        // mirando al monumento más cercano
        const l = this.landmarks.find((q) => Math.hypot(q.x - p[1], q.z - p[2]) < 300);
        if (l) player.heading = Math.atan2(player.pos.x - l.x, player.pos.z - l.z);
      }
      sel.value = '';
      sel.blur();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const modes = { Digit1: 'walk', Digit2: 'bike', Digit3: 'carriage', Digit4: 'heli' };
      if (modes[e.code]) this.setMode(modes[e.code]);
      if (e.code === 'KeyM') this.toggleBigMap();
      if (e.code === 'KeyT') this.togglePlay();
      if (e.code === 'KeyH') document.body.classList.toggle('hide-hud');
      if (e.code === 'Escape' && !this.el('bigmap').hidden) this.toggleBigMap();
    });
    this.el('bigmap-canvas').addEventListener('click', (e) => {
      const cv = e.target, rect = cv.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * cv.width, pz = (e.clientY - rect.top) / rect.height * cv.height;
      const [x0, z0] = world.bounds;
      player.teleport(x0 + px / MAP_SCALE, z0 + pz / MAP_SCALE);
      this.toggleBigMap();
    });
    this.setupTouch();
    this.setHour(+slider.value);
    this.setMode('walk');
  }

  setMode(m) {
    this.player.setMode(m);
    document.body.classList.remove('mode-walk', 'mode-bike', 'mode-carriage', 'mode-heli');
    document.body.classList.add(`mode-${m}`);
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    this.streetTimer = 0;
  }

  setHour(h) {
    this.env.setHour(h);
    this.el('time-slider').value = this.env.hour;
    const hh = Math.floor(this.env.hour), mm = Math.floor((this.env.hour - hh) * 60);
    this.el('time-label').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  togglePlay() {
    this.playing = !this.playing;
    this.el('time-play').textContent = this.playing ? '❚❚' : '▶';
  }

  toggleBigMap() {
    const bm = this.el('bigmap');
    bm.hidden = !bm.hidden;
    if (bm.hidden) return;
    const cv = this.el('bigmap-canvas');
    cv.width = this.map.canvas.width; cv.height = this.map.canvas.height;
    const g = cv.getContext('2d');
    g.drawImage(this.map.canvas, 0, 0);
    this.drawMarkers(g, (x) => this.map.X(x), (z) => this.map.Z(z), 1.6);
    const p = this.player;
    g.save();
    g.translate(this.map.X(p.pos.x), this.map.Z(p.pos.z));
    g.rotate(-p.heading);
    this.arrow(g, 14);
    g.restore();
  }

  drawMarkers(g, X, Z, s) {
    g.font = `600 ${11 * s}px system-ui, sans-serif`;
    g.textAlign = 'center';
    for (const l of this.landmarks) {
      const x = X(l.x), z = Z(l.z);
      g.fillStyle = '#c0392b';
      g.beginPath(); g.arc(x, z, 4 * s, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3 * s; g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(l.name, x, z - 7 * s);
      g.fillStyle = '#2a1a0c';
      g.fillText(l.name, x, z - 7 * s);
    }
  }

  arrow(g, s) {
    g.beginPath();
    g.moveTo(0, -s); g.lineTo(s * 0.65, s * 0.7); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.65, s * 0.7); g.closePath();
    g.fillStyle = '#f0b43c'; g.strokeStyle = '#2b1a08'; g.lineWidth = 2;
    g.fill(); g.stroke();
  }

  setupTouch() {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    if (!isTouch) return;
    this.el('touch').hidden = false;
    const stick = this.el('stick'), knob = this.el('stick-knob');
    const t = this.player.touch;
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      t.x = x; t.y = y; t.active = true;
      knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = () => { id = null; t.x = t.y = 0; t.active = false; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    document.querySelectorAll('#touch-buttons button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.player.keys.add(b.dataset.key); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.player.keys.delete(b.dataset.key));
    });
  }

  update(dt) {
    if (this.playing) this.setHour(this.env.hour + dt / 20);
    // fps
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      this.el('fps').textContent = `${Math.round(this.frames / this.fpsTime)} fps`;
      this.frames = 0; this.fpsStart = performance.now();
    }
    const p = this.player;
    this.el('speed').textContent = `${Math.round(Math.abs(p.speed) * 3.6)} km/h${p.mode === 'heli' ? ` · ${Math.round(p.y)} m` : ''}`;

    this.streetTimer -= dt;
    if (this.streetTimer <= 0) {
      this.streetTimer = 0.3;
      const near = this.landmarks.find((l) => Math.hypot(l.x - p.pos.x, l.z - p.pos.z) < l.r + 25);
      const r = this.world.nearestNamedRoad(p.pos.x, p.pos.z);
      const name = r && r.dist < (p.mode === 'heli' ? 60 : 30) ? r.road.name : near ? near.name : 'Sevilla';
      this.el('street-name').textContent = name;
      const sub = [MODES[p.mode].label];
      if (near && near.name !== name) sub.push(near.name);
      if (p.pos.x < -560 && Math.abs(p.pos.z) < 1600 && !near) sub.push('Triana');
      this.el('street-sub').textContent = sub.join(' · ');
    }
    this.drawMinimap();
  }

  drawMinimap() {
    const g = this.mini, S = g.canvas.width, p = this.player;
    const zoom = p.mode === 'heli' ? 0.9 : 2.2; // px de minimapa por px de mapa
    g.save();
    g.fillStyle = '#bfa577'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(p.heading);
    g.scale(zoom, zoom);
    g.drawImage(this.map.canvas, -this.map.X(p.pos.x), -this.map.Z(p.pos.z));
    g.restore();
    // marcadores (rotados con el mapa)
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(p.heading);
    const k = zoom * MAP_SCALE;
    g.font = '600 10px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const l of this.landmarks) {
      const x = (l.x - p.pos.x) * k, z = (l.z - p.pos.z) * k;
      if (Math.hypot(x, z) > S / 2) continue;
      g.save(); g.translate(x, z); g.rotate(-p.heading);
      g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.strokeText(l.name, 0, -7);
      g.fillStyle = '#2a1a0c'; g.fillText(l.name, 0, -7);
      g.restore();
    }
    // norte
    g.save(); g.translate(0, -(S / 2 - 12)); g.rotate(-p.heading);
    g.fillStyle = '#c0392b'; g.font = '700 12px system-ui'; g.fillText('N', 0, 4);
    g.restore();
    g.restore();
    g.save();
    g.translate(S / 2, S / 2);
    this.arrow(g, 9);
    g.restore();
  }
}
