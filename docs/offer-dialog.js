import { escapeHtml as esc, formatDate } from "./presentation.js";
import { createFormatting } from "./page-utils.js";
import { guideHref } from "./routes.js";
import { buyingOffer } from "./guidance.js";
import { testingDetailsMarkup } from "./testing-evidence.js";
import { primarySourceLabel, retailerQuotesMarkup } from "./retailer-quotes.js";
import { productReviewMarkup } from "./product-review.js";
import { unitDetails, otherIngredientsMarkup } from "./unit-catalog.js";

export function createOfferDialog({ loadSnapshot }) {
  const $ = (selector) => document.querySelector(selector);
  let snapshot,
    selected = null,
    request = 0;
  let num, money, size;
  function link(url, label) {
    try {
      const u = new URL(url);
      if (u.protocol === "https:")
        return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
    } catch {}
    return "Not recorded";
  }
  function historyChart(history) {
    const known = history.filter((h) => h.verified),
      width = 1000,
      height = 200,
      pad = 55,
      span = history.length - 1;
    if (!known.length)
      return "<p>No verified price snapshots are available for this variant.</p>";
    const min = Math.min(...known.map((h) => h.price)),
      max = Math.max(...known.map((h) => h.price)),
      range = max - min || 1;
    const x = (i) => pad + (i / span) * (width - pad * 2);
    const y = (p) => (max === min ? 85 : 45 + ((max - p) / range) * 75);
    const color = (h) =>
      h.qoqDirection === "up"
        ? "#dc2626"
        : h.qoqDirection === "down"
          ? "#059669"
          : h.qoqDirection === "stable"
            ? "#2563eb"
            : "#64748b";
    return `<div class="history-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Verified dated price snapshots. Missing quarters have gaps and are not interpolated.">${history.map((h, i) => `${i > 0 && h.verified && history[i - 1].verified ? `<line x1="${x(i - 1)}" y1="${y(history[i - 1].price)}" x2="${x(i)}" y2="${y(h.price)}" stroke="${color(h)}" stroke-width="2.5" stroke-linecap="round"/>` : ""}${h.verified ? `<circle cx="${x(i)}" cy="${y(h.price)}" r="5.5" fill="${color(h)}" stroke="var(--bg-card)" stroke-width="2"><title>${esc(h.quarter + " · " + (h.date ? formatDate(h.date) : "") + " · ")}${money(h.price)}</title></circle><text x="${x(i)}" y="${y(h.price) - 12}" text-anchor="middle" class="chart-price-label">${money(h.price)}</text>` : `<text x="${x(i)}" y="89" text-anchor="middle" class="chart-missing-label">?</text>`}<text x="${x(i)}" y="162" text-anchor="middle" class="chart-quarter-label">${esc(h.isCurrent ? "Current" : h.quarter.slice(0, 2))}</text><text x="${x(i)}" y="179" text-anchor="middle" class="chart-quarter-label">${esc(h.isCurrent ? "observed" : h.quarter.slice(3))}</text>`).join("")}</svg></div>`;
  }
  function renderHistory(r, c) {
    const t = r.trend;
    return `<section class="offer-history"><h3>${t.historyWindowQuarters} completed quarters · ${esc(c.historyWindow[0].label)}–${esc(c.previousQuarter.label)}</h3><p>Current price observed ${formatDate(r.priceAudit.checked)}. ${t.endpointChangePct != null ? `Change from ${esc(t.endpointQuarter)} snapshot to current: <strong>${t.endpointChangePct > 0 ? "+" : ""}${num(t.endpointChangePct, 2)}%</strong>. This endpoint comparison does not imply complete intervening history.` : "No verified current-to-oldest-quarter endpoint comparison is available."}</p>${historyChart(t.history)}</section>`;
  }
  function renderOffer() {
    if (!selected) return;
    const c = snapshot.categories[selected.category],
      r = c?.offers.find((r) => String(r.id) === selected.id);
    if (!r) {
      $("#evidence-body").innerHTML =
        "<p>This offer was removed from the latest dataset.</p>";
      return;
    }
    const variants = c.offers.filter(
        (v) => v.brand === r.brand && v.product === r.product,
      ),
      concentration = r[c.concentrationField];
    if (c.measurement === "units") {
      $("#evidence-title").textContent = `${r.brand} · ${r.product}`;
      $("#evidence-body").innerHTML =
        `<div class="detail-education"><strong>Understand the ingredient before choosing the pack.</strong><a href="${esc(guideHref(c.id))}">Read ${esc(c.label)} benefits, limitations &amp; safety →</a></div>` +
        buyingOffer(snapshot, c) +
        unitDetails(c, r, variants, {
          money,
          num,
          link,
          history: renderHistory(r, c),
          maxAgeDays: snapshot.config.maxPriceAgeDays,
        });
      $("#offer-variant").addEventListener("change", (e) => {
        selected.id = e.target.value;
        renderOffer();
      });
      return;
    }
    $("#evidence-title").textContent = `${r.brand} · ${r.product}`;
    const fields = [
      ["Chemical form / source", r.type],
      ["Subclass", r.subclass],
      ["Ingredient trademark", r.grade],
      ["Formulation", r.formulation],
      ["Net pack weight", `${num(r.grams)} g`],
      ["Pack price", money(r.price)],
      [
        "Labelled concentration",
        concentration == null ? "Unknown" : num(concentration, 2) + "%",
      ],
      ["Manufacturer scoop", r.scoop == null ? "Unknown" : num(r.scoop) + " g"],
      [
        "Labelled serving",
        r.serving == null ? "Unknown" : num(r.serving) + " g",
      ],
      [
        "Protein per scoop",
        r.category === "protein" && r.proteinPerScoop != null
          ? num(r.proteinPerScoop, 2) + " g"
          : null,
      ],
      [
        "Energy per 100 g",
        r.energy == null ? "Unknown" : num(r.energy) + " kcal",
      ],
      ["Cost / g " + c.compoundLabel, money(r.cost)],
      [
        "Cost / " + num(c.referenceGrams) + " g comparison",
        money(r.referenceCost),
      ],
      ["Stock", r.stock],
      ["Label review date", formatDate(r.labelChecked)],
      ["Category research date", formatDate(c.asOf)],
      ["Price observation date", formatDate(r.priceAudit.checked)],
      ["Price evidence status", r.priceAudit.status],
    ];
    $("#evidence-body").innerHTML =
      `<div class="detail-education"><strong>Understand the ingredient before choosing the pack.</strong><a href="${esc(guideHref(c.id))}">Read ${esc(c.label)} benefits, limitations &amp; safety →</a></div>${buyingOffer(snapshot, c)}<div class="offer-variant-select-wrap"><label for="offer-variant">Exact flavour, weight &amp; packaging</label><select id="offer-variant">${variants.map((v) => `<option value="${esc(v.id)}" ${v.id === r.id ? "selected" : ""}>${esc(v.flavour)} · ${size(v)}${v.packaging ? " · " + esc(v.packaging) : ""} · ${money(v.price)}</option>`).join("")}</select></div><div class="evidence-links">${link(r.url, primarySourceLabel(r))} · ${link(r.nutritionUrl, "Nutrition source")} · ${link(r.priceAudit.sourceUrl, "Dated price evidence")}</div><dl class="offer-facts">${fields
        .filter(([, v]) => v != null)
        .map(
          ([k, v]) =>
            `<div class="fact-item"><dt>${esc(k)}</dt><dd>${esc(v === '<span class="unknown">Unknown</span>' ? "Unknown" : v)}</dd></div>`,
        )
        .join(
          "",
        )}</dl><section class="method-card"><h3>Calculation inputs</h3><p>${r.cost == null ? "A required concentration value is unknown, so compound cost cannot be calculated." : `${money(r.price)} ÷ (${num(r.grams)} g × ${num(concentration, 2)}% ÷ 100) = ${money(r.cost)} / g. ${num(c.referenceGrams)} g × ${money(r.cost)} / g = ${money(r.referenceCost)}.`}</p><p class="hint">Comparison quantities are not manufacturer scoop sizes. Values use the stated compound percentage; different creatine forms may not be chemically equivalent.</p></section>${testingDetailsMarkup(r)}${renderHistory(r, c)}${retailerQuotesMarkup(r, { money, asOf: c.asOf, maxAgeDays: snapshot.config.maxPriceAgeDays })}${productReviewMarkup(r)}${otherIngredientsMarkup(r)}<section><h3>Label basis &amp; data quality</h3><p>${esc(r.basis || "Label basis not recorded.")}</p><p>${esc(r.notes || "No additional notes recorded.")}</p>${r.energyBasis ? `<p>${esc(r.energyBasis)}</p>` : ""}<ul class="quality-warning">${r.quality.issues.map((i) => `<li>${esc(i.field)}: ${esc(i.message)}</li>`).join("")}</ul></section>`;
    $("#offer-variant").addEventListener("change", (event) => {
      selected.id = event.target.value;
      renderOffer();
    });
  }

  async function refresh() {
    if (!selected) return;
    const token = ++request;
    try {
      const next = await loadSnapshot(selected.category, selected.id);
      if (token !== request || !selected) return;
      snapshot = next;
      ({ num, money, size } = createFormatting(next));
      renderOffer();
    } catch (error) {
      if (token === request && selected)
        $("#evidence-body").textContent =
          `Unable to load pack evidence. ${error.message}`;
    }
  }
  async function open(category, id) {
    selected = { category, id: String(id) };
    $("#evidence-title").textContent = "Pack details";
    $("#evidence-body").textContent = "Loading label and price evidence…";
    if (!$("#evidence").open) $("#evidence").showModal();
    await refresh();
  }
  $("#close").addEventListener("click", () => $("#evidence").close());
  $("#evidence").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#evidence").addEventListener("close", () => {
    selected = null;
    request++;
  });
  return { open, refresh };
}
