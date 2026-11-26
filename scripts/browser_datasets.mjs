import { createHash } from "node:crypto";
import { editorialNarrativeWords } from "../docs/editorial-model.js";
import { buildSearchIndex } from "../docs/search.js";
import { researchSearchText } from "../docs/research.js";
import { editorialSearchText } from "../docs/articles.js";

const summaryKeys = [
  "id",
  "category",
  "relatedCategories",
  "title",
  "summary",
  "series",
  "reviewed",
  "published",
  "author",
  "sourceIds",
];
const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );

export function contentSummary(article) {
  return {
    ...pick(article, summaryKeys),
    _contentLoaded: false,
    sourceCount: article.sourceIds?.length || 0,
    wordCount: editorialNarrativeWords(article),
    ...(article.buyingGuide
      ? { buyingGuide: { value: article.buyingGuide.value } }
      : {}),
  };
}

// Keep every calculation, facet and eligibility result. Large source notes,
// empty history slots and report bodies belong to the exact-product detail.
export function catalogOffer(offer) {
  const {
    basis,
    notes,
    energyBasis,
    nutritionBasis,
    retailerQuotes,
    lastPriceReview,
    ...row
  } = offer;
  const trendKeys = [
    "status",
    "pct",
    "direction",
    "historyWindowQuarters",
    "completedQuartersTracked",
    "fullHistoryVerified",
    "twelveQuarterChangePct",
  ];
  return {
    ...row,
    quality: { errors: offer.quality.errors, warnings: offer.quality.warnings },
    trend: {
      ...pick(offer.trend, trendKeys),
      history: offer.trend.history
        .filter((h) => h.verified)
        .map((h) => pick(h, ["quarter", "start", "isCurrent", "verified"])),
    },
    testing: {
      currentBatchVerified: false,
      reviewRequired: offer.testing.reviewRequired,
      reports: offer.testing.reports.map((r) =>
        pick(r, ["id", "reportedStatus"]),
      ),
      matches: [],
    },
  };
}

export function browserProjections(snapshot) {
  const search = buildSearchIndex(snapshot);
  const categories = Object.fromEntries(
    Object.values(snapshot.categories).map((c) => [
      c.id,
      { ...c, offers: [], _offersLoaded: false },
    ]),
  );
  const research = {
    ...snapshot.research,
    sources: snapshot.research.sources.map((s) =>
      pick(s, ["id", "title", "url", "kind", "year", "checked"]),
    ),
    sourceCount: snapshot.research.sources.length,
    articles: snapshot.research.articles.map(contentSummary),
    editorial: {
      ...snapshot.research.editorial,
      articles: snapshot.research.editorial.articles.map(contentSummary),
    },
  };
  const core = {
    config: snapshot.config,
    categories,
    research,
    recommender: snapshot.recommender,
    asOf: snapshot.asOf,
    stats: snapshot.stats,
    assets: snapshot.assets,
    quality: { errors: [], warnings: [] },
    testing: snapshot.testing
      ? {
          checked: snapshot.testing.checked,
          scope: snapshot.testing.scope,
          reports: [],
          matches: [],
        }
      : null,
    catalogResearch: snapshot.catalogResearch,
  };
  const sourcesFor = (item) =>
    snapshot.research.sources.filter((s) => item.sourceIds.includes(s.id));
  const guides = Object.fromEntries(
    snapshot.research.articles.map((a) => [
      a.category,
      { guide: { ...a, _contentLoaded: true }, sources: sourcesFor(a) },
    ]),
  );
  const articles = Object.fromEntries(
    snapshot.research.editorial.articles.map((a) => {
      // Readers reuse their category's mechanism and its original references.
      const guide = guides[a.category].guide;
      const ids = new Set([...a.sourceIds, ...guide.sourceIds]);
      return [
        a.id,
        {
          article: { ...a, _contentLoaded: true },
          guide,
          sources: snapshot.research.sources.filter((source) =>
            ids.has(source.id),
          ),
        },
      ];
    }),
  );
  const catalogs = Object.fromEntries(
    Object.values(snapshot.categories).map((c) => [
      c.id,
      {
        category: {
          ...c,
          offers: c.offers.map(catalogOffer),
          _offersLoaded: true,
        },
      },
    ]),
  );
  const products = {},
    offerKeys = {};
  for (const c of Object.values(snapshot.categories)) {
    const groups = Map.groupBy(c.offers, (r) =>
      JSON.stringify([r.brand, r.product]),
    );
    for (const [identity, offers] of groups) {
      const key = createHash("sha256")
        .update(c.id + "\0" + identity)
        .digest("hex")
        .slice(0, 24);
      products[key] = { category: { ...c, offers, _offersLoaded: true } };
      for (const offer of offers)
        offerKeys[JSON.stringify([c.id, String(offer.id)])] = key;
    }
  }
  const comparison = {
    categories: Object.fromEntries(
      Object.values(snapshot.categories).map((c) => [
        c.id,
        { ...c, offers: c.offers.map(catalogOffer), _offersLoaded: true },
      ]),
    ),
  };
  const stack = {
    ...comparison,
    recommender: snapshot.recommender,
    research: {
      ...snapshot.research,
      articles: snapshot.research.articles.map((a) => ({
        ...a,
        _contentLoaded: true,
      })),
      editorial: research.editorial,
    },
  };
  const indexed = (entries, originals, text) =>
    entries.map((a) => ({
      ...a,
      searchText: text(originals.find((item) => item.id === a.id)),
    }));
  const library = {
    research: {
      ...research,
      sources: snapshot.research.sources,
      articles: indexed(
        research.articles,
        snapshot.research.articles,
        researchSearchText,
      ),
      editorial: {
        ...research.editorial,
        articles: indexed(
          research.editorial.articles,
          snapshot.research.editorial.articles,
          editorialSearchText,
        ),
      },
    },
  };
  return {
    core,
    guides,
    articles,
    catalogs,
    products,
    offerKeys,
    comparison,
    stack,
    library,
    search,
    references: { sources: snapshot.research.sources },
  };
}

export async function publishBrowserDatasets(snapshot, { write, legacy }) {
  const data = browserProjections(snapshot),
    resources = {};
  const publish = async (name, value) => {
    const raw = JSON.stringify(value),
      sha256 = createHash("sha256").update(raw).digest("hex"),
      file = `${name}.${sha256}.json`;
    await write("data/" + file, raw);
    return { file, sha256, bytes: Buffer.byteLength(raw) };
  };
  for (const name of [
    "core",
    "search",
    "comparison",
    "stack",
    "references",
    "library",
  ])
    resources[name] = await publish(name, data[name]);
  for (const [name, entries] of Object.entries({
    guides: data.guides,
    articles: data.articles,
    catalogs: data.catalogs,
    products: data.products,
  })) {
    resources[name] = {};
    for (const [id, value] of Object.entries(entries))
      resources[name][id] = await publish(name.slice(0, -1) + "-" + id, value);
  }
  const manifest = {
    schemaVersion: 2,
    asOf: snapshot.asOf,
    resources,
    offerKeys: data.offerKeys,
    legacy,
  };
  const descriptor = await publish("manifest", manifest);
  return { manifest, descriptor };
}
