# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Génère les icônes PNG de Respire : l'orbe au couchant, un voilier sur
l'écume, deux mouettes, et l'horizon qui déborde du cercle.

    uv run tools/make_icons.py

Écrit icons/icon-512.png, icons/icon-192.png et icons/apple-touch-icon.png.
Le favicon (icons/icon.svg) est une version simplifiée, éditée à la main.
"""

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024                 # working size, downscaled at the end
C = S / 2                # centre
R = S * 0.30             # orb radius
LEVEL = C + R * 0.02     # sea level inside the orb

SKY = [(0, (42, 40, 98)), (0.55, (170, 90, 120)), (1, (255, 140, 90))]
DEEP = (10, 12, 36)
SILHOUETTE = (36, 22, 50)


def lerp(a, b, k):
    return tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(len(a)))


def vertical_gradient(stops, y0, y1, alpha=255):
    img = Image.new("RGBA", (S, S))
    d = ImageDraw.Draw(img)
    for y in range(S):
        k = min(1, max(0, (y - y0) / (y1 - y0)))
        for (k0, c0), (k1, c1) in zip(stops, stops[1:]):
            if k0 <= k <= k1:
                col = lerp(c0, c1, (k - k0) / (k1 - k0))
                break
        d.line((0, y, S, y), fill=col + (alpha,))
    return img


def soft_disc(x, y, r, col, alpha, blur):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((x - r, y - r, x + r, y + r), fill=col + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def quad(a, b, c, n=10):
    return [
        ((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0],
         (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1])
        for t in (i / n for i in range(n + 1))
    ]


def wave(off, amp, k, ph):
    def f(x):
        u = (x - C) / R * k * math.pi
        return LEVEL + off * R + amp * R * (0.65 * math.sin(u + ph) + 0.35 * math.sin(u * 2.3 - ph))
    return f


def background():
    img = vertical_gradient([(0, (8, 6, 22)), (1, (18, 6, 20))], 0, S)
    img.alpha_composite(soft_disc(C, C + R * 0.05, R * 1.05, (255, 128, 80), 70, 90))

    random.seed(4)
    d = ImageDraw.Draw(img)
    for _ in range(38):
        x, y = random.uniform(40, S - 40), random.uniform(40, LEVEL - R * 0.2)
        if math.hypot(x - C, y - C) < R * 1.12:
            continue
        r = random.choice([1.5, 2, 2.5, 3.5])
        d.ellipse((x - r, y - r, x + r, y + r), fill=(235, 240, 255, random.randint(90, 200)))

    # The horizon continuing beyond the orb
    horizon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(horizon)
    for j in range(3):
        y0 = LEVEL + R * (0.03 + j * j * 0.06)
        pts = [(x, y0 + math.sin((x - C) / R * (2.2 + j)) * R * 0.015) for x in range(0, S + 8, 8)]
        for a, b in zip(pts, pts[1:]):
            fade = max(0, 1 - abs(a[0] - C) / (R * 2.4))
            hd.line((a, b), fill=(255, 190, 160, int(150 * fade * (1 - j * 0.28))), width=3)
    img.alpha_composite(horizon)
    return img


def draw_boat(orb, surface):
    x0, L = C - R * 0.45, R * 0.15
    y0 = surface(x0) + L * 0.1
    P = lambda pts: [(x0 + x * L, y0 + y * L) for x, y in pts]
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon(P([(-0.6, -0.02), (0.62, -0.02), (0.45, 0.16), (-0.42, 0.16)]), fill=(28, 18, 40, 240))
    d.polygon(P(quad((0.02, -1.08), (0.42, -0.5), (0.5, -0.1), 12) + [(0.02, -0.1)]), fill=SILHOUETTE + (235,))
    d.polygon(P([(-0.06, -0.92), (-0.06, -0.12), (-0.5, -0.12)]), fill=SILHOUETTE + (205,))
    d.line(P([(-0.02, -1.12), (-0.02, -0.02)]), fill=(28, 18, 40, 240), width=4)
    orb.alpha_composite(layer)


def draw_gull(d, x, y, g):
    pts = quad((x - g, y + g * 0.15), (x - g * 0.45, y - g * 0.5), (x, y)) + \
        quad((x, y), (x + g * 0.45, y - g * 0.5), (x + g, y + g * 0.15))[1:]
    d.line(pts, fill=(48, 30, 64, 230), width=max(3, int(g * 0.16)), joint="curve")


def orb():
    img = vertical_gradient(SKY, C - R, LEVEL)
    sun_y = LEVEL - R * 0.22
    img.alpha_composite(soft_disc(C, sun_y, R * 0.55, (255, 170, 100), 120, 45))
    img.alpha_composite(soft_disc(C, sun_y, R * 0.2, (255, 190, 130), 200, 22))
    img.alpha_composite(soft_disc(C, sun_y, R * 0.09, (255, 250, 235), 255, 3))

    layers = [(-0.06, .05, 1.2, 0.3, (190, 120, 140), .75),
              (-0.01, .045, 1.9, 2.0, (130, 95, 150), .85),
              (0.04, .04, 2.6, 3.7, (95, 75, 135), .95)]
    for off, amp, k, ph, col, a in layers:
        f = wave(off, amp, k, ph)
        pts = [(x, f(x)) for x in range(int(C - R) - 4, int(C + R) + 8, 4)]
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).polygon(pts + [(C + R + 8, S), (C - R - 8, S)], fill=255)
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        layer.paste(vertical_gradient([(0, col), (1, DEEP)], LEVEL - R * 0.1, LEVEL + R * 1.1, int(255 * a)), (0, 0), mask)
        img.alpha_composite(layer)
    front, front_pts = f, pts

    d = ImageDraw.Draw(img)
    d.line(front_pts, fill=(255, 230, 215, 190), width=5)   # foam
    draw_boat(img, front)
    d = ImageDraw.Draw(img)
    draw_gull(d, C - R * 0.28, C - R * 0.5, R * 0.085)
    draw_gull(d, C - R * 0.1, C - R * 0.62, R * 0.065)

    random.seed(9)                                           # glitter path under the sun
    for i in range(16):
        depth = (i / 15) ** 1.3
        y = front(C) + 14 + depth * R * 0.8
        for _ in range(2):
            x = C + random.uniform(-1, 1) * R * (0.05 + 0.3 * depth)
            ln = R * (0.02 + 0.05 * depth) * random.uniform(0.6, 1.2)
            d.line((x - ln, y, x + ln, y), fill=(255, 190, 130, int(230 * (1 - depth * 0.6))), width=int(3 + 3 * depth))

    img.alpha_composite(soft_disc(C - R * 0.35, C - R * 0.45, R * 0.6, (255, 255, 255), 22, 60))   # sheen
    return img


def main():
    img = background()
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse((C - R, C - R, C + R, C + R), fill=255)
    clipped = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    clipped.paste(orb(), (0, 0), mask)
    img.alpha_composite(clipped)
    ImageDraw.Draw(img).ellipse((C - R, C - R, C + R, C + R), outline=(255, 190, 150, 55), width=3)

    img = img.convert("RGB")
    for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print(f"icons/{name}")


if __name__ == "__main__":
    main()
