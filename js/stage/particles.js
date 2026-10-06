import * as THREE from 'three';

// ── dust motes ──────────────────────────────────────────────
const DUST_COUNT = 80;

function createDustTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class DustMotes {
  constructor() {
    this.positions = new Float32Array(DUST_COUNT * 3);
    this.seeds = new Float32Array(DUST_COUNT * 3);
    this.sizes = new Float32Array(DUST_COUNT);

    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      this.positions[i3] = (Math.random() - 0.5) * 8;
      this.positions[i3 + 1] = (Math.random() - 0.5) * 5;
      this.positions[i3 + 2] = (Math.random() - 0.5) * 4;
      this.seeds[i3] = Math.random() * 100;
      this.seeds[i3 + 1] = Math.random() * 100;
      this.seeds[i3 + 2] = 0.3 + Math.random() * 0.7;
      this.sizes[i] = 0.015 + Math.random() * 0.025;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.PointsMaterial({
      size: 0.03,
      map: createDustTexture(),
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xd4c090,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, this.material);
  }

  update(time) {
    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      const sx = this.seeds[i3];
      const sy = this.seeds[i3 + 1];
      const speed = this.seeds[i3 + 2];
      this.positions[i3] += Math.sin(time * 0.15 * speed + sx) * 0.002;
      this.positions[i3 + 1] += Math.sin(time * 0.1 * speed + sy) * 0.0015 + 0.0003;
      this.positions[i3 + 2] += Math.cos(time * 0.12 * speed + sx) * 0.001;

      if (this.positions[i3 + 1] > 3) this.positions[i3 + 1] = -3;
      if (this.positions[i3] > 5) this.positions[i3] = -5;
      if (this.positions[i3] < -5) this.positions[i3] = 5;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ── musical note particles ──────────────────────────────────
const COUNT = 50;
const SPREAD_X = 4.5;
const SPREAD_Y = 2.5;
const SPREAD_Z = 2;

function createNoteTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.font = '44px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = ['♩', '♪', '♫', '♬'];
  ctx.fillText(chars[Math.floor(Math.random() * chars.length)], size / 2, size / 2);
  return new THREE.CanvasTexture(canvas);
}

export class Particles {
  constructor() {
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    this.lifetimes = new Float32Array(COUNT);
    this.maxLifetimes = new Float32Array(COUNT);
    this.colors = new Float32Array(COUNT * 3);

    const gold = new THREE.Color(0xc9a84c);
    const teal = new THREE.Color(0x2a8a8a);

    for (let i = 0; i < COUNT; i++) {
      this.respawn(i);
      const c = Math.random() > 0.5 ? gold : teal;
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 0.045,
      map: createNoteTexture(),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.intensity = 1;
  }

  respawn(i) {
    const i3 = i * 3;
    this.positions[i3] = (Math.random() - 0.5) * SPREAD_X;
    this.positions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
    this.positions[i3 + 2] = (Math.random() - 0.5) * SPREAD_Z;
    this.velocities[i3] = (Math.random() - 0.5) * 0.015;
    this.velocities[i3 + 1] = Math.random() * 0.012 + 0.003;
    this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.008;
    this.maxLifetimes[i] = 350 + Math.random() * 450;
    this.lifetimes[i] = this.maxLifetimes[i];
  }

  update() {
    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      this.positions[i3] += this.velocities[i3];
      this.positions[i3 + 1] += this.velocities[i3 + 1];
      this.positions[i3 + 2] += this.velocities[i3 + 2];
      this.lifetimes[i]--;
      if (this.lifetimes[i] <= 0) this.respawn(i);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = 0.22 * this.intensity;
  }

  setIntensity(v) {
    this.intensity = v;
  }
}
