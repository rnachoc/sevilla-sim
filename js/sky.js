import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const LAT = 37.386 * Math.PI / 180;

// posición solar aproximada para Sevilla; hour = hora de reloj (CET, UTC+1)
export function sunDirection(hour, dayOfYear) {
  const dec = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));
  const b = 2 * Math.PI * (dayOfYear - 81) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // min
  const solar = hour - 1 + (-6.0 / 15) + eot / 60;
  const H = (solar - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)); // desde el sur hacia el oeste
  // sur = +z, oeste = -x
  return new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    const now = new Date();
    this.doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.85;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera;
    cam.near = 10; cam.far = 1400;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xd8e0f0, 0x9a7a52, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xe0c4a0, 250, 2600);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.lastEnvHour = -99;
    this.night = 0;
    this.dir = new THREE.Vector3();
    this.setHour(17.6);
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    const d = sunDirection(this.hour, this.doy);
    this.dir.copy(d);
    const el = Math.asin(d.y);
    const elDeg = el * 180 / Math.PI;
    // de noche la "luz del sol" es la luna, fría y tenue
    const day = THREE.MathUtils.smoothstep(elDeg, -4, 6);
    this.night = 1 - THREE.MathUtils.smoothstep(elDeg, -8, 2);
    this.sky.material.uniforms.sunPosition.value.copy(d);
    this.envSky.material.uniforms.sunPosition.value.copy(d);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) {
      this.envSky.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    }

    const warm = 1 - THREE.MathUtils.smoothstep(elDeg, 2, 35);
    const sunCol = new THREE.Color(0xffffff).lerp(new THREE.Color(0xff9a4a), warm * 0.85);
    const moonCol = new THREE.Color(0xa4bae6);
    this.sun.color.copy(sunCol).lerp(moonCol, 1 - day);
    this.sun.intensity = day * (1.3 + 3.0 * Math.min(1, Math.max(0, Math.sin(el)) * 2.5)) + (1 - day) * 0.7;
    // de noche las sombras las proyecta una luna opuesta al sol
    this.lightDir = day > 0.01 ? d.clone() : new THREE.Vector3(-d.x, Math.abs(d.y) + 0.5, -d.z).normalize();

    this.hemi.intensity = 0.6 - this.night * 0.15;
    this.hemi.color.set(0xd8e0f0).lerp(new THREE.Color(0x40568a), this.night);
    this.hemi.groundColor.set(0x9a7a52).lerp(new THREE.Color(0x2a2218), this.night);

    const fogDay = new THREE.Color(0xd9d6cf), fogDusk = new THREE.Color(0xe7b07c), fogNight = new THREE.Color(0x1c2540);
    this.scene.fog.color.copy(fogDay).lerp(fogDusk, warm).lerp(fogNight, this.night);
    this.renderer.toneMappingExposure = 0.75 + this.night * 0.35;

    if (Math.abs(this.hour - this.lastEnvHour) > 0.2) this.updateEnv();
  }

  updateEnv() {
    this.lastEnvHour = this.hour;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.15 + (1 - this.night) * 0.3;
  }

  // la cámara de sombras sigue al jugador
  follow(target, extent) {
    const cam = this.sun.shadow.camera;
    if (cam.right !== extent) {
      cam.left = cam.bottom = -extent;
      cam.right = cam.top = extent;
      cam.updateProjectionMatrix();
    }
    // ajuste a texel para evitar parpadeo
    const texel = (extent * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx, 0, tz).addScaledVector(this.lightDir, 600);
    this.sun.target.updateMatrixWorld();
  }
}
