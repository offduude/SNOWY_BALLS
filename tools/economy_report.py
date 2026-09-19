"""Balance sanity table for economy.json.  Run:  py tools/economy_report.py

For each shop item: price, how many hits that is, and roughly how many throws at a few
accuracy levels. Also checks the file for mistakes (missing fields, duplicate ids, unknown
categories) so a typo is caught before you reload the game.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "..", "economy.json")

CATEGORIES = {"consumable", "projectile"}
ACCURACY = [0.15, 0.30, 0.50]  # share of throws that hit a goal window


def load():
    try:
        with open(PATH, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.exit(f"economy.json has a syntax error: {e}")


def check(eco):
    problems = []
    shop = eco["shop"]
    seen = set()
    for it in shop["items"]:
        for field in ("id", "name", "category", "price"):
            if field not in it:
                problems.append(f"item {it.get('id', '?')}: missing '{field}'")
        if "effect" not in it and "effects" not in it:
            problems.append(f"item {it.get('id', '?')}: needs 'effect' or 'effects'")
        if it.get("id") in seen:
            problems.append(f"duplicate id '{it['id']}'")
        seen.add(it.get("id"))
        if it.get("category") not in CATEGORIES:
            problems.append(f"{it.get('id')}: unknown category '{it.get('category')}'")
        if it.get("category") == "consumable" and "duration" not in it:
            problems.append(f"{it.get('id')}: consumable needs a 'duration'")
    # Empty slots simply show (TBD), so a shop with few or no items is allowed.
    projectiles = eco.get("projectiles", {})
    for pid, p in projectiles.items():
        if not p.get("weight"):
            problems.append(f"projectile {pid}: missing 'weight'")
    for i in shop["items"]:
        if i.get("category") == "projectile" and i.get("id") not in projectiles:
            problems.append(f"{i['id']}: projectile has no entry in the top-level \"projectiles\" section")
    return problems


def main():
    eco = load()
    windows = eco["rewards"]["windows"]
    avg_hit = sum(windows.values()) / len(windows)
    print(f"Average base coins per hit: {avg_hit:.2f}  (windows: {windows}; streak bonus not counted)\n")

    header = f"{'item':<18}{'cat':<11}{'price':>6}{'hits':>7}" + "".join(
        f"{'@' + str(int(a * 100)) + '%':>8}" for a in ACCURACY
    )
    print(header + "   (throws needed to afford it, from zero)")
    print("-" * len(header))
    for it in sorted(eco["shop"]["items"], key=lambda i: i["price"]):
        hits = it["price"] / avg_hit
        row = f"{it['name']:<18}{it['category']:<11}{it['price']:>6}{hits:>7.1f}"
        row += "".join(f"{hits / a:>8.0f}" for a in ACCURACY)
        print(row)


    problems = check(eco)
    print("\nChecks:", "all good" if not problems else "")
    for p in problems:
        print("  PROBLEM:", p)


if __name__ == "__main__":
    main()
