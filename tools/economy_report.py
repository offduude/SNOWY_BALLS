"""Balance sanity table for economy.json.  Run:  py tools/economy_report.py

For each shop item: price, how many hits that is, and roughly how many throws at a few
accuracy levels. Also checks the file for mistakes (missing fields, duplicate ids, unknown
categories/tiers) so a typo is caught before you reload the game.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "..", "economy.json")

CATEGORIES = {"accessory", "buff", "projectile"}
KINDS = {"permanent", "consumable"}
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
    tiers = set(shop["tierUnlocks"])
    seen = set()
    for it in shop["items"]:
        for field in ("id", "name", "category", "tier", "price", "kind", "effect"):
            if field not in it:
                problems.append(f"item {it.get('id', '?')}: missing '{field}'")
        if it.get("id") in seen:
            problems.append(f"duplicate id '{it['id']}'")
        seen.add(it.get("id"))
        if it.get("category") not in CATEGORIES:
            problems.append(f"{it.get('id')}: unknown category '{it.get('category')}'")
        if it.get("kind") not in KINDS:
            problems.append(f"{it.get('id')}: unknown kind '{it.get('kind')}'")
        if str(it.get("tier")) not in tiers:
            problems.append(f"{it.get('id')}: tier {it.get('tier')} has no entry in tierUnlocks")
        if it.get("kind") == "consumable" and "duration" not in it:
            problems.append(f"{it.get('id')}: consumable needs a 'duration'")
    # Day one only the tiers unlocked at 0 coins can appear, and permanent items leave the pool once
    # bought - so that starting pool must comfortably outnumber the slots or the shop shows gaps.
    starter = [i for i in shop["items"] if shop["tierUnlocks"].get(str(i["tier"])) == 0]
    if len(starter) < shop["slots"] + 2:
        problems.append(
            f"only {len(starter)} items are available from the start but the shop has {shop['slots']} slots "
            f"- want at least {shop['slots'] + 2} so buying a few permanent items doesn't leave empty slots"
        )
    if len(shop["items"]) < shop["slots"] * 2:
        problems.append(f"only {len(shop['items'])} items for {shop['slots']} slots - the shop will run dry fast")
    return problems


def main():
    eco = load()
    windows = eco["rewards"]["windows"]
    avg_hit = sum(windows.values()) / len(windows)
    print(f"Average base coins per hit: {avg_hit:.2f}  (windows: {windows}; streak bonus not counted)\n")

    header = f"{'item':<18}{'cat':<11}{'tier':<5}{'price':>6}{'hits':>7}" + "".join(
        f"{'@' + str(int(a * 100)) + '%':>8}" for a in ACCURACY
    )
    print(header + "   (throws needed to afford it, from zero)")
    print("-" * len(header))
    for it in sorted(eco["shop"]["items"], key=lambda i: (i["tier"], i["price"])):
        hits = it["price"] / avg_hit
        row = f"{it['name']:<18}{it['category']:<11}{it['tier']:<5}{it['price']:>6}{hits:>7.1f}"
        row += "".join(f"{hits / a:>8.0f}" for a in ACCURACY)
        print(row)

    print("\nTier unlocks (lifetime coins earned before the tier can appear in the shop):")
    for tier, need in sorted(eco["shop"]["tierUnlocks"].items()):
        n = sum(1 for i in eco["shop"]["items"] if str(i["tier"]) == tier)
        cheapest = min((i["price"] for i in eco["shop"]["items"] if str(i["tier"]) == tier), default=None)
        print(f"  tier {tier}: unlocks at {need} coins, {n} items, cheapest {cheapest}")

    problems = check(eco)
    print("\nChecks:", "all good" if not problems else "")
    for p in problems:
        print("  PROBLEM:", p)


if __name__ == "__main__":
    main()
