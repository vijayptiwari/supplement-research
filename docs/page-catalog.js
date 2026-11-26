import { escapeHtml as esc, formatDate } from "./presentation.js";
import { createFormatting, catalogFormula } from "./page-utils.js";
import { facetMarkup, isFacetChecked } from "./facets.js";
import { marketGroup, categoryHero, categoryPrimer } from "./marketplace.js";
import { testingBadge } from "./testing-evidence.js";
import { unitFacets, unitMetrics, unitTable } from "./unit-catalog.js";
import {
  facets,
  metrics,
  creatineFacets,
  creatineMetrics,
  filterOffers,
  sortOffers,
  groupOffersByProduct,
  priceAuditFlag,
} from "./core.js";

export function createCatalogController({
  categoryId,
  updateComparison,
  applyMetadata,
}) {
  const $ = (selector) => document.querySelector(selector);
  let snapshot,
    category,
    filtered = [],
    page = 1,
    view = "grouped";
  let num, money, size;
  const button = (offer) =>
    `<button type="button" class="btn-sm" data-category="${esc(offer.category)}" data-offer="${esc(offer.id)}">Pack details</button><button class="compare-add" type="button" data-add-compare data-category="${esc(offer.category)}" data-id="${esc(offer.id)}">Compare</button>`;
  function catalogFacets() {
    if (category?.measurement === "units") return unitFacets(category);
    return categoryId === "creatine" ? creatineFacets : facets;
  }
  function catalogMetrics() {
    if (category?.measurement === "units") return unitMetrics(category);
    return (categoryId === "creatine" ? creatineMetrics : metrics).map(
      ([key, label]) => [
        key,
        key === "doseCost"
          ? `Cost / ${category.referenceGrams} g compound (₹)`
          : label,
      ],
    );
  }
  function state() {
    const form = new FormData($("#filters")),
      s = {};
    for (const [key, value] of form) {
      if (catalogFacets().some(([k]) => k === key)) (s[key] ??= []).push(value);
      else s[key] = value;
    }
    return s;
  }
  function restore(s) {
    for (const element of $("#filters").elements) {
      const value = s[element.name];
      if (element.type === "checkbox")
        element.checked = catalogFacets().some(([key]) => key === element.name)
          ? isFacetChecked(value, element.value)
          : value === "on" || value === true;
      else if (element.multiple)
        for (const option of element.options)
          option.selected = (Array.isArray(value) ? value : [value]).includes(
            option.value,
          );
      else if (element.name)
        element.value = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
    }
  }
  function paramsState() {
    const s = {};
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (catalogFacets().some(([key]) => key === k)) (s[k] ??= []).push(v);
      else s[k] = v;
    }
    return s;
  }
  function buildFilters(previous) {
    const open = new Set(
      [...$("#categorical").querySelectorAll("details[open]")].map(
        (e) => e.dataset.facet,
      ),
    );
    $("#categorical").innerHTML = facetMarkup(
      category.offers,
      catalogFacets(),
      previous,
      open,
    );
    $("#numeric").innerHTML = catalogMetrics()
      .map(([key, label]) => {
        const known = category.offers
            .map((r) => r[key])
            .filter((n) => n != null),
          min = known.length ? num(Math.min(...known), 2) : "Unknown",
          max = known.length ? num(Math.max(...known), 2) : "Unknown";
        return `<label>${esc(label)}<span class="range-inputs"><input type="number" min="0" step="any" name="${key}Min" placeholder="Min ${esc(min)}" aria-label="${esc(label)} minimum"><input type="number" min="0" step="any" name="${key}Max" placeholder="Max ${esc(max)}" aria-label="${esc(label)} maximum"></span></label>`;
      })
      .join("");
    $("#quality-filters").innerHTML =
      `<label>Price change vs ${esc(category.previousQuarter.label)}<select name="priceTrend"><option value="">All history coverage</option><option value="down">Decreased</option><option value="up">Increased</option><option value="stable">Unchanged</option><option value="unknown">Latest-quarter change unverified</option></select></label><label class="check"><input type="checkbox" name="complete">Recorded concentration, scoop &amp; energy</label><label class="check"><input type="checkbox" name="knownCost">Known compound cost</label><label class="check"><input type="checkbox" name="verifiedPrice">Matching dated price evidence</label><label class="check"><input type="checkbox" name="reviewNeeded">Has data quality warnings</label>`;
    $("#quality-filters").insertAdjacentHTML(
      "afterbegin",
      `<label>Historical price coverage<select name="historyCoverage"><option value="">All offers</option><option value="any">Any verified historical quarter</option><option value="full">All ${snapshot.config.historyQuarters} quarters verified</option><option value="none">No verified historical quarters</option></select></label><label>Verified price in quarter<select name="historyQuarter"><option value="">Any requested quarter</option>${category.historyWindow.map((q) => `<option>${esc(q.label)}</option>`).join("")}${previous.historyQuarter && !category.historyWindow.some((q) => q.label === previous.historyQuarter) ? `<option>${esc(previous.historyQuarter)}</option>` : ""}</select></label>`,
    );
    if (snapshot.testing)
      $("#quality-filters").insertAdjacentHTML(
        "afterbegin",
        '<label>Independent testing evidence<select name="testing"><option value="">All offers</option><option value="linked">Linked published report</option><option value="passed">Passed sample reported</option><option value="failed">Failed sample reported</option><option value="expired">Expired source listing</option><option value="unlinked">No curated report link</option></select></label><p class="hint">Tests describe samples. Current retail batches are unverified. <a href="audit.html#independent-testing">Search reports →</a></p>',
      );
    if (category.measurement === "units") {
      const complete = $('#quality-filters input[name="complete"]');
      if (complete)
        complete.parentElement.lastChild.textContent =
          category.mainNutrient === "multi"
            ? "Known serving and recorded ingredient amounts"
            : "Known serving size and primary label amounts";
      const known = $('#quality-filters input[name="knownCost"]');
      if (known)
        known.parentElement.lastChild.textContent =
          category.mainNutrient === "multi"
            ? "Known label-serving cost"
            : "Known active-content cost";
    }
    $("#sort").innerHTML = [
      ["brand", "Brand A–Z"],
      ...catalogMetrics().map(([key, label]) => [key, label]),
    ]
      .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
      .join("");
    restore(previous);
    $("#sort").value = previous.sort || "brand";
    view = previous.view === "flat" ? "flat" : "grouped";
  }
  function offerTable(rows) {
    if (category.measurement === "units")
      return unitTable(category, rows, { num, money, button });
    return `<div class="table-wrap"><table class="offers-table"><thead><tr><th class="col-offer">Exact offer</th><th class="col-type">Form / subclass</th><th class="col-pack col-num">Pack</th><th class="col-price col-num">Price</th><th class="col-cost col-num">Cost / g compound</th><th class="col-refcost col-num">Cost / ${num(category.referenceGrams)} g</th><th class="col-concentration col-num">Labelled %</th><th class="col-scoop col-num">Scoop (g)</th><th class="col-energy col-num">Energy / 100 g</th><th class="col-stock">Stock</th><th class="col-action">Evidence</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="col-offer"><div class="brand">${esc(r.brand)}</div><strong>${esc(r.product)}</strong><div class="muted">${esc(r.flavour)}${r.packaging ? " · " + esc(r.packaging) : ""}</div>${testingBadge(r)}</td><td class="col-type"><span class="badge-type">${esc(r.type)}</span><div class="muted">${esc(r.subclass)}</div></td><td class="col-pack col-num">${size(r)}</td><td class="col-price col-num"><strong>${money(r.price)}</strong>${priceAuditFlag(r)}${r.trend?.status === "verified" && ["up", "down"].includes(r.trend?.direction) ? `<div class="trend-wrap"><span class="trend-pill trend-${r.trend.direction}">${r.trend.direction === "down" ? "▼" : "▲"} ${Math.abs(r.trend.pct).toFixed(1)}%</span></div>` : ""}</td><td class="col-cost col-num cost">${money(r.cost)}</td><td class="col-refcost col-num">${money(r.referenceCost)}</td><td class="col-concentration col-num"><strong>${num(r[category.concentrationField], 2)}${r[category.concentrationField] == null ? "" : "%"}</strong></td><td class="col-scoop col-num">${num(r.scoop)}</td><td class="col-energy col-num">${num(r.energy)}${r.energy == null ? "" : " kcal"}</td><td class="col-stock"><span class="stock-pill ${r.stock === "In stock" ? "stock-in" : "stock-out"}">${esc(r.stock)}</span></td><td class="col-action">${button(r)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function renderCatalog() {
    const s = state();
    filtered = sortOffers(
      filterOffers(category.offers, s, categoryId, category).filter(
        (r) =>
          (!s.verifiedPrice || r.priceAudit.status === "verified") &&
          (!s.reviewNeeded || r.quality.warnings > 0),
      ),
      $("#sort").value,
    );
    const chipLabel = (key, value) => {
      const flag = {
        complete: "Complete label inputs",
        knownCost: "Known cost",
        verifiedPrice: "Verified price",
        reviewNeeded: "Has data warnings",
      }[key];
      if (flag) return flag;
      if (key === "q") return "Search: " + value;
      const metric = catalogMetrics().find(
        ([name]) => key === name + "Min" || key === name + "Max",
      );
      return metric
        ? metric[1] + (key.endsWith("Min") ? " ≥ " : " ≤ ") + value
        : value;
    };
    const chips = Object.entries(s).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value])
          .filter(Boolean)
          .map((v) => ({ key, value: v })),
      ),
      activeFilters = $("#active-filters");
    activeFilters.innerHTML =
      chips
        .map(
          ({ key, value }) =>
            `<button type="button" class="filter-chip" data-filter-key="${esc(key)}" data-filter-value="${esc(value)}" title="Remove ${esc(key)}: ${esc(value)}">${esc(chipLabel(key, value))} <span>×</span></button>`,
        )
        .join("") +
      (chips.length
        ? '<button type="button" class="clear-applied" data-clear-filters>Clear all</button>'
        : "");
    activeFilters.onclick = (e) => {
      const chip = e.target.closest("[data-filter-key]");
      if (e.target.closest("[data-clear-filters]")) {
        $("#filters").reset();
        page = 1;
        renderCatalog();
        return;
      }
      if (!chip) return;
      for (const element of $("#filters").elements) {
        if (element.name !== chip.dataset.filterKey) continue;
        if (element.type === "checkbox") {
          if (
            !catalogFacets().some(([key]) => key === element.name) ||
            element.value === chip.dataset.filterValue
          )
            element.checked = false;
        } else if (element.multiple) {
          for (const option of element.options)
            if (option.value === chip.dataset.filterValue)
              option.selected = false;
        } else element.value = "";
      }
      page = 1;
      renderCatalog();
    };
    const filterButton = $("#filter-toggle");
    if (filterButton)
      filterButton.firstChild.textContent = chips.length
        ? `Filters & search · ${chips.length} active `
        : "Filters & search ";
    const groups = groupOffersByProduct(filtered, categoryId),
      limit = snapshot.config.pageSizes[view === "flat" ? "flat" : "grouped"],
      items = view === "flat" ? filtered : groups;
    const pages = Math.max(1, Math.ceil(items.length / limit));
    page = Math.min(page, pages);
    const rows = items.slice((page - 1) * limit, page * limit);
    $("#count").textContent =
      `${num(filtered.length, 0)} matching ${filtered.length === 1 ? "pack offer" : "pack offers"} · ${num(groups.length, 0)} ${groups.length === 1 ? "product" : "products"}`;
    $("#results-body").innerHTML =
      view === "flat"
        ? offerTable(rows)
        : rows
            .map((g) => marketGroup(category, g, snapshot, offerTable))
            .join("");
    updateComparison(snapshot);
    $("#empty").hidden = items.length > 0;
    $("#prev").disabled = page <= 1;
    $("#next").disabled = page >= pages;
    $("#page").textContent = `Page ${num(page, 0)} of ${num(pages, 0)}`;
    for (const mode of ["grouped", "flat"]) {
      $("#view-" + mode).classList.toggle("active", view === mode);
      $("#view-" + mode).setAttribute("aria-pressed", String(view === mode));
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(s))
      if (Array.isArray(v)) for (const value of v) params.append(k, value);
      else if (v) params.set(k, v);
    if (view === "flat") params.set("view", "flat");
    if ($("#sort").value !== "brand") params.set("sort", $("#sort").value);
    history.replaceState(
      null,
      "",
      location.pathname + (params.size ? "?" + params : ""),
    );
    applyMetadata(snapshot);
  }

  function render(next) {
    const previous = category
      ? { ...state(), sort: $("#sort").value, view }
      : null;
    snapshot = next;
    category = next.categories[categoryId];
    if (!category) throw Error("Category missing from dataset.");
    ({ num, money, size } = createFormatting(next));
    $(".category-hero").innerHTML = categoryHero(next, category);
    $("#category-primer").innerHTML = categoryPrimer(next, category);
    $("#results-title").textContent = category.label + " products";
    $("#formula-example").innerHTML = catalogFormula(next, category.offers);
    buildFilters(previous || paramsState());
    renderCatalog();
  }
  function resetPageAndRender() {
    if (!category) return;
    page = 1;
    renderCatalog();
  }
  $("#filters").addEventListener("input", (event) => {
    const search = event.target.closest("[data-facet-search]");
    if (search) {
      const query = search.value.toLowerCase().trim();
      search
        .closest("details")
        .querySelectorAll(".facet-option")
        .forEach((option) => {
          option.hidden = !option
            .querySelector("input")
            .value.toLowerCase()
            .includes(query);
        });
      return;
    }
    resetPageAndRender();
  });
  $("#sort").addEventListener("change", resetPageAndRender);
  $("#reset").addEventListener("click", () => {
    $("#filters").reset();
    resetPageAndRender();
  });
  for (const mode of ["grouped", "flat"])
    $("#view-" + mode).addEventListener("click", () => {
      view = mode;
      resetPageAndRender();
    });
  for (const [selector, delta] of [
    ["#prev", -1],
    ["#next", 1],
  ])
    $(selector).addEventListener("click", () => {
      if (!category) return;
      page += delta;
      renderCatalog();
      $("#results-title").scrollIntoView({ block: "start" });
    });
  return { render };
}
