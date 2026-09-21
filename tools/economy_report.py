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

CATEGORIES = {"consumable", "projectile", "character", "scenery", "weather"}
SKIN_LISTS = {"character": "characters", "scenery": "sceneries", "weather": "weathers"}  # a skin item's id is the skin's id in this list of economy.json
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
        # A stack item (projectiles) has amount + unitPrice ranges instead of a fixed price.
        stack = "amount" in it or "unitPrice" in it
        ranged = "priceRange" in it
        for field in ("id", "name", "category") + (("amount", "unitPrice") if stack else (() if ranged else ("price",))):
            if field not in it:
                problems.append(f"item {it.get('id', '?')}: missing '{field}'")
        for rng in ("amount", "unitPrice"):
            r = it.get(rng)
            if r is not None and (not isinstance(r, dict) or "min" not in r or "max" not in r or r["min"] > r["max"] or r["min"] < 1):
                problems.append(f"item {it.get('id', '?')}: '{rng}' must be {{min, max}} with 1 <= min <= max")
        if it.get("category") not in SKIN_LISTS and "effect" not in it and "effects" not in it:  # (a skin has its effects in its own entry)
            problems.append(f"item {it.get('id', '?')}: needs 'effect' or 'effects'")
        if it.get("category") in SKIN_LISTS and it.get("id") not in [s.get("id") for s in eco.get(SKIN_LISTS[it["category"]], [])]:
            problems.append(f"item {it.get('id')}: no skin with this id in {SKIN_LISTS[it['category']]}")
        if it.get("id") in seen:
            problems.append(f"duplicate id '{it['id']}'")
        seen.add(it.get("id"))
        if it.get("category") not in CATEGORIES:
            problems.append(f"{it.get('id')}: unknown category '{it.get('category')}'")
        if it.get("category") == "consumable" and "duration" not in it and not it.get("charge"):
            problems.append(f"{it.get('id')}: consumable needs a 'duration' (or charge: true)")
    # Empty slots simply show (TBD), so a shop with few or no items is allowed.
    projectiles = eco.get("projectiles", {})
    if "snowball" not in projectiles:
        problems.append("projectiles: the 'snowball' (the default projectile) is missing")
    for pid, p in projectiles.items():
        tier_ids = [t["id"] for t in eco.get("weightTiers", [])]
        if p.get("weight") not in tier_ids:
            problems.append(f"projectile {pid}: weight '{p.get('weight')}' is not one of the weightTiers {tier_ids}")
        if hit_value(eco, p) is None:
            problems.append(f"projectile {pid}: no hit value (its rarity '{p.get('rarity')}' has no projectileHitValue)")
    for i in shop["items"]:
        if i.get("category") == "projectile" and i.get("id") in projectiles and "unitPrice" in i:
            hv = hit_value(eco, projectiles[i["id"]])
            if hv is not None and hv <= i["unitPrice"]["max"]:
                problems.append(f"{i['id']}: hit value {hv} is not above its highest price per piece {i['unitPrice']['max']} (a hit would lose coins)")
    for i in shop["items"]:
        if i.get("category") == "projectile" and i.get("id") not in projectiles:
            problems.append(f"{i['id']}: projectile has no entry in the top-level \"projectiles\" section")
    # Rarities: every projectile and shop item that names a rarity must name one that exists (none at all is allowed); chances must be positive.
    rarities = eco.get("rarities", [])
    ids = [r["id"] for r in rarities]
    for r in rarities:
        if r.get("chance", 0) < 0:
            problems.append(f"rarity '{r.get('id')}': chance can't be negative (0 = never in the shop)")
    for pid, pr in projectiles.items():
        if pr.get("rarity") is not None and pr.get("rarity") not in ids:  # none at all is allowed (common in the shop, last in the tabs)
            problems.append(f"projectile {pid}: rarity '{pr.get('rarity')}' is not in rarities")
    for it in shop["items"]:
        if it.get("category") != "projectile" and it.get("rarity") is not None and it.get("rarity") not in ids:
            problems.append(f"item {it.get('id')}: rarity '{it.get('rarity')}' is not in rarities")
    # A skin's shop rarity must be its own rarity, and every effect it carries is one the game reads.
    for kind, key in SKIN_LISTS.items():
        for sk in eco.get(key, []):
            for e in sk.get("effects", []):
                if e.get("type") not in ("shopSpeed", "offsetCenter", "coinMultiplier"):
                    problems.append(f"{key} {sk.get('id')}: unknown effect '{e.get('type')}'")
            sold = [i for i in shop["items"] if i.get("category") == kind and i.get("id") == sk.get("id")]
            if sold and sold[0].get("rarity") != sk.get("rarity"):
                problems.append(f"{key} {sk.get('id')}: its rarity ({sk.get('rarity')}) differs from its shop item's ({sold[0].get('rarity')})")
    return problems


def slot_odds(eco):
    """Chance that a shop slot is put on sale with each item: pick a rarity by its chance (only rarities that have a
    shop item take part, rescaled to 100%), then an item of that rarity at random."""
    rarities = eco.get("rarities", [])
    items = eco["shop"]["items"]

    sellable = [r["id"] for r in rarities if r["chance"] > 0]

    def rarity_of(it):
        r = eco["projectiles"][it["id"]].get("rarity") if it["category"] == "projectile" else it.get("rarity")
        # like the shop: an item with no (or an unsellable) rarity is picked as the first sellable one (common)
        return r if r in sellable else (sellable[0] if sellable else None)

    present = [r for r in rarities if r["chance"] > 0 and any(rarity_of(i) == r["id"] for i in items)]
    total = sum(r["chance"] for r in present) or 1
    odds = {}
    for r in present:
        same = [i for i in items if rarity_of(i) == r["id"]]
        for i in same:
            odds[i["id"]] = (r["chance"] / total) / len(same)
    return odds


