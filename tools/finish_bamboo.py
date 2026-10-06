"""Converts the Blender bake (tools/bamboo_blender.png) into the site texture.

Run:  python tools/finish_bamboo.py
"""
from PIL import Image
im = Image.open('tools/bamboo_blender.png').convert('RGB')
im.save('assets/bamboo-grain.webp', 'WEBP', quality=84, method=6)
print('ok', im.size)
