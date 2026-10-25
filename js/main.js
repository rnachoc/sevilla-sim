import * as THREE from 'three';
import { loadWorld } from './world.js';
import { buildCity, CHUNK } from './city.js';
import { Ortho } from './ortho.js';
import { DETAIL_LAYER } from './facades.js';
import { buildLandmarks } from './landmarks.js';
import { Environment } from './sky.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { HUD } from './hud.js';

const fill = document.getElementById('loading-fill');
const text = document.getElementById('loading-text');
const step = (p, t) => { fill.style.width = `${p * 100}%`; if (t) text.textContent = t; return new Promise((r) => setTimeout(r, 0)); };

async function init() {
  const world = await loadWorld('./data/sevilla.bin', (p) => { fill.style.width = `${p * 40}%`; });
  await step(0.45, 'Levantando fachadas y azoteas…');

  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 12000);
  camera.layers.enable(DETAIL_LAYER);

  const env = new Environment(scene, renderer);
  env.sun.shadow.camera.layers.enable(DETAIL_LAYER);
  const ortho = new Ortho(world, CHUNK);
  ortho.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const city = buildCity(scene, world, ortho);
  await step(0.6, 'Descargando la ortofoto del IGN…');
  await Promise.race([
    ortho.preload((p) => { fill.style.width = `${60 + p * 15}%`; }),
    new Promise((r) => setTimeout(r, 20000)),
  ]);
  await step(0.75, 'Colocando la Giralda, la Torre del Oro y la Plaza de España…');
  const landmarks = buildLandmarks(scene, world);
  const traffic = new Traffic(scene, world);
  await step(0.9, 'Enganchando los caballos…');

  const player = new Player(scene, world, camera, renderer.domElement);
  player.solids = landmarks.solids;
  // salida en la Plaza Virgen de los Reyes, mirando a la Giralda
  player.teleport(46, -16);
  player.heading = Math.atan2(player.pos.x, player.pos.z);
  const hud = new HUD(world, player, env, landmarks.info);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // para depurar desde la consola
  window.sevilla = { THREE, scene, camera, renderer, world, player, env, hud, city, traffic, landmarks, ortho };

  const clock = new THREE.Clock();
  let time = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    player.update(dt);
    traffic.update(dt, time);
    city.update(time, env.night, camera.position);
    ortho.update(player.pos);
    landmarks.setNight(env.night);
    env.follow(player.root.position, player.mode === 'heli' ? Math.min(600, 180 + player.y * 1.5) : 150);
    hud.update(dt);
    renderer.render(scene, camera);
  });

  await step(1, '¡Listo!');
  document.getElementById('loading').classList.add('done');
}

init().catch((e) => {
  console.error(e);
  text.textContent = `Error: ${e.message}`;
});
