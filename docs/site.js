import { watchData, dataStore } from "./data-store.js";
import { escapeHtml as esc, formatDate } from "./presentation.js";
import {
  legacyContentTarget,
  guideIdForLocation,
  articleIdForLocation,
} from "./routes.js";
import { setupChrome } from "./site-chrome.js";

const $ = (selector) => document.querySelector(selector);
const categoryId = document.body.dataset.category;
const pageType = document.body.dataset.page || "";
let snapshot = null;
let renderRequest = 0;
let catalogController;
let catalogControllerRequest;
let offerDialog;
let comparisonModule;
let comparisonReady = false;
let comparisonRequest;

// A page imports only its renderer. Category and article IDs come from the dataset.
const pageModules = {
  recommender: () => import("./recommender.js"),
  research: () => import("./research.js"),
  articles: () => import("./articles.js"),
  directory: () => import("./public-pages.js"),
  policy: () => import("./public-pages.js"),
  search: () => import("./search.js"),
  audit: () => import("./page-audit.js"),
};
const shellModules = Promise.all([
  import("./marketplace.js"),
  import("./seo.js"),
]);
let currentPageModule;

async function applyMetadata(current) {
  const [, seo] = await shellModules;
  if (snapshot === current)
    seo.applyContentMetadata(
      seo.metadataForLocation(current, location, document.body.dataset),
    );
}

function activeCategory(current) {
  if (categoryId) return categoryId;
  if (pageType === "research") return guideIdForLocation(location);
  const requested = new URLSearchParams(location.search).get("category");
  if (requested) return requested;
  if (pageType === "articles")
    return (
      current.research.editorial?.articles.find(
        (article) =>
          article.id ===
          articleIdForLocation(location, document.body.dataset.articleId),
      )?.category || ""
    );
  return "";
}

function renderNavigation(current, marketplace) {
  document.querySelectorAll("[data-site-name]").forEach((element) => {
    element.textContent = current.config.name;
  });
  const active = activeCategory(current);
  const navLinks = [
    ["index.html", "Home", !categoryId && !pageType],
    ["research.html", "Learn about supplements", pageType === "research"],
    ["articles.html", "Articles", ["articles", "directory"].includes(pageType)],
    [
      "search.html?kind=products",
      "Compare products",
      categoryId || pageType === "search",
    ],
    ["recommender.html", "Stack builder", pageType === "recommender"],
    ["audit.html", "Sources & data quality", pageType === "audit"],
  ];
  $("#navigation").innerHTML = navLinks
    .map(
      ([href, label, selected]) =>
        `<a href="${href}" ${selected ? 'aria-current="page"' : ""}>${esc(label)}</a>`,
    )
    .join("");
  const categoryNav = $("#category-nav");
  const firstNavigation = !categoryNav.children.length;
  categoryNav.innerHTML = marketplace.categoryGuideNavigation(
    current.config.categories,
    active,
  );
  if (firstNavigation)
    requestAnimationFrame(() => {
      const selectedLink = categoryNav.querySelector('[aria-current="page"]');
      if (!selectedLink) return;
      const rail = categoryNav.getBoundingClientRect();
      const item = selectedLink.getBoundingClientRect();
      if (item.left < rail.left || item.right > rail.right)
        categoryNav.scrollLeft +=
          item.left - rail.left - (rail.width - item.width) / 2;
    });
  const globalCategory = $("#global-search-category");
  const params = new URLSearchParams(location.search);
  const previous =
    pageType === "research"
      ? active
      : globalCategory.value || params.get("category") || active || "";
  globalCategory.innerHTML =
    '<option value="">All supplements</option>' +
    current.config.categories
      .map(
        (category) =>
          `<option value="${esc(category.id)}">${esc(category.label)}</option>`,
      )
      .join("");
  globalCategory.value = current.categories[previous] ? previous : "";
  const searchInput = $("#global-search-input");
  if (!searchInput.dataset.ready) {
    searchInput.value = params.get("q") || "";
    searchInput.dataset.ready = "true";
  }
}

function hasStoredComparison() {
  try {
    const picks = JSON.parse(
      sessionStorage.getItem("sr-comparison-v1") || "[]",
    );
    return Array.isArray(picks) && picks.length > 0;
  } catch {
    return false;
  }
}

// Stored selections are reconciled only against complete data, never an unloaded category.
async function updateComparison(current = snapshot) {
  if (!comparisonReady) return;
  try {
    const full = await dataStore.loadComparison();
    if (snapshot === current) comparisonModule.updateComparison(full);
  } catch (error) {
    if (snapshot === current)
      $("#dataset-status").textContent =
        `Unable to refresh comparison data. ${error.message}`;
  }
}

