"""One-off: sets every shop item's price per piece so the AVERAGE price of a stack equals its tier's target, keeping each item's
stack size and its own min / max spread, rounds all per-piece prices DOWN, and sets each projectile's hit value to its highest
per-piece price + 1. Run: py tools/reprice.py   (edits economy.json in place)"""
import json
import math
import re
from fractions import Fraction as F

TARGET = {
    "projectile": {"common": 50, "rare": 250, "epic": 1250},
    "consumable": {"common": 25, "rare": 125, "epic": 625, "legendary": 3125},
}

text = open("economy.json", encoding="utf-8").read()
eco = json.loads(text)
projectiles = eco["projectiles"]

def rarity_of(it):
    return projectiles[it["id"]].get("rarity") if it["category"] == "projectile" else it.get("rarity")

def new_range(lo, hi, per_piece_avg):
    """Same spread as the old range (min / avg and max / avg), around the new average, both rounded down."""
    avg_old = F(lo + hi, 2)
    return math.floor(per_piece_avg * F(lo) / avg_old), math.floor(per_piece_avg * F(hi) / avg_old)

def patch(text, item_id, key, lo, hi):
    start = text.index(f'"id": "{item_id}"')
    m = re.compile(rf'"{key}": {{ "min": \d+, "max": \d+ }}').search(text, start)
    assert m, (item_id, key)
    return text[:m.start()] + f'"{key}": {{ "min": {lo}, "max": {hi} }}' + text[m.end():]

highest = {}
for it in eco["shop"]["items"]:
    target = F(TARGET[it["category"]][rarity_of(it)])
    if it["category"] == "projectile":
        a = F(it["amount"]["min"] + it["amount"]["max"], 2)
        lo, hi = new_range(it["unitPrice"]["min"], it["unitPrice"]["max"], target / a)  # per piece: average stack = target
        text = patch(text, it["id"], "unitPrice", lo, hi)
        highest[it["id"]] = hi
    else:
        lo, hi = new_range(it["priceRange"]["min"], it["priceRange"]["max"], target)
        text = patch(text, it["id"], "priceRange", lo, hi)

# hit value = highest per-piece price + 1 (W21 keeps the old W21 : W20 ratio, only the chestnut had a lower one)
for pid, hi in highest.items():
    old = projectiles[pid]["rewards"]
    w20 = hi + 1
    w21 = w20 if old["W21"] == old["W20"] else math.floor(w20 * old["W21"] / old["W20"])
    text = re.sub(rf'("{pid}": {{[^\n]*?"rewards": {{ "W20": )\d+(, "W21": )\d+( }})', rf"\g<1>{w20}\g<2>{w21}\g<3>", text, count=1)

open("economy.json", "w", encoding="utf-8").write(text)
json.loads(text)
print("ok")
