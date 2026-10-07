import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const IS_PHONE = /mobi|android|iphone|ipad/i.test(navigator.userAgent);

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.02 },
    uVignette: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      float caScale = 0.008;
      vec2 fromCenter = vUv - 0.5;
      float edge = dot(fromCenter, fromCenter);
      vec3 color;
      color.r = texture2D(tDiffuse, vUv - fromCenter * edge * caScale).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv + fromCenter * edge * caScale).b;

      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luma), color, 0.92);

      vec3 tint = vec3(0.01, 0.008, 0.025);
      color += tint * (1.0 - luma);

      color *= 1.0 - edge * uVignette;

      float grain = hash(floor(gl_FragCoord.xy) + fract(uTime) * 100.0) - 0.5;   // one grain per drawn pixel, so it can never stretch into blotches
      color += grain * uGrain;

      color.r *= 1.03;
      color.b *= 0.96;

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

function detectQuality() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return 'low';

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase() : '';
  canvas.remove();

  const isMobile = /mobi|android|iphone|ipad/i.test(navigator.userAgent);
  const isWeakGPU = /intel|mali|adreno 3|adreno 4|powervr/i.test(gpu);

  if (isMobile && isWeakGPU) return 'low';
  if (isMobile || isWeakGPU) return 'medium';
  return 'high';
}

const QUALITY = detectQuality();

const SETTINGS = {
  // pixelRatio: how many drawn pixels per screen pixel (phones have 2-3; the page lowers it by itself if the device is slow)
  // msaa: edge smoothing for the effects pipeline (the browser's own anti-aliasing does not reach it)
  low:    { pixelRatio: 1.5,  msaa: 2, shadows: false,  shadowSize: 512,  bokeh: false, bloomStrength: 0.35 },
  medium: { pixelRatio: 2.0,  msaa: 2, shadows: true,  shadowSize: 512,  bokeh: false, bloomStrength: 0.45 },
  high:   { pixelRatio: 1.5,  msaa: 4, shadows: true,  shadowSize: 1024, bokeh: true,  bloomStrength: 0.55 },
};

export function getQuality() { return QUALITY; }
export function getMaxPixelRatio() { return Math.min(window.devicePixelRatio, SETTINGS[QUALITY].pixelRatio); }

// the biggest texture this GPU can hold, and whether it is worth loading the 8K body textures here
export function canUseHiResTextures() {
  if (QUALITY === 'low' || /mobi|android|iphone|ipad/i.test(navigator.userAgent)) return false;
  const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  return !!gl && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192;
}

export function createRenderer(canvas) {
  const q = SETTINGS[QUALITY];
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: QUALITY !== 'low',
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = q.shadows && !IS_PHONE;     // nothing in the scene casts a shadow; do not pay for the pass on phones
  if (q.shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createComposer(renderer, scene, camera) {
  const q = SETTINGS[QUALITY];
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: q.msaa });
  const composer = new EffectComposer(renderer, target);

  composer.addPass(new RenderPass(scene, camera));

  let bokeh = null;
  if (q.bokeh) {
    bokeh = new BokehPass(scene, camera, {
      focus: 3.0,
      aperture: 0.002,
      maxblur: 0.008,
    });
    composer.addPass(bokeh);
  }

  // the glow is soft anyway, so it is computed at half size (about four times cheaper) on everything but high quality
  const bloomSize = QUALITY === 'high' ? size : size.clone().multiplyScalar(0.5);
  const bloom = new UnrealBloomPass(bloomSize, q.bloomStrength, 0.4, 0.92);
  composer.addPass(bloom);

  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  // the last pass (tone mapping + colour space) also adds a hair of noise before the 8-bit screen, so the dark blue
  // gradients do not show bands at full brightness. Folded into this pass, because a pass of its own cost ~10 fps
  const output = new OutputPass();
  const DITHER = `
			vec2 dp = floor( gl_FragCoord.xy );
			float dn = fract( sin( dot( dp + fract( uTime ) * 37.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 )
			         + fract( sin( dot( dp + 91.7 - fract( uTime ) * 53.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 1.0;
			gl_FragColor.rgb += dn / 255.0;
		}`;
  const src = output.material.fragmentShader;
  const end = src.lastIndexOf('}');
  output.material.fragmentShader = src.slice(0, end).replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\n\t\tuniform float uTime;') + DITHER;
  output.uniforms.uTime = { value: 0 };
  composer.addPass(output);
  const dither = output;            // (scene.js feeds it the time, as it does the film pass)
  // phones: no film grain at all (a smeared grain on a small bright screen just looks like dirt)
  if (IS_PHONE) film.uniforms.uGrain.value = 0;

  return { composer, bloom, film, bokeh, dither };
}
