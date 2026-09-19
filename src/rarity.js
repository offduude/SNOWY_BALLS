// Rarities: shared by projectiles and buffs. The list (name, colour, chance) lives in economy.json under "rarities",
// from the most common to the rarest; every projectile (projectiles.<id>.rarity) and every shop item (item.rarity) names one.
//
// - A shop slot first rolls a RARITY by its chance (only rarities that have an item to sell take part; the chances of
//   those are used as they are and rescaled to 100%), then picks one of that rarity's items at random (see shop.js).
// - The PROJECTILES and BUFFS tabs list the rarest first (Rarity.rank).
// - A label is plain coloured text (no background); "rainbow" is a colour that keeps changing in waves and shines
//   (see .rarity-rainbow in index.html).
const Rarity = (() => {
  let list = [];
  let eco = null;

  return {
    init(economyJson) {
      eco = economyJson;
      list = Array.isArray(economyJson.rarities) ? economyJson.rarities : [];
    },

    // The rarity id of a shop item: a projectile's lives with the projectile's numbers (projectiles.<id>.rarity, one
    // place for the shop and the tab), a buff's on the item itself.
    ofItem(item) {
      if (item.category === "projectile") {
        const p = eco && eco.projectiles && eco.projectiles[item.id];
        return p ? p.rarity : undefined;
      }
      return item.rarity;
    },

    all: () => list,

    info(id) {
      return list.find((r) => r.id === id) || null;
    },

    // Position in the list (0 = the lowest tier, "default"; higher = rarer). -1 for an item with no (or an unknown)
    // rarity: the lists sort by this, rarest first, so such an item ends up after EVERY rarity, "default" and "common"
    // included, however many of those there are.
    rank(id) {
      return list.findIndex((r) => r.id === id);
    },

    // The label as HTML, or "" if the item has no rarity. `cls` is the caller's own class (position and size).
    labelHtml(id, cls, uppercase) {
      const r = list.find((x) => x.id === id);
      if (!r) return "";
      const text = uppercase ? r.label.toUpperCase() : r.label;
      return r.color === "rainbow"
        ? `<span class="${cls} rarity-rainbow">${text}</span>`
        : `<span class="${cls}" style="color:${r.color}">${text}</span>`;
    },
  };
})();
