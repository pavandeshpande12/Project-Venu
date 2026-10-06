import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getQuality, canUseHiResTextures } from './renderer.js';

const BODY_LENGTH = 3.8;
const BODY_HALF = BODY_LENGTH / 2;
const RADIUS_LEFT = 0.09;
const RADIUS_RIGHT = 0.075;
const RADIAL = 32;

function radiusAt(x) {
  const t = (x + BODY_HALF) / BODY_LENGTH;
  return RADIUS_LEFT + (RADIUS_RIGHT - RADIUS_LEFT) * t;
}

// ── GLSL noise for bamboo grain ─────────────────────────────
const GRAIN_PARS = /* glsl */ `
  float grainHash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }
  float grainNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = grainHash(i);
    float b = grainHash(i + vec2(1.0, 0.0));
    float c = grainHash(i + vec2(0.0, 1.0));
    float d = grainHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float bambooGrain(vec3 pos) {
    float fiber = grainNoise(vec2(pos.x * 28.0, atan(pos.z, pos.y) * 4.0));
    fiber = pow(fiber, 0.6);
    float coarse = grainNoise(vec2(pos.x * 6.0, atan(pos.z, pos.y) * 2.0));
    float vascular = smoothstep(0.42, 0.46, grainNoise(vec2(pos.x * 3.5 + 0.7, atan(pos.z, pos.y) * 12.0)));
    return mix(fiber, coarse, 0.3) - vascular * 0.12;
  }

  // ── decoration: red/green bands with gold lines, and gold scroll carving ──
  const float HOLE_X[6] = float[6](-0.2, 0.15, 0.5, 0.95, 1.2, 1.42);
  const float BAND_X[4] = float[4](-1.62, -1.12, -0.45, 1.07);
  const float JOINT_X[3] = float[3](-0.7, 0.75, 1.6);
  const float BAND_W = 0.05;
  const vec3 RED   = vec3(0.42, 0.10, 0.07);
  const vec3 GREEN = vec3(0.09, 0.27, 0.14);
  const vec3 GOLDC = vec3(0.62, 0.43, 0.13);

  vec3 decorate(vec3 base, vec3 lp) {
    float x = lp.x;
    float theta = atan(lp.z, lp.y);
    vec3 col = base;

    // scroll carving: one spiral per cell, neighbours curl opposite ways
    vec2 cellUV = vec2(x / 0.125, (theta / 6.28318530718 + 0.5) * 4.0);
    vec2 id = floor(cellUV);
    vec2 f = fract(cellUV) - 0.5;
    float h = grainHash(id + 3.7);
    f.x *= (h > 0.5) ? 1.0 : -1.0;
    float ang = h * 6.28318;
    f = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * f;
    float r = length(f);
    float spiral = fract(atan(f.y, f.x) / 6.28318530718 + r * 3.0 + h);
    float aa = fwidth(spiral);
    float swirl = 1.0 - smoothstep(0.04, 0.10 + aa, abs(spiral - 0.5));
    swirl *= (1.0 - smoothstep(0.33, 0.44, r)) * smoothstep(0.04, 0.09, r);

    float zone = smoothstep(-1.02, -0.92, x) * (1.0 - smoothstep(1.24, 1.32, x));
    for (int i = 0; i < 3; i++) zone *= smoothstep(0.05, 0.08, abs(x - JOINT_X[i]));
    for (int i = 0; i < 4; i++) zone *= smoothstep(0.09, 0.115, abs(x - BAND_X[i]));
    for (int i = 0; i < 6; i++) zone *= smoothstep(0.07, 0.095, length(vec2(x - HOLE_X[i], theta * 0.08)));
    col = mix(col, GOLDC, swirl * zone * 0.85);

    // bands: red body, green core, thin gold lines either side
    for (int i = 0; i < 4; i++) {
      float d = abs(x - BAND_X[i]);
      float e = 0.0016;
      float red = 1.0 - smoothstep(BAND_W - e, BAND_W + e, d);
      float green = 1.0 - smoothstep(BAND_W * 0.45 - e, BAND_W * 0.45 + e, d);
      float line = 1.0 - smoothstep(0.0032, 0.0032 + e * 2.0, abs(d - (BAND_W + 0.013)));
      col = mix(col, RED, red);
      col = mix(col, GREEN, green);
      col = mix(col, GOLDC, line);
    }
    return col;
  }
`;

