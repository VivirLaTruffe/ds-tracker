"""Draws the app icons (calendar page with a check mark) with Pillow.

Run from the project root: python3 tools/make_icons.py
"""
from PIL import Image, ImageDraw

ACCENT = (79, 70, 229)
PAGE = (255, 255, 255)
RING = (40, 34, 150)
OK = (26, 127, 75)


def icon(size, maskable=False):
    image = Image.new("RGBA", (size, size), ACCENT + (255,))
    d = ImageDraw.Draw(image)
    # Maskable icons get cropped to a circle by some launchers: keep the drawing in the
    # central 80 % "safe zone".
    m = size * (0.2 if maskable else 0.14)
    if not maskable:
        image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(image)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=ACCENT + (255,))
    page = [m, m + size * 0.08, size - m, size - m]
    d.rounded_rectangle(page, radius=size * 0.07, fill=PAGE + (255,))
    # Calendar header band and binder rings.
    d.rounded_rectangle([page[0], page[1], page[2], page[1] + size * 0.17], radius=size * 0.07, fill=(224, 222, 255, 255))
    d.rectangle([page[0], page[1] + size * 0.1, page[2], page[1] + size * 0.17], fill=(224, 222, 255, 255))
    for x in (0.36, 0.64):
        cx = size * x
        d.rounded_rectangle([cx - size * 0.025, page[1] - size * 0.06, cx + size * 0.025, page[1] + size * 0.07],
                            radius=size * 0.02, fill=RING + (255,))
    # Check mark.
    w = max(2, int(size * 0.07))
    pts = [(size * 0.33, size * 0.6), (size * 0.45, size * 0.72), (size * 0.69, size * 0.46)]
    d.line(pts, fill=OK + (255,), width=w, joint="curve")
    return image


icon(192).save("icons/icon-192.png")
icon(512).save("icons/icon-512.png")
icon(512, maskable=True).save("icons/icon-maskable-512.png")
icon(180, maskable=True).convert("RGB").save("icons/apple-touch-icon.png")
print("icons written")
