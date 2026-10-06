"""Converts the Blender render (tools/feather_blender.png) into the site textures.

Run:  python tools/finish_feather.py
"""
from PIL import Image
im = Image.open('tools/feather_blender.png').convert('RGBA')
im.save('assets/peacock-feather.webp', 'WEBP', quality=90, method=6)
im.resize((512, 1024), Image.LANCZOS).save('assets/peacock-feather-sm.webp', 'WEBP', quality=88, method=6)
back = 'tools/feather_back.png'
import os
if os.path.exists(back):
    bk = Image.open(back).convert('RGBA')
    bk.save('assets/peacock-feather-back.webp', 'WEBP', quality=88, method=6)
    bk.resize((512, 1024), Image.LANCZOS).save('assets/peacock-feather-back-sm.webp', 'WEBP', quality=86, method=6)
print('ok', im.size)