const GRAIN_MAIN = /* glsl */ `
  // baked Blender grain (via the map) + fine procedural grain for close-ups
  float grain = bambooGrain(vLocalPos);
  vec3 grainColor = diffuseColor.rgb * (0.86 + 0.28 * grain);
  diffuseColor.rgb = decorate(grainColor, vLocalPos);
`;

// ── GLSL iridescence for feather eye ────────────────────────
const IRIDESCENCE_PARS = /* glsl */ `
  vec3 thinFilm(float cosTheta) {
    float t = clamp(1.0 - cosTheta, 0.0, 1.0);
    float t2 = t * t;
    float t5 = t2 * t2 * t;
    vec3 teal   = vec3(0.16, 0.54, 0.54);
    vec3 gold   = vec3(0.78, 0.66, 0.30);
    vec3 purple = vec3(0.42, 0.18, 0.56);
    vec3 col = teal;
    col = mix(col, gold, smoothstep(0.0, 0.45, t));
    col = mix(col, purple, smoothstep(0.45, 0.85, t));
    col += t5 * 0.3;
    return col;
  }
`;

const IRIDESCENCE_MAIN = /* glsl */ `
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float NdotV = abs(dot(vNormal, viewDir));
  vec3 iriCol = thinFilm(NdotV);
  diffuseColor.rgb = iriCol;
`;

// ── bamboo body ──────────────────────────────────────────────
function createBody() {
  const geo = new THREE.CylinderGeometry(
    RADIUS_RIGHT, RADIUS_LEFT, BODY_LENGTH, RADIAL, 64, false
  );
  geo.rotateZ(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.sqrt(y * y + z * z);
    if (r > 0.01) {
      const wobble = 1 + Math.sin(x * 14) * 0.0012 + Math.sin(x * 31 + 1.7) * 0.0006;
      pos.setY(i, y * wobble);
      pos.setZ(i, z * wobble);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const grainTex = new THREE.TextureLoader().load('assets/bamboo-grain.webp');
  grainTex.colorSpace = THREE.SRGBColorSpace;
  grainTex.wrapS = THREE.RepeatWrapping;       // u runs around the flute
  grainTex.anisotropy = 8;

  const mat = new THREE.MeshStandardMaterial({
    map: grainTex,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.06,
    emissive: 0x1a1408,
    emissiveIntensity: 0.35,
  });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vLocalPos;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vLocalPos = transformed;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vLocalPos;
       ${GRAIN_PARS}`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       ${GRAIN_MAIN}`
    );
  };

  return new THREE.Mesh(geo, mat);
}

// ── finger / blowing holes ───────────────────────────────────
function createHole(x, outerR, innerR) {
  const group = new THREE.Group();
  const r = radiusAt(x);

  const ringGeo = new THREE.RingGeometry(innerR, outerR, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xc9a84c,
    metalness: 0.3,
    roughness: 0.45,
    emissive: 0x2a1a08,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(x, r + 0.002, 0);
  group.add(ring);

  const holeGeo = new THREE.CircleGeometry(innerR, 24);
  holeGeo.rotateX(-Math.PI / 2);
  const holeMat = new THREE.MeshStandardMaterial({
    color: 0x050403,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.position.set(x, r + 0.001, 0);
  group.add(hole);

  return group;
}

// ── bamboo joints / knots ────────────────────────────────────
function createJoint(x) {
  const r = radiusAt(x);
  // swollen node: the wall bulges out smoothly over a short stretch of bamboo
  const profile = [];
  const half = 0.05;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const bulge = Math.sin(t * Math.PI);
    profile.push(new THREE.Vector2(r + 0.002 + bulge * bulge * 0.016, -half + t * half * 2));
  }
  const geo = new THREE.LatheGeometry(profile, RADIAL);
  geo.rotateZ(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a6e28,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0x120e04,
    emissiveIntensity: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0, 0);
  return mesh;
}

// ── gold ornaments ───────────────────────────────────────────
const GOLD = {
  color: 0xd6a23a,
  metalness: 0.55,
  roughness: 0.34,
  emissive: 0x3a2208,
  emissiveIntensity: 0.22,
};

function lathe(points, x) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), RADIAL);
  geo.rotateZ(-Math.PI / 2);          // lathe axis -> flute axis (+x)
  geo.translate(x, 0, 0);
  return geo;
}

