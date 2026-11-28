# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Génère les icônes PNG de Respire : le hublot-souffle. Un hublot de verre
coupé par une seule vague, qui est aussi la courbe d'une respiration. Ciel
violet qui s'éclaire en pêche à l'horizon, trois étoiles, un soleil qui se
couche dans le creux de la vague, mer turquoise, bord irisé, halo violet et
cyan, fond nuit.

    uv run tools/make_icons.py

Écrit icons/icon-512.png, icons/icon-192.png et icons/apple-touch-icon.png.
Le favicon (icons/icon.svg) dessine le même logo en SVG : si tu changes une
forme ou une couleur ici, change-la aussi là-bas.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 2048                 # working size: large, so curves stay smooth once downscaled
U = S / 100              # the design is drawn on a 100 × 100 grid, like icon.svg

BG = [(0, (28, 29, 87)), (1, (9, 10, 34))]                              # #1c1d57 → #090a22
SKY = [(0, (122, 104, 255)), (0.6, (214, 154, 216)), (1, (255, 198, 162))]   # violet → pink → peach
SEA = [(0, (79, 230, 230)), (0.45, (22, 153, 196)), (1, (10, 60, 120))]      # light turquoise → deep blue
HALOS = [((155, 123, 255), 45), ((95, 224, 255), 56)]                   # violet above, cyan below (colour, centre y)
SUN = (63, 55)                                                          # centre, in the trough of the wave
SUN_GLOW = [(0, (255, 242, 220), 0.85), (0.35, (255, 199, 154), 0.45), (1, (255, 159, 176), 0)]
GLINT = (35, 46.6)                                                      # light on the crest of the wave
RIM = [(0, (143, 243, 255)), (0.5, (173, 141, 255)), (1, (255, 159, 210))]   # cyan → violet → pink
STARS = [(37, 31, 3.2, 2.2, 0.95), (58, 28.6, 2, 1.4, 0.8), (47, 37.6, 1.4, 1, 0.65)]   # x, y, half-height, half-width, alpha

CX, CY, R = 50, 50, 29                     # the porthole
# The wave, as two cubic Béziers (start, control, control, end, control, control, end).
# It runs past the porthole's edge on both sides and is clipped by it.
WAVE = [(18, 53.5), (30, 44.5), (40, 44), (50, 53), (60, 62), (70, 62.5), (82, 53.5)]


def px(p):
    return (p[0] * U, p[1] * U)


def lerp(a, b, k):
    return tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(len(a)))


def gradient(stops, y0, y1):
    """Full-size vertical gradient through `stops`, from y0 to y1 (grid units)."""
    img = Image.new("RGBA", (S, S))
    d = ImageDraw.Draw(img)
    for y in range(S):
        k = min(1, max(0, (y / U - y0) / (y1 - y0)))
        for (k0, c0), (k1, c1) in zip(stops, stops[1:]):
            if k0 <= k <= k1:
                d.line((0, y, S, y), fill=lerp(c0, c1, (k - k0) / (k1 - k0)) + (255,))
                break
    return img


def radial_alpha(cx, cy, r, peak, flat=0.55, steps=240):
    """Alpha mask: `peak` up to `flat` of the radius, then fading to nothing."""
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    for i in range(steps, 0, -1):                            # concentric discs, outside in
        k = i / steps
        a = peak if k < flat else peak * (1 - k) / (1 - flat)
        d.ellipse(((cx - r * k) * U, (cy - r * k) * U, (cx + r * k) * U, (cy + r * k) * U), fill=round(a))
    return mask