async function ensureComparison() {
  if (comparisonRequest) return comparisonRequest;
  comparisonRequest = (async () => {
    const module = await import("./compare.js");
    let current, full;
    do {
      current = snapshot;
      full = await dataStore.loadComparison();
    } while (snapshot !== current);
    comparisonModule = module;
    comparisonModule.updateComparison(full);
    comparisonReady = true;
  })();
  try {
    await comparisonRequest;
  } finally {
    comparisonRequest = null;
  }
}

async function renderPage(current, marketplace) {
  if (categoryId) {
    catalogControllerRequest ||= import("./page-catalog.js").then(
      ({ createCatalogController }) =>
        createCatalogController({
          categoryId,
          updateComparison,
          applyMetadata,
        }),
    );
    catalogController = await catalogControllerRequest;
    if (snapshot === current) catalogController.render(current);
    return;
  }
  if (!pageModules[pageType]) {
    marketplace.renderMarketHome(current);
    return;
  }
  currentPageModule ||= pageModules[pageType]();
  const module = await currentPageModule;
  if (snapshot !== current) return;
  switch (pageType) {
    case "recommender":
      module.renderRecommender(current);
      break;
    case "research":
      module.renderResearch(current, {
        loadGuide: (id) => dataStore.loadGuide(id),
      });
      break;
    case "articles":
      module.renderArticles(current);
      break;
    case "directory":
    case "policy":
      module.renderPublicPage(current, pageType);
      break;
    case "search":
      module.renderSearch(current);
      break;
    case "audit":
      module.renderAudit(current);
      break;
  }
}

async function onSnapshot(next) {
  const request = ++renderRequest;
  const legacy = legacyContentTarget(next, location);
  if (legacy) {
    location.replace(legacy);
    return;
  }
  snapshot = next;
  try {
    const [marketplace] = await shellModules;
    if (request !== renderRequest) return;
    renderNavigation(next, marketplace);
    await renderPage(next, marketplace);
    if (request !== renderRequest) return;
    await applyMetadata(next);
    if (offerDialog && $("#evidence").open) await offerDialog.refresh();
    if (comparisonReady) await updateComparison(next);
    else if (hasStoredComparison()) await ensureComparison();
  } catch (error) {
    if (request === renderRequest) {
      $("#dataset-status").textContent =
        `Unable to render this dataset. ${error.message} Use Refresh data to retry.`;
      $("#dataset-status").classList.add("data-error");
      console.error(error);
    }
  }
}

function renderStatus(current, status) {
  const element = $("#dataset-status");
  element.classList.toggle("data-error", status.state === "error");
  if (status.state === "error") {
    element.textContent = current
      ? `Refresh failed. Showing last validated revision ${status.version.slice(0, 8)}. ${status.message}`
      : `Dataset unavailable. ${status.message} Use Refresh data to retry.`;
    return;
  }
  if (!current) return;
  element.textContent = `Data reviewed ${formatDate(current.categories[categoryId]?.asOf || current.asOf)}`;
  element.title = `Revision ${status.version.slice(0, 8)} · automatically checks every ${current.config.refreshIntervalMs / 1000} seconds while visible`;
}

$("#refresh-data").addEventListener("click", async () => {
  const button = $("#refresh-data");
  button.disabled = true;
  try {
    await dataStore.refresh();
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-offer]");
  if (!button || !snapshot) return;
  const { createOfferDialog } = await import("./offer-dialog.js");
  offerDialog ||= createOfferDialog({
    loadSnapshot: (category, id) => dataStore.loadOffer(category, id),
  });
  await offerDialog.open(button.dataset.category, button.dataset.offer);
});

document.addEventListener(
  "click",
  async (event) => {
    const button = event.target.closest("[data-add-compare]");
    if (!button || comparisonReady) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      await ensureComparison();
      button.disabled = false;
      if (button.isConnected) button.click();
    } catch (error) {
      $("#dataset-status").textContent =
        `Unable to load comparison data. ${error.message}`;
    } finally {
      button.disabled = false;
    }
  },
  true,
);

document.addEventListener("change", (event) => {
  if (event.target.id !== "category-switch" || !snapshot) return;
  const category = snapshot.config.categories.find(
    (item) => item.page === event.target.value,
  );
  if (category) location.href = category.page;
});

setupChrome();
watchData(onSnapshot, renderStatus);