// ring of small gold beads, like the studded collars in the reference
function beadRing(x, radius, count, size) {
  const beads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(size, 8, 6), new THREE.MeshStandardMaterial(GOLD), count
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    m.makeTranslation(x, Math.cos(a) * radius, Math.sin(a) * radius);
    beads.setMatrixAt(i, m);
  }
  return beads;
}

// plain studded collar (mouth end)
function createCollar(x) {
  const r = radiusAt(x);
  const group = new THREE.Group();
  const band = new THREE.Mesh(
    lathe([[r + 0.004, -0.045], [r + 0.018, -0.03], [r + 0.02, 0.03], [r + 0.004, 0.045]], x),
    new THREE.MeshStandardMaterial({ ...GOLD, side: THREE.DoubleSide })
  );
  group.add(band, beadRing(x, r + 0.021, 16, 0.0075));
  return group;
}

// feather end: studded collar, neck, bulb and a finial, as in the reference
const END_X = 1.74;
const NECK_X = 1.855;
const NECK_R = 0.078;
function createFeatherEnd() {
  const group = new THREE.Group();
  const profile = [
    [0.082, 0.0], [0.098, 0.02], [0.1, 0.045], [0.098, 0.07], [0.082, 0.09],
    [NECK_R, 0.105], [NECK_R, 0.135],
    [0.095, 0.155], [0.118, 0.19], [0.122, 0.215], [0.108, 0.245], [0.07, 0.275],
    [0.036, 0.3], [0.02, 0.325], [0.008, 0.37], [0.0, 0.4],
  ];
  const body = new THREE.Mesh(
    lathe(profile, END_X), new THREE.MeshStandardMaterial({ ...GOLD, side: THREE.DoubleSide })
  );
  group.add(body, beadRing(END_X + 0.045, 0.101, 18, 0.0085), beadRing(END_X + 0.2, 0.119, 18, 0.0075));
  return group;
}

const FEATHER_LEAN = 0.38;

