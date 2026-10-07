# वेणु · Venu

A scroll-driven 3D journey into Krishna's flute. One page, no build step: plain HTML, CSS and JavaScript, with
[Three.js](https://threejs.org) for the 3D scene and [Lenis](https://lenis.darkroom.engineering) for smooth scrolling.
Everything it needs (libraries, fonts, the 3D model, the music) is inside this folder, so it also works offline.

## Run it

The page uses ES modules, so it must be served over HTTP (opening `index.html` directly will not work):

```
python -m http.server 8765
```

then open <http://localhost:8765/>.

**Publishing:** it is a plain static site, so any static host works. On GitHub Pages: Settings → Pages → deploy from the
`main` branch, root folder. (`.nojekyll` is included so every file is served as is.)

## What is in the folder

| Path | What it is |
|---|---|
| `index.html`, `styles.css` | the page, the chapter text and the verses |
| `js/` | `main.js` (scroll, gate, navigation), `audio.js` (the music), `stage/` (the 3D scene: flute, feather, camera, particles) |
| `assets/flute/` | the flute model (`flute.gltf`, 4K textures) and `hi/` (8K textures that desktops swap in) |
| `assets/` | feather textures, music (`score.mp3`), fonts, share image |
| `vendor/` | Three.js and Lenis, copied locally (MIT licensed) |
| `tools/` | the scripts that built the flute, feather and textures (see below). `tools/_work/` holds big intermediate files |
| `audio/`, `ref/` | local only (not in the repository): the original music download and the design reference image |

## Editing the content

- **Chapter text and verses:** `index.html` (look for `class="caption chapter"` and `class="caption verse"`).
  Each caption has a `data-window` of four scroll positions (fade in start, full, full end, fade out end), between 0 and 1.
- **Camera shots:** `js/stage/camera.js` (one row per chapter).
- **Music level, fade:** top of `js/audio.js`.

## Rebuilding the flute and feather (needs Blender 4.2+ and Python with numpy, scipy, Pillow)

Run from this folder. Use the path to your own Blender install if `blender` is not on your PATH.

```
# 1. bamboo grain (baked in Blender)
blender -b -P tools/make_bamboo_blender.py -- 1152 8192 tools/_work/grain_8k.png
# 2. flute textures: filigree, thread-wrapped bands, normal map, roughness/metal
python tools/make_flute_textures.py
python tools/finish_flute_textures.py
# 3. the flute model -> assets/flute/flute.gltf
blender -b -P tools/make_flute_blender.py
# 4. the feather, and its back layer for depth
blender -b -P tools/make_feather_blender.py
blender -b -P tools/make_feather_blender.py -- back
python tools/finish_feather.py
```

The music loop was trimmed and crossfaded from the original download (kept locally in `audio/`; see `tools/encode_audio.py`).
`tools/make_score.py` synthesizes an alternative score from scratch.

## Credits and licences

- **Music:** ["Indian Classical Raga"](https://pixabay.com/music/india-indian-classical-raga-537491/) by Alex Morgan, from Pixabay
  (Pixabay Content License; credit is optional but is given on the closing screen).
- **Verses:** Śrīmad Bhāgavatam 10.21 (the Veṇu-gīta). Sanskrit checked against Vedabase; the English lines are paraphrases.
- **Fonts:** Cormorant Garamond, Cormorant SC, Yatra One (SIL Open Font License).
- **Libraries:** Three.js and Lenis (MIT).
