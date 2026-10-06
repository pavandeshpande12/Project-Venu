"""Turns the full-size body textures into what the site ships:
  tools/_work/body_*_4k.png     -> read by make_flute_blender.py (the glTF carries the 4K set, which every device can load)
  assets/flute/hi/body_*.webp   -> the 8K set, which the page swaps in on devices that can hold it

Run:  python tools/finish_flute_textures.py
"""
import os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
os.makedirs('assets/flute/hi', exist_ok=True)
for name in ('color', 'normal', 'orm'):
    im = Image.open(f'tools/_work/body_{name}.png').convert('RGB')
    im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(f'tools/_work/body_{name}_4k.png')
    im.save(f'assets/flute/hi/body_{name}.webp', 'WEBP', quality=88 if name != 'normal' else 92, method=5)
    print(name, im.size, '->', os.path.getsize(f'assets/flute/hi/body_{name}.webp') // 1024, 'KB (8K webp)')