// ── peacock feather (drawn texture, see tools/make_feather.py) ─────────────────────────
function createFeather() {
  const group = new THREE.Group();

  const featherH = 1.1;
  const featherW = 0.55;

  const vaneGeo = new THREE.PlaneGeometry(featherW, featherH, 16, 32);
  const pos = vaneGeo.attributes.position;
  const uv = vaneGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const v = 1 - uv.getY(i);
    const u = uv.getX(i);
    pos.setY(i, pos.getY(i) + featherH / 2);
    const bend = Math.sin(v * Math.PI) * 0.03 + v * v * 0.05;             // the whole feather arcs back toward its tip
    pos.setZ(i, bend + Math.pow(Math.abs(u - 0.5) * 2, 1.6) * 0.045 * (0.35 + v));   // edges curl forward, more so higher up
  }
  pos.needsUpdate = true;
  vaneGeo.computeVertexNormals();

  const loader = new THREE.TextureLoader();
  const texPath = getQuality() === 'low' ? 'assets/peacock-feather-sm.webp' : 'assets/peacock-feather.webp';
  const featherTex = loader.load(texPath);
  featherTex.colorSpace = THREE.SRGBColorSpace;
  featherTex.minFilter = THREE.LinearMipMapLinearFilter;
  featherTex.magFilter = THREE.LinearFilter;
  featherTex.generateMipmaps = true;

  const vaneMat = new THREE.MeshStandardMaterial({
    map: featherTex,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.18,
    emissive: 0x0a2820,
    emissiveIntensity: 0.35,
    depthWrite: true,
  });

  const windUniform = { value: 0 };

  vaneMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uWind;
       varying vec3 vWPos;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float h = clamp(position.y / ${featherH.toFixed(1)}, 0.0, 1.0);
       float flutter = sin(uWind * 3.0 + h * 6.0) * 0.02 * h * h
                      + sin(uWind * 5.3 + h * 4.0) * 0.008 * h;
       transformed.z += flutter;
       transformed.x += sin(uWind * 1.7 + h * 3.0) * 0.006 * h * h;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWPos;
       ${IRIDESCENCE_PARS}`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       vec3 vDir = normalize(cameraPosition - vWPos);
       float ndv = abs(dot(vNormal, vDir));
       vec3 iri = thinFilm(ndv);
       diffuseColor.rgb = mix(diffuseColor.rgb, iri * diffuseColor.rgb * 1.8, 0.18);`
    );
  };

  group.userData.windUniform = windUniform;

  // three layers fanned slightly apart give the plume real depth, and they shift against each other as the camera moves
  const vane = new THREE.Mesh(vaneGeo, vaneMat);
  group.add(vane);
  const backTex = loader.load(getQuality() === 'low' ? 'assets/peacock-feather-back-sm.webp' : 'assets/peacock-feather-back.webp');
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.minFilter = THREE.LinearMipMapLinearFilter;
  backTex.generateMipmaps = true;
  // (no rotation: a turned layer would slice through the front one; and no eye: a second eye would show through)
  for (const [tint, push, shift, scale] of [[0.55, -0.026, -0.016, 0.94], [0.8, -0.013, 0.014, 0.97]]) {
    const mat = vaneMat.clone();
    mat.map = backTex;
    mat.color.setScalar(tint);
    mat.onBeforeCompile = vaneMat.onBeforeCompile;
    const layer = new THREE.Mesh(vaneGeo, mat);
    layer.position.set(shift, 0, push);
    layer.scale.set(scale, scale, 1);
    group.add(layer);
  }

  // quill stub that goes down into the ferrule's neck
  const stub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0032, 0.0062, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.55, emissive: 0x1a1408, emissiveIntensity: 0.3 })
  );
  stub.position.y = 0.04;
  group.add(stub);

  // seated in the neck of the gold ferrule, leaning back over the flute
  group.position.set(NECK_X, NECK_R - 0.012, 0);
  group.rotation.z = FEATHER_LEAN;

  return group;
}

// two cords with green tassels hanging from the collar
function createTassels() {
  const group = new THREE.Group();
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xb04fb0, roughness: 0.6 });
  const goldMat = new THREE.MeshStandardMaterial(GOLD);
  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x1f7a30, roughness: 0.7, emissive: 0x04140a, emissiveIntensity: 0.3, side: THREE.DoubleSide,
  });
  const skirt = [[0.006, 0.0], [0.016, -0.014], [0.026, -0.045], [0.022, -0.075], [0.014, -0.085]];

  // [x offset, z offset, cord length]
  for (const [dx, dz, len] of [[-0.008, 0.007, 0.13], [0.008, -0.007, 0.21]]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, len, 6), cordMat);
    cord.position.set(dx, -len / 2, dz);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.02, 10), goldMat);
    cap.position.set(dx, -len - 0.008, dz);
    const tassel = new THREE.Mesh(
      new THREE.LatheGeometry(skirt.map(([r, y]) => new THREE.Vector2(r, y)), 14), greenMat
    );
    tassel.position.set(dx, -len - 0.018, dz);
    group.add(cord, cap, tassel);
  }
  // knot where the cords leave the collar
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), goldMat);
  group.add(knot);

  group.position.set(END_X + 0.045, -0.1, 0);
  return group;
}

