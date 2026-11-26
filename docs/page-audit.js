import { escapeHtml as esc, formatDate } from "./presentation.js";
import { createFormatting, catalogFormula } from "./page-utils.js";
import { stats } from "./catalog-model.js";
import { catalogResearchMarkup } from "./catalog-research.js";
import {
  testingAuditMarkup,
  activateTestingAudit,
} from "./testing-evidence.js";

export function renderAudit(snapshot) {
  const $ = (selector) => document.querySelector(selector);
  const { num, money } = createFormatting(snapshot);
  function renderStats(s) {
    $("#stats").innerHTML = [
      [s.offers, "exact pack offers"],
      [s.brands, "brands"],
      [s.products, "products"],
      [s.verifiedPrices, "prices with dated evidence"],
    ]
      .map(
        ([n, label]) =>
          `<div><strong>${num(n, 0)}</strong><span>${label}</span></div>`,
      )
      .join("");
  }
  function historyCoverage(categories) {
    const periods = [
      ...new Map(
        categories.flatMap((c) => c.historyWindow).map((q) => [q.start, q]),
      ).values(),
    ].sort((a, b) => a.start.localeCompare(b.start));
    const s = stats(categories.flatMap((c) => c.offers));
    return `<section class="method-card history-coverage"><h2>${snapshot.config.historyQuarters}-quarter price history audit</h2><p>${num(s.historicalVerified, 0)} of ${num(s.historicalSlots, 0)} exact offer-quarter slots have verified dated prices. ${num(s.fullHistoryOffers, 0)} offers have evidence in every requested completed quarter. Current observations are shown separately in product Details.</p><div class="table-wrap"><table><thead><tr><th>Completed quarter</th>${categories.map((c) => `<th>${esc(c.label)} verified offers</th>`).join("")}</tr></thead><tbody>${periods
      .map(
        (q) =>
          `<tr><th>${esc(q.label)}<div class="muted">${q.start} – ${q.end}</div></th>${categories
            .map((c) => {
              if (!c.historyWindow.some((p) => p.start === q.start))
                return "<td>Outside this category’s window</td>";
              const count = c.offers.filter((r) =>
                r.trend.history.some(
                  (h) => !h.isCurrent && h.start === q.start && h.verified,
                ),
              ).length;
              return `<td><strong>${num(count, 0)} / ${num(c.offers.length, 0)}</strong><meter min="0" max="${c.offers.length}" value="${count}" aria-label="${esc(c.label + " " + q.label + " verified offers")}"></meter></td>`;
            })
            .join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p>Each value is a dated exact-variant snapshot within its quarter. Missing quarters remain unknown; no prices are carried forward and no launch dates are inferred. Quarter-on-quarter changes require evidence in both adjacent quarters.</p></section>`;
  }
  function coverage(categories) {
    const offers = categories.flatMap((c) => c.offers),
      s = stats(offers),
      unknown = s.offers - s.verifiedTrends,
      powders = offers.filter((r) => !r.isUnitOffer || r.form === "Powder"),
      units = offers.filter((r) => r.isUnitOffer && r.form !== "Powder");
    $("#coverage").innerHTML =
      `<section class="price-audit-note"><h2>Evidence &amp; data coverage</h2><p>${categories.map((c) => `<strong>${esc(c.label)}</strong>: ${esc(c.historyWindow[0].label)}–${esc(c.previousQuarter.label)} snapshots → dataset as of ${formatDate(c.asOf)}`).join(" · ")}. Changes compare dated observations, not quarterly averages.</p><div class="coverage-grid">${[[s.verifiedPrices, s.offers, "Prices with matching evidence"], [s.verifiedTrends, s.offers, "Latest-quarter changes verified"], [s.knownCost, s.offers, "Primary comparison inputs known"], [powders.filter((r) => r.energy != null).length, powders.length, "Powder energy values recorded"], [powders.filter((r) => r.scoop != null || r.servingGrams != null).length, powders.length, "Powder scoop / label serving masses recorded"], ...(units.length ? [[units.filter((r) => r.servingUnits != null).length, units.length, "Unit-product label servings known"]] : [])].map(([n, total, label]) => `<div class="coverage-card"><div class="coverage-card-head"><span class="coverage-label">${label}</span><strong class="coverage-value">${num(n, 0)} <span class="coverage-total">/ ${num(total, 0)}</span></strong></div><div class="coverage-progress"><div class="coverage-progress-fill" style="width:${Math.round((n / total) * 100)}%"></div></div><meter min="0" max="${total}" value="${n}" aria-label="${label}"></meter></div>`).join("")}</div><p>${num(unknown, 0)} offers have no verified latest-quarter comparison. ${num(s.offers - s.verifiedPrices, 0)} prices remain unverified or stale. Price evidence is considered recent within ${num(snapshot.config.maxPriceAgeDays, 0)} days of each category’s research date; open Details for the actual observation date. Nutrition coverage means a value is recorded, not independently lab-tested.</p><div class="trend-legend"><span class="down">▼ Decreased</span><span class="up">▲ Increased</span><span class="unchanged">─ Unchanged</span><span class="missing">? No verified history</span></div><p class="hint">${num(
        offers.reduce((n, r) => n + r.quality.warnings, 0),
        0,
      )} field warnings in this view. Missing labels, shared nutrition profiles and conflicting claims remain visible in offer notes.</p></section>`;
    $("#coverage").insertAdjacentHTML("beforeend", historyCoverage(categories));
  }
  function renderDownloads() {
    const el = $("#downloads");
    if (!el) return;
    const categories = Object.values(snapshot.categories);
    el.innerHTML = [
      ...categories.map((c) => ({
        file: c.file,
        label: c.educationOnly
          ? `${c.label} education scope JSON`
          : `${c.label} JSON · ${num(c.stats.offers, 0)} offers`,
      })),
      {
        file: "price-history.csv",
        label: `${snapshot.config.historyQuarters}-quarter price history CSV`,
      },
      { file: "price-audit.csv", label: "Latest-quarter change audit CSV" },
      { file: "price-observations.json", label: "Dated price observations" },
      { file: "quality-report.json", label: "Data quality report" },
    ]
      .map(
        (a) =>
          `<a class="research-card" download href="data/${esc(a.file)}"><strong>${esc(a.label)} ↓</strong><p class="muted">${num((snapshot.assets[a.file]?.bytes || 0) / 1024, 1)} KB · dataset as of ${formatDate(snapshot.asOf)}</p></a>`,
      )
      .join("");
  }
  function render() {
    const old = $("[data-testing-filters]"),
      previous = old ? Object.fromEntries(new FormData(old)) : {};
    const categories = Object.values(snapshot.categories).filter(
      (c) => !c.educationOnly,
    );
    renderStats(snapshot.stats);
    coverage(categories);
    $("#coverage").insertAdjacentHTML(
      "afterbegin",
      testingAuditMarkup(snapshot),
    );
    $("#coverage").insertAdjacentHTML(
      "beforeend",
      catalogResearchMarkup(snapshot),
    );
    activateTestingAudit(snapshot, $("#independent-testing"), previous);
    $("#formula-example").innerHTML = catalogFormula(
      snapshot,
      categories.flatMap((c) => c.offers),
    );
    renderDownloads();
  }

  render();
}
