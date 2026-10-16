# SPDX-License-Identifier: GPL-3.0-or-later
"""Minimaler PNG-Schreiber (numpy + zlib) mit adaptiven Filtern.

Schreibt 8-Bit-Graustufen, RGB oder RGBA kleiner als Blenders eigener Schreiber (je Zeile der beste
der fünf PNG-Filter) und deterministisch (gleiche Pixel -> gleiche Bytes). Nur für die Mockup-Grundlagen.
"""

import struct
import zlib
from pathlib import Path

import numpy as np

_COLOR_TYPE = {1: 0, 3: 2, 4: 6}


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - c)
    return np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))


def encode_png(arr: np.ndarray, level: int = 9) -> bytes:
    """Kodiert ein uint8-Array (H, W) / (H, W, 1|3|4) als PNG."""
    if arr.dtype != np.uint8:
        raise ValueError("uint8 erwartet")
    if arr.ndim == 2:
        arr = arr[:, :, None]
    h, w, ch = arr.shape
    if ch not in _COLOR_TYPE:
        raise ValueError("1, 3 oder 4 Kanäle erwartet")
    raw = np.ascontiguousarray(arr.reshape(h, w * ch)).astype(np.int16)
    up = np.vstack([np.zeros((1, w * ch), np.int16), raw[:-1]])
    left = np.zeros_like(raw)
    left[:, ch:] = raw[:, :-ch]
    upleft = np.zeros_like(raw)
    upleft[:, ch:] = up[:, :-ch]
    candidates = [
        raw,
        raw - left,
        raw - up,
        raw - ((left + up) >> 1),
        raw - _paeth(left, up, upleft),
    ]
    candidates = [(c & 0xFF).astype(np.uint8) for c in candidates]
    # Zeilenweise der Filter mit der kleinsten Betragssumme (übliche Heuristik)
    scores = np.stack([np.minimum(c, 256 - c.astype(np.int16)).astype(np.int32).sum(axis=1) for c in candidates])
    best = scores.argmin(axis=0)
    out = np.empty((h, 1 + w * ch), np.uint8)
    out[:, 0] = best
    stack = np.stack(candidates)
    out[:, 1:] = stack[best, np.arange(h)]
    header = struct.pack(">IIBBBBB", w, h, 8, _COLOR_TYPE[ch], 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", header) + _chunk(b"IDAT", zlib.compress(out.tobytes(), level)) + _chunk(b"IEND", b"")


def write_png(path, arr: np.ndarray) -> int:
    data = encode_png(arr)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
    return len(data)
