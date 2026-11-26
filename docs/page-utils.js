import { escapeHtml as esc } from "./presentation.js";
import { unitPack, unitFormula } from "./unit-catalog.js";

export function createFormatting(snapshot) {
  const num = (value, digits = 1) =>
    value == null
      ? "Unknown"
      : Number(value).toLocaleString(snapshot?.config.locale || "en-IN", {
          maximumFractionDigits: digits,
        });
  const money = (value) =>
    value == null
      ? '<span class="unknown">Unknown</span>'
      : new Intl.NumberFormat(snapshot?.config.locale || "en-IN", {
          style: "currency",
          currency: snapshot?.config.currency || "INR",
          maximumFractionDigits: 2,
        }).format(value);
  const size = (offer) =>
    offer.isUnitOffer
      ? unitPack(offer)
      : offer.category === "creatine"
        ? `${num(offer.grams)} g`
        : `${num(offer.kg)} kg`;
  return { num, money, size };
}

export function catalogFormula(snapshot, offers) {
  const { money, num, size } = createFormatting(snapshot);
  if (offers[0]?.isUnitOffer)
    return unitFormula(snapshot.categories[offers[0].category], offers, {
      money,
      num,
    });
  const offer =
    offers.find((row) => row.rankingEligible) ||
    offers.find((row) => row.cost != null);
  if (!offer)
    return "<p>No offer currently has the inputs required for a calculation.</p>";
  const category = snapshot.categories[offer.category];
  return `<p class="calculation"><strong>Dataset example: ${esc(offer.brand)} · ${esc(offer.product)} · ${esc(offer.flavour)} · ${size(offer)}</strong><br>${money(offer.price)} ÷ (${num(offer.grams)} g × ${num(offer[category.concentrationField], 2)}% ÷ 100) = <strong>${money(offer.cost)} / g ${esc(category.compoundLabel)}</strong>. A ${num(category.referenceGrams)} g comparison portion costs ${money(offer.referenceCost)}.</p>`;
}