def radial(cx, cy, r, stops, steps=240):
    """Colour and alpha both varying with the distance: stops are (k, colour, alpha 0..1)."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(steps, -1, -1):                           # concentric discs, outside in
        k = i / steps
        for (k0, c0, a0), (k1, c1, a1) in zip(stops, stops[1:]):
            if k0 <= k <= k1:
                e = (k - k0) / (k1 - k0)
                col = lerp(c0, c1, e) + (round(255 * (a0 + (a1 - a0) * e)),)
                break
        rr = max(r * k, 0.5 / U)
        d.ellipse(((cx - rr) * U, (cy - rr) * U, (cx + rr) * U, (cy + rr) * U), fill=col)
    return img


def diagonal(stops, a, b):
    """Gradient along the line from point a to point b (grid units), flat beyond."""
    small = Image.new("RGB", (101, 101))
    dx, dy = b[0] - a[0], b[1] - a[1]
    for y in range(101):
        for x in range(101):
            k = min(1, max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
            for (k0, c0), (k1, c1) in zip(stops, stops[1:]):
                if k0 <= k <= k1:
                    small.putpixel((x, y), lerp(c0, c1, (k - k0) / (k1 - k0)))
                    break
    return small.resize((S, S), Image.BILINEAR)


def star(x, y, h, w, alpha):
    """Four-pointed sparkle with curved sides, as an alpha mask."""
    tips = [(x, y - h), (x + w, y), (x, y + h), (x - w, y)]
    pts = []
    for i in range(4):
        p0, p1 = tips[i], tips[(i + 1) % 4]
        for j in range(20):                                  # quadratic curve pulled to the centre
            t = j / 20
            pts.append(px(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * x + t * t * p1[0],
                           (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * y + t * t * p1[1])))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=round(alpha * 255))
    return mask


def coloured(col, mask):
    layer = Image.new("RGBA", (S, S), col + (0,))
    layer.putalpha(mask)
    return layer


def bezier_chain(pts, n=400):
    """Points along consecutive cubic Béziers."""
    out = [pts[0]]
    for i in range(0, len(pts) - 1, 3):
        p0, c1, c2, p1 = pts[i:i + 4]
        for j in range(1, n + 1):
            t = j / n
            a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
            out.append((a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
                        a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]))
    return out


def stroke(points, width, alpha=255):
    """Line as an alpha mask, drawn as overlapping discs: perfectly smooth
    edges, where a thick polyline would show small notches at its joints."""
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    r = width * U / 2
    for x, y in (px(p) for p in points):
        d.ellipse((x - r, y - r, x + r, y + r), fill=alpha)
    return mask


def porthole():
    """Everything inside the glass: sky, stars, sun, sea, sheen, and the wave."""
    img = gradient(SKY, 21, 56)
    for x, y, h, w, a in STARS:
        img.alpha_composite(coloured((255, 255, 255), star(x, y, h, w, a)))
    img.alpha_composite(radial(*SUN, 15, SUN_GLOW))                  # the sun setting in the trough
    img.alpha_composite(radial(*SUN, 5, [(0, (255, 255, 255), 1), (1, (255, 220, 176), 1)]))
    curve = bezier_chain(WAVE)
    sea = Image.new("L", (S, S), 0)
    ImageDraw.Draw(sea).polygon([px(p) for p in curve] + [px((82, 82)), px((18, 82))], fill=255)
    img.paste(gradient(SEA, 45, 79), (0, 0), sea)

    img.alpha_composite(coloured((255, 255, 255), radial_alpha(40, 35, 22, 0.22 * 255, flat=0)))   # glass sheen

    glow = stroke(curve, 5, round(0.55 * 255)).filter(ImageFilter.GaussianBlur(1.6 * U))
    img.alpha_composite(coloured((255, 255, 255), glow))
    img.alpha_composite(coloured((255, 255, 255), stroke(curve, 2.8)))
    img.alpha_composite(coloured((255, 255, 255), radial_alpha(*GLINT, 5, 0.9 * 255, flat=0)))   # light on the crest

    clip = Image.new("L", (S, S), 0)
    ImageDraw.Draw(clip).ellipse(((CX - R) * U, (CY - R) * U, (CX + R) * U, (CY + R) * U), fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), clip)
    return out


def ring(width):
    mask = Image.new("L", (S, S), 0)
    w = width * U
    ImageDraw.Draw(mask).ellipse(
        ((CX - R) * U - w / 2, (CY - R) * U - w / 2, (CX + R) * U + w / 2, (CY + R) * U + w / 2),
        outline=255, width=round(w),
    )
    return mask


def rim():
    """Iridescent edge of the glass (cyan, violet, pink), with a soft glow."""
    colours = diagonal(RIM, (25, 25), (75, 75)).convert("RGBA")
    glow = ring(3).filter(ImageFilter.GaussianBlur(1.2 * U)).point(lambda v: round(v * 0.6))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for mask in (glow, ring(1.3)):
        layer = colours.copy()
        layer.putalpha(mask)
        out.alpha_composite(layer)
    return out


def main():
    img = gradient(BG, 0, 100)
    for col, cy in HALOS:
        img.alpha_composite(coloured(col, radial_alpha(50, cy, 42, 0.26 * 255)))
    img.alpha_composite(porthole())
    img.alpha_composite(rim())

    # Full-bleed square: iOS and Android cut the corners themselves. The
    # porthole stays inside the central safe zone of maskable icons.
    img = img.convert("RGB")
    for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print(f"icons/{name}")


if __name__ == "__main__":
    main()