def event_rarity(eco, name):
    """The rarity of an event = the rarity of its summon buff (the shop item whose triggerEvent effect names it); failing that the event's own
    "rarity" in economy.json events.<block> (the guitar); failing that legendary."""
    for it in eco["shop"]["items"]:
        for e in it.get("effects", []):
            if e.get("type") == "triggerEvent" and e.get("value") == name:
                return it.get("rarity")
    block = {"face": "faceWindow", "disco": "discoWindow", "guitar": "guitarWindow"}.get(name)
    return eco.get("events", {}).get(block, {}).get("rarity", "legendary")


def event_chances(eco):
    """Per rarity that has shop items: (share of the shop's rarity roll, minutes to see one in the shop, chance per throw of a natural event,
    throws on average). The same rule as main.js eventRarityChance."""
    has = set()
    for it in eco["shop"]["items"]:
        has.add(eco["projectiles"].get(it["id"], {}).get("rarity") if it["category"] == "projectile" else it.get("rarity"))
    rar = [r for r in eco["rarities"] if r.get("chance", 0) > 0 and r["id"] in has]
    total = sum(r["chance"] for r in rar)
    tph = eco.get("events", {}).get("throwsPerHour") or 3600 / eco["projectiles"]["snowball"]["regen"]["everySeconds"]
    out = {}
    for r in rar:
        share = r["chance"] / total
        rolls_per_hour = eco["shop"]["slots"] * 3600 / r.get("availabilitySeconds", 1800)
        hours = 1 / (share * rolls_per_hour)
        out[r["id"]] = (share, hours * 60, 1 / (hours * tph), hours * tph)
    return out


def hit_value(eco, p):
    """One hit's base coins: the projectile's own hitValue, else its rarity's projectileHitValue."""
    if isinstance(p.get("hitValue"), (int, float)):
        return p["hitValue"]
    for r in eco.get("rarities", []):
        if r["id"] == p.get("rarity") and "projectileHitValue" in r:
            return r["projectileHitValue"]
    return None


def main():
    eco = load()
    eco["shop"]["items"] = [i for i in eco["shop"]["items"] if not i.get("godOnly")]  # a test buff is never sold
    print("Base coins per hit (both goal windows), by projectile:")
    for pid, p in eco["projectiles"].items():
        print(f"  {pid:<12} {hit_value(eco, p)}  ({p.get('rarity')}, weight {p.get('weight')})")
    avg_hit = hit_value(eco, eco["projectiles"]["snowball"])
    print(f"\nPrices below are in snowball hits (average {avg_hit:.2f} coins per hit).\n")

    header = f"{'item':<18}{'cat':<11}{'price':>6}{'hits':>7}" + "".join(
        f"{'@' + str(int(a * 100)) + '%':>8}" for a in ACCURACY
    )
    print(header + "   (throws needed to afford it, from zero)")
    print("-" * len(header))
    def avg_price(i):
        if "priceRange" in i:  # a single item with a rolled price: the middle of the range
            return (i["priceRange"]["min"] + i["priceRange"]["max"]) / 2
        if "amount" in i:  # a stack: average amount x average price of one
            return (i["amount"]["min"] + i["amount"]["max"]) / 2 * (i["unitPrice"]["min"] + i["unitPrice"]["max"]) / 2
        return i["price"]

    for it in sorted(eco["shop"]["items"], key=avg_price):
        price = avg_price(it)
        hits = price / avg_hit
        row = f"{it['name']:<18}{it['category']:<11}{price:>6.0f}{hits:>7.1f}"
        row += "".join(f"{hits / a:>8.0f}" for a in ACCURACY)
        print(row)


    print("\nChance that a shop slot shows each item (rarity roll, then a random item of that rarity):")
    for iid, pr in sorted(slot_odds(eco).items(), key=lambda kv: -kv[1]):
        print(f"  {iid:<12}{pr * 100:5.1f}%")

    print("\nNatural events by rarity (an event has the rarity of its summon buff; one roll per RARITY after every throw):")
    events = {}
    for name in ("face", "disco", "guitar"):
        events.setdefault(event_rarity(eco, name), []).append(name)
    tph = eco.get("events", {}).get("throwsPerHour") or 3600 / eco["projectiles"]["snowball"]["regen"]["everySeconds"]
    print(f"  (throws an hour: {tph:.0f} = the snowball's real refill rate; if several rarities hit on one throw the rarer one wins,")
    print("   so a rarity's effective chance is its chance x (1 - the chance of every better rarity))")
    print(f"  {'rarity':<10}{'shop share':>11}{'shop wait':>12}{'chance/throw':>14}{'1 in':>7}{'effective':>11}{'1 in':>7}  events")
    ch = event_chances(eco)
    order = [r["id"] for r in eco["rarities"]]
    ids = sorted(ch, key=order.index)
    for i, rid in enumerate(ids):
        share, mins, chance, throws = ch[rid]
        better = 1.0
        for hid in ids[i + 1:]:
            better *= 1 - ch[hid][2]
        eff = chance * better
        wait = f"{mins / 60:.1f} h" if mins >= 120 else f"{mins:.1f} min"
        print(f"  {rid:<10}{share * 100:>10.0f}%{wait:>12}{chance * 100:>13.3f}%{throws:>7.0f}{eff * 100:>10.3f}%{1 / eff:>7.0f}  {', '.join(events.get(rid, [])) or '-'}")

    problems = check(eco)
    print("\nChecks:", "all good" if not problems else "")
    for p in problems:
        print("  PROBLEM:", p)


if __name__ == "__main__":
    main()
