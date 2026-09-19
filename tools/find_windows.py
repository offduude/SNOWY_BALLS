"""Prints the boxes of all 40 windows of the building in IMAGE pixels (x from, x to, y from, y to - inclusive), read from the
red rectangles of docs/background_annotated.png (the labelled reference of assets/building/background.png). The list is
pasted into WALL_WINDOWS in src/main.js - the projectiles that react to ANY window (the stone's hard_impact) use it.
Run: py tools/find_windows.py   (needs Pillow)"""
from PIL import Image

im = Image.open("docs/background_annotated.png").convert("RGB")
W, H = im.size
px = im.load()


def red(x, y):
    r, g, b = px[x, y]
    return r > 200 and g < 70 and b < 70


seen = set()
boxes = []
for y in range(H):
    for x in range(W):
        if (x, y) in seen or not red(x, y):
            continue
        stack = [(x, y)]
        seen.add((x, y))
        x0 = x1 = x
        y0 = y1 = y
        while stack:
            cx, cy = stack.pop()
            x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (cx + dx, cy + dy)
                    if 0 <= n[0] < W and 0 <= n[1] < H and n not in seen and red(*n):
                        seen.add(n)
                        stack.append(n)
        if x1 - x0 >= 8 and y1 - y0 >= 8:  # a window outline, not a stray red pixel or a label
            boxes.append((x0, x1, y0, y1))

boxes.sort(key=lambda b: (b[2], b[0]))
print(f"// {len(boxes)} windows")
print("const WALL_WINDOWS = [")
for i in range(0, len(boxes), 4):
    print("  " + " ".join(f"[{a}, {b}, {c}, {d}]," for a, b, c, d in boxes[i:i + 4]))
print("];")
