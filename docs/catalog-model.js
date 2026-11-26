import { positive } from "./presentation.js";
// Pure display calculations shared by generated pages and browser controllers.
export function stats(offers) {
  const historical = offers.flatMap((r) =>
    (r.trend?.history || []).filter((h) => !h.isCurrent),
  );
  return {
    offers: offers.length,
    products: new Set(offers.map((r) => JSON.stringify([r.brand, r.product])))
      .size,
    listings: new Set(
      offers.map((r) =>
        JSON.stringify([r.brand, r.product, r.flavour, r.packaging || ""]),
      ),
    ).size,
    brands: new Set(offers.map((r) => r.brand)).size,
    knownCost: offers.filter((r) => r.cost != null).length,
    knownEnergy: offers.filter((r) => r.energy != null).length,
    knownScoop: offers.filter((r) => r.scoop != null).length,
    verifiedPrices: offers.filter((r) => r.priceAudit?.status === "verified")
      .length,
    verifiedTrends: offers.filter((r) => r.trend?.status === "verified").length,
    historicalSlots: historical.length,
    historicalVerified: historical.filter((h) => h.verified).length,
    fullHistoryOffers: offers.filter(
      (r) =>
        r.trend?.completedQuartersTracked === r.trend?.historyWindowQuarters,
    ).length,
  };
}

export function scoreProtein(r) {
  return positive(r.cost) ? 100 / r.cost : 0;
}

export function scoreCreatine(r) {
  return positive(r.cost) ? 100 / r.cost : 0;
}

export function rankedOffers(category, limit = 10, predicate = () => true) {
  const best = new Map();
  for (const r of category.offers.filter(
    (r) => r.rankingEligible && predicate(r),
  )) {
    const key = JSON.stringify([r.brand, r.product]);
    if (!best.has(key) || r.score > best.get(key).score) best.set(key, r);
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.brand.localeCompare(b.brand) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, limit);
}

export function quickPick(snapshot, rule) {
  const c = snapshot.categories[rule.category];
  if (!c) return null;
  const fits = (r) =>
    rule.typeIncludes.some((t) => r.type.toLowerCase().includes(t)) &&
    (rule.unflavoured == null ||
      /unflavou?red/i.test(r.flavour) === rule.unflavoured);
  const eligible = c.offers
    .filter((r) => r.rankingEligible && fits(r))
    .sort((a, b) => a.referenceCost - b.referenceCost);
  return eligible.length
    ? {
        ...rule,
        offer: eligible[0],
        count: eligible.length,
        min: eligible[0].referenceCost,
        max: eligible.at(-1).referenceCost,
        referenceGrams: c.referenceGrams,
        compoundLabel: c.compoundLabel,
      }
    : null;
}

export function pageMetadata(snapshot, categoryId) {
  const educational = snapshot.categories[categoryId];
  if (educational?.educationOnly)
    return {
      title: educational.label + " evidence guide · " + snapshot.config.name,
      description:
        snapshot.research?.articles.find((a) => a.category === categoryId)
          ?.summary || educational.scope,
      structured: {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: educational.label + " evidence guide",
        url: snapshot.config.baseUrl + educational.page,
        dateModified: snapshot.research?.articles.find(
          (a) => a.category === categoryId,
        )?.reviewed,
      },
    };
  if (categoryId === "articles")
    return {
      title: "Supplement myths & forms explained · " + snapshot.config.name,
      description:
        snapshot.research?.editorial?.description ||
        "Cited articles examining supplement claims, ingredient forms, delivery formats and metabolism.",
      structured: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Supplement articles",
        url: snapshot.config.baseUrl + "articles.html",
        dateModified: snapshot.research?.editorial?.reviewed,
      },
    };
  if (categoryId === "search")
    return {
      title:
        "Search supplements, products & research · " + snapshot.config.name,
      description:
        "Search education guides, product labels, variants and sourced prices across supplement categories.",
      structured: {
        "@context": "https://schema.org",
        "@type": "SearchResultsPage",
        name: "Supplement search",
        url: snapshot.config.baseUrl + "search.html",
      },
    };
  if (categoryId === "recommender")
    return {
      title: "Supplement Stack Recommender · " + snapshot.config.name,
      description:
        "Build an evidence-informed supplement stack around goals, diet, existing supplements and pack budget.",
      structured: {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Supplement Stack Recommender",
        url: snapshot.config.baseUrl + "recommender.html",
        applicationCategory: "HealthApplication",
      },
    };
  if (categoryId === "research")
    return {
      title: "Articles & Research · " + snapshot.config.name,
      description:
        "Evidence guides and selected scientific references for all supplement categories.",
      structured: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Supplement articles and research",
        url: snapshot.config.baseUrl + "research.html",
        dateModified: snapshot.research?.reviewed,
      },
    };
  if (categoryId === "audit")
    return {
      title: `Testing Evidence & Data Audit · ${snapshot.config.name}`,
      description: `Explore ${snapshot.testing?.reports.length || 0} published sample test records, source coverage and ${snapshot.config.historyQuarters}-quarter price evidence. Dataset as of ${snapshot.asOf}.`,
      structured: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: `Testing Evidence & Data Audit · ${snapshot.config.name}`,
        description: `Reported sample tests and dated product-data coverage; current retail batches are unverified.`,
        dateModified: snapshot.asOf,
        url: snapshot.config.baseUrl + "audit.html",
        ...(snapshot.testing
          ? {
              distribution: [
                {
                  "@type": "DataDownload",
                  encodingFormat: "application/json",
                  contentUrl:
                    snapshot.config.baseUrl +
                    "data/" +
                    snapshot.config.testingFile,
                },
              ],
            }
          : {}),
      },
    };
  const c = snapshot.categories[categoryId],
    s = c?.stats || snapshot.stats,
    page = c?.page || "index.html";
  const title = c
    ? `${c.label} catalog · ${s.offers.toLocaleString(snapshot.config.locale)} pack offers`
    : `${snapshot.config.name} · Learn about ${snapshot.research?.articles?.length || Object.keys(snapshot.categories).length} supplements`;
  const description = c
    ? `Compare ${s.offers.toLocaleString(snapshot.config.locale)} ${c.label.toLowerCase()} pack offers across ${s.brands} brands. Dated sources, calculated compound costs and data quality coverage. Dataset as of ${c.asOf}.`
    : "Understand how supplements work, who may benefit, responsible use and value-for-money checks. Learn first, then compare sourced products for your requirements.";
  const structured = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title,
    description,
    dateModified: c?.asOf || snapshot.asOf,
    url: snapshot.config.baseUrl + (page === "index.html" ? "" : page),
    distribution: snapshot.config.categories
      .filter((k) => !c || k.id === c.id)
      .map((k) => ({
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: snapshot.config.baseUrl + "data/" + k.file,
      })),
  };
  return { title, description, structured };
}
