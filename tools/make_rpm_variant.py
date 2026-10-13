"""Avatar "Saulė" from the TalkingHead brunette.glb (Ready Player Me, CC BY-NC 4.0).

Edits the GLB directly (no Blender needed): blonde hair, lighter brows, new outfit
colours, no glasses. Skeleton, ARKit and viseme blend shapes stay unchanged.

Run:  python tools/make_rpm_variant.py
Needs: Pillow. Output: avatars/saule.glb
"""
import colorsys
import io
import json
import struct
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_URL = ('https://raw.githubusercontent.com/met4citizen/TalkingHead/'
           'cf170209c49f8f67f96e3ed55bd7e9db06c5b2b3/avatars/brunette.glb')
SRC = ROOT / 'blender' / 'work' / 'brunette.glb'
OUT = ROOT / 'avatars' / 'saule.glb'

BLONDE_DARK = (150, 112, 62)
BLONDE_LIGHT = (246, 224, 172)
TOP_HUE_SHIFT = -100 / 360      # navy -> teal green
BOTTOM_HUE_SHIFT = -110 / 360   # magenta -> dark blue


def read_glb(data):
    json_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    return gltf, data[bin_start:]


def write_glb(gltf, views):
    blob = bytearray()
    for view, chunk in zip(gltf['bufferViews'], views):
        blob += b'\0' * (-len(blob) % 4)
        view['byteOffset'] = len(blob)
        view['byteLength'] = len(chunk)
        blob += chunk
    blob += b'\0' * (-len(blob) % 4)
    gltf['buffers'][0]['byteLength'] = len(blob)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (struct.pack('<III', 0x46546C67, 2, total)
            + struct.pack('<I4s', len(js), b'JSON') + js
            + struct.pack('<I4s', len(blob), b'BIN\0') + bytes(blob))


def blonde(lum):
    t = min(1.0, 0.35 + lum * 2.0)
    return tuple(round(d + (l - d) * t) for d, l in zip(BLONDE_DARK, BLONDE_LIGHT))


def lum_of(p):
    return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255


def recolor_hair(im):
    im = im.convert('RGB')
    im.putdata([blonde(lum_of(p)) for p in im.get_flattened_data()])
    return im


def recolor_scalp_and_brows(im):
    """Dark hair painted on the face texture: scalp (top) fully, brows partly."""
    im = im.convert('RGB')
    w, h = im.size
    px = im.load()
    for y in range(int(h * 0.30)):
        brow = y >= int(h * 0.26)
        for x in range(w):
            p = px[x, y]
            lum = lum_of(p)
            weight = max(0.0, min(1.0, (0.45 - lum) / 0.3))
            if brow:
                weight *= 0.6
            if weight:
                b = blonde(lum)
                px[x, y] = tuple(round(c + (n - c) * weight) for c, n in zip(p, b))
    return im


def shift_hue(im, shift):
    """Shift the base colour; keep the orange accent stripes."""
    im = im.convert('RGB')
    out = []
    for r, g, b in im.get_flattened_data():
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if 15 / 360 <= hh <= 55 / 360 and s > 0.4:
            out.append((r, g, b))
            continue
        r2, g2, b2 = colorsys.hsv_to_rgb((hh + shift) % 1, min(1, s * 1.15), v)
        out.append((round(r2 * 255), round(g2 * 255), round(b2 * 255)))
    im.putdata(out)
    return im


def main():
    if not SRC.exists():
        SRC.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(SRC_URL, SRC)
    gltf, bin_chunk = read_glb(SRC.read_bytes())
    views = [bin_chunk[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
             for v in gltf['bufferViews']]

    def material_image(name):
        mat = next(m for m in gltf['materials'] if m['name'] == name)
        tex = mat['pbrMetallicRoughness']['baseColorTexture']['index']
        return gltf['images'][gltf['textures'][tex]['source']]

    edits = {
        'Wolf3D_Hair': recolor_hair,
        'Wolf3D_Skin': recolor_scalp_and_brows,
        'Wolf3D_Outfit_Top': lambda im: shift_hue(im, TOP_HUE_SHIFT),
        'Wolf3D_Outfit_Bottom': lambda im: shift_hue(im, BOTTOM_HUE_SHIFT),
    }
    for material, edit in edits.items():
        image = material_image(material)
        src = Image.open(io.BytesIO(views[image['bufferView']]))
        buf = io.BytesIO()
        edit(src).save(buf, 'PNG', optimize=True)
        views[image['bufferView']] = buf.getvalue()

    glasses = next(i for i, n in enumerate(gltf['nodes']) if n.get('name') == 'Wolf3D_Glasses')
    for node in gltf['nodes']:
        if glasses in node.get('children', []):
            node['children'].remove(glasses)

    OUT.write_bytes(write_glb(gltf, views))
    print(f'{OUT} {OUT.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