// ── feather wind sway (called each frame from scene.js) ─────
export function swayFeather(featherGroup, time) {
  if (!featherGroup) return;

  const breeze = Math.sin(time * 0.5) * 0.6 + Math.sin(time * 0.23) * 0.4;
  const gust = Math.pow(Math.max(0, Math.sin(time * 0.17 + 2.0)), 4) * 0.8;
  const flutter = Math.sin(time * 2.1) * 0.3 + Math.sin(time * 3.4) * 0.15;
  const wind = breeze + gust + flutter * (0.3 + gust);

  featherGroup.rotation.z = FEATHER_LEAN + wind * 0.04;
  featherGroup.rotation.x = Math.sin(time * 0.7) * 0.015 + gust * 0.02;
  featherGroup.rotation.y = Math.sin(time * 0.35) * 0.01 + wind * 0.008;

  const tassels = featherGroup.userData.tassels;
  if (tassels) {
    tassels.rotation.z = Math.sin(time * 0.9) * 0.05 + wind * 0.03;
    tassels.rotation.x = Math.sin(time * 0.7 + 1.3) * 0.04;
  }

  if (featherGroup.userData.windUniform) {
    featherGroup.userData.windUniform.value = time;
  }
}

// ── assemble ─────────────────────────────────────────────────
export function createFlute() {
  const flute = new THREE.Group();

  flute.add(createBody());

  flute.add(createHole(-1.45, 0.065, 0.045));

  for (const x of [-0.2, 0.15, 0.5, 0.95, 1.2, 1.42]) {
    flute.add(createHole(x, 0.048, 0.032));
  }

  flute.add(createJoint(-0.7));
  flute.add(createJoint(0.75));
  flute.add(createJoint(1.6));

  flute.add(createCollar(-1.78));
  flute.add(createFeatherEnd());

  const feather = createFeather();
  flute.add(feather);
  const tassels = createTassels();
  flute.add(tassels);
  feather.userData.tassels = tassels;
  flute.userData.feather = feather;

  flute.rotation.z = -0.02;
  flute.position.y = -0.15;
  return flute;
}

// ── the modelled flute (Blender -> assets/flute/flute.gltf) ──────────────────
// Body, gold trim and tassels come from the model; the feather is still built here so it can sway.
// If the model can't load, fall back to the flute built in code above.
export async function loadFlute(onProgress) {
  try {
    // the model is five files (.gltf, .bin, three body textures). The manager only learns about the .bin and
    // textures after the .gltf is parsed, so count against the known total, not the running one.
    const MODEL_FILES = 5;
    const manager = new THREE.LoadingManager();
    manager.onProgress = (url, loaded) => onProgress && onProgress(Math.min(1, loaded / MODEL_FILES));
    const gltf = await new GLTFLoader(manager).loadAsync('assets/flute/flute.gltf');
    const flute = new THREE.Group();
    flute.add(gltf.scene);

    const feather = createFeather();
    flute.add(feather);
    feather.userData.tassels = gltf.scene.getObjectByName('Tassels');
    flute.userData.feather = feather;

    flute.rotation.z = -0.02;
    flute.position.y = -0.15;
    if (canUseHiResTextures()) upgradeBodyTextures(gltf.scene);   // the page is already showing; sharper maps arrive a moment later
    return flute;
  } catch (error) {
    console.warn('Flute model failed to load, using the built-in flute:', error);
    return createFlute();
  }
}

// The model ships with 4K body textures (safe everywhere). Desktop GPUs get the 8K set, swapped in once it
// has downloaded, which doubles the sharpness of the thread, filigree and grain in close-ups.
function upgradeBodyTextures(root) {
  const mats = new Set();
  root.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'Bamboo') mats.add(o.material); });
  const loader = new THREE.TextureLoader();
  const load = (url, srgb) => new Promise((resolve, reject) => {
    loader.load(url, (t) => {
      t.flipY = false;                                // glTF convention
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      resolve(t);
    }, undefined, reject);
  });
  Promise.all([
    load('assets/flute/hi/body_color.webp', true),
    load('assets/flute/hi/body_normal.webp', false),
    load('assets/flute/hi/body_orm.webp', false),
  ]).then(([color, normal, orm]) => {
    for (const m of mats) {
      const old = [m.map, m.normalMap, m.metalnessMap];
      m.map = color;
      m.normalMap = normal;
      m.metalnessMap = orm;
      m.roughnessMap = orm;
      m.needsUpdate = true;
      for (const t of old) if (t && t !== color && t !== normal && t !== orm) t.dispose();
    }
  }).catch(() => { /* the 4K set stays; nothing to do */ });
}
