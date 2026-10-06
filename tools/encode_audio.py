"""Compresses tools/_work/score.wav to assets/score.mp3 using Blender's built-in FFmpeg.

Run:  D:/Blender/app/blender.exe -b -P tools/encode_audio.py
"""
import bpy, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
# optional:  blender -b -P encode_audio.py -- <src.wav> <out.mp3> <seconds> <kbps>
_a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = _a[0] if len(_a) > 0 else os.path.join(HERE, '_work', 'score.wav')
OUT = _a[1] if len(_a) > 1 else os.path.join(os.path.dirname(HERE), 'assets', 'score.mp3')
DUR = float(_a[2]) if len(_a) > 2 else 104.0
KBPS = int(_a[3]) if len(_a) > 3 else 192
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = int(DUR * FPS)
scene.sequence_editor_create()
seq = scene.sequence_editor
strips = seq.strips if hasattr(seq, 'strips') else seq.sequences
strips.new_sound(name='score', filepath=SRC, channel=1, frame_start=1)

bpy.ops.sound.mixdown(filepath=OUT, check_existing=False, container='MP3', codec='MP3',
                      format='S16', bitrate=KBPS, accuracy=1024)
# the mixdown runs on a worker thread; wait until the file stops growing before Blender quits
last, still = -1, 0
for _ in range(600):
    time.sleep(0.5)
    size = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    still = still + 1 if size == last and size > 10000 else 0
    last = size
    if still >= 6:
        break
print('encoded', OUT, last)
