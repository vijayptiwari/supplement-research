import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDataStore, pageDataScope } from "../docs/data-store.js";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function revision(
  label,
  {
    wrongCatalog = false,
    wrongGuide = false,
    wrongArticle = false,
    mixedProduct = false,
  } = {},
) {
  const files = new Map();
  function resource(name, value) {
    const raw = JSON.stringify(value),
      sha256 = digest(raw),
      file = `${name}.${sha256}.json`;
    files.set(file, raw);
    return { file, sha256, bytes: Buffer.byteLength(raw) };
  }
  const definitions = [
    { id: "protein", label: "Protein" },
    { id: "creatine", label: "Creatine" },
  ];
  const guide = (category) => ({
    id: `${category}-guide`,
    category,
    title: `${category} guide`,
    summary: "Summary",
    sourceIds: [`${category}-ref`],
    _contentLoaded: false,
  });
  const article = (id) => ({
    id,
    category: "protein",
    title: id,
    summary: "Summary",
    sourceIds: ["protein-ref"],
    _contentLoaded: false,
  });
  const source = (category) => ({
    id: `${category}-ref`,
    url: `https://example.com/${category}`,
    title: `${category} reference`,
  });
  const offers = [
    {
      id: "p1",
      category: "protein",
      brand: "Acme",
      product: "Whey",
      flavour: "Plain",
      price: 100 + label.length,
    },
    {
      id: "p2",
      category: "protein",
      brand: "Acme",
      product: "Whey",
      flavour: "Chocolate",
      price: 110 + label.length,
    },
    {
      id: "p3",
      category: "protein",
      brand: "Other",
      product: "Plant",
      flavour: "Plain",
      price: 120 + label.length,
    },
    {
      id: "c1",
      category: "creatine",
      brand: "Acme",
      product: "Creatine",
      flavour: "Plain",
      price: 50 + label.length,
    },
  ];
  const category = (id, rows = []) => ({
    id,
    label: id,
    offers: rows,
    _offersLoaded: rows.length > 0,
  });
  const core = {
    config: {
      name: label,
      currency: "INR",
      locale: "en-IN",
      categories: definitions,
      refreshIntervalMs: 60000,
    },
    categories: Object.fromEntries(
      definitions.map((c) => [c.id, category(c.id)]),
    ),
    research: {
      articles: definitions.map((c) => guide(c.id)),
      editorial: {
        articles: [article("whey-forms"), article("protein-timing")],
      },
      sources: [],
    },
    stats: { offers: offers.length },
    asOf: "2026-11-20",
  };
  const resources = {
    core: resource("core", core),
    catalogs: {},
    guides: {},
    articles: {},
    products: {},
  };
  for (const { id } of definitions) {
    const target = wrongCatalog && id === "protein" ? "creatine" : id;
    resources.catalogs[id] = resource(`catalog-${id}`, {
      category: category(
        target,
        offers.filter((row) => row.category === target),
      ),
    });
    const guideTarget = wrongGuide && id === "protein" ? "creatine" : id;
    resources.guides[id] = resource(`guide-${id}`, {
      guide: {
        ...guide(guideTarget),
        _contentLoaded: true,
        process: [`Complete guide ${label}`],
      },
      sources: [source(guideTarget)],
    });
  }
  for (const id of ["whey-forms", "protein-timing"]) {
    const target = wrongArticle && id === "whey-forms" ? "protein-timing" : id;
    resources.articles[id] = resource(`article-${id}`, {
      article: {
        ...article(target),
        _contentLoaded: true,
        sections: [{ title: "Body", body: `Complete article ${label}` }],
      },
      sources: [source("protein")],
    });
  }
  const productRows = offers
    .filter((row) => row.product === "Whey")
    .map((row) => ({ ...row, notes: `Full evidence ${label}` }));
  resources.products.whey = resource("product-whey", {
    category: category(
      "protein",
      mixedProduct ? [...productRows, offers[2]] : productRows,
    ),
  });
  resources.comparison = resource("comparison", {
    categories: Object.fromEntries(
      definitions.map((c) => [
        c.id,
        category(
          c.id,
          offers.filter((row) => row.category === c.id),
        ),
      ]),
    ),
  });
  resources.references = resource("references", {
    sources: definitions.map((c) => source(c.id)),
  });
  const manifest = {
    schemaVersion: 2,
    resources,
    offerKeys: Object.fromEntries(
      productRows.map((row) => [
        JSON.stringify([row.category, row.id]),
        "whey",
      ]),
    ),
  };
  const descriptor = resource("manifest", manifest);
  return {
    files,
    resources,
    core,
    manifest,
    pointer: {
      schemaVersion: 2,
      version: descriptor.sha256,
      file: descriptor.file,
    },
  };
}

function network(...revisions) {
  const files = new Map(revisions.flatMap((value) => [...value.files]));
  const requests = [],
    overrides = new Map(),
    gates = new Map(),
    failures = new Set();
  let pointer = revisions[0].pointer;
  const fetcher = async (url, options) => {
    const file = new URL(url).pathname.split("/").pop();
    requests.push({ file, cache: options.cache });
    if (file === "version.json") return { ok: true, json: async () => pointer };
    if (gates.has(file)) await gates.get(file)();
    if (failures.has(file)) return { ok: false, status: 503 };
    if (overrides.has(file))
      return { ok: true, text: async () => overrides.get(file) };
    return files.has(file)
      ? { ok: true, text: async () => files.get(file) }
      : { ok: false, status: 404 };
  };
  return {
    fetcher,
    requests,
    overrides,
    gates,
    failures,
    setPointer(value) {
      pointer = value;
    },
  };
}
const storeFor = (transport, scope = {}) =>
  createDataStore({
    fetcher: transport.fetcher,
    digest,
    baseUrl: new URL("https://example.com/data/"),
    scope,
  });
const downloaded = (transport) =>
  transport.requests
    .filter((request) => request.file !== "version.json")
    .map((request) => request.file);

test("home downloads metadata only and an unchanged revision reuses immutable resources", async () => {
  const first = revision("first"),
    transport = network(first),
    store = storeFor(transport);
  await store.refresh();
  assert.deepEqual(
    new Set(downloaded(transport)),
    new Set([first.pointer.file, first.resources.core.file]),
  );
  assert.equal(store.current.categories.protein.offers.length, 0);
  const current = store.current,
    count = transport.requests.length;
  await store.refresh();
  assert.equal(store.current, current);
  assert.equal(transport.requests.length, count + 1);
  assert.equal(transport.requests.at(-1).file, "version.json");
  assert.equal(transport.requests[0].cache, "no-store");
  assert.ok(
    transport.requests
      .slice(1, count)
      .every((request) => request.cache === "force-cache"),
  );
});

test("catalog and article pages download only their requested content scopes", async () => {
  const first = revision("first"),
    catalogNetwork = network(first),
    catalogStore = storeFor(catalogNetwork, { category: "protein" });
  await catalogStore.refresh();
  assert.deepEqual(
    new Set(downloaded(catalogNetwork)),
    new Set([
      first.pointer.file,
      first.resources.core.file,
      first.resources.catalogs.protein.file,
      first.resources.guides.protein.file,
    ]),
  );
  assert.equal(catalogStore.current.categories.protein.offers.length, 3);
  assert.equal(catalogStore.current.categories.creatine.offers.length, 0);
  assert.equal(
    catalogStore.current.research.articles.find((a) => a.category === "protein")
      ._contentLoaded,
    true,
  );
  assert.equal(
    catalogStore.current.research.articles.find(
      (a) => a.category === "creatine",
    )._contentLoaded,
    false,
  );
  const articleNetwork = network(first),
    articleStore = storeFor(articleNetwork, {
      page: "articles",
      article: "whey-forms",
    });
  await articleStore.refresh();
  assert.deepEqual(
    new Set(downloaded(articleNetwork)),
    new Set([
      first.pointer.file,
      first.resources.core.file,
      first.resources.articles["whey-forms"].file,
    ]),
  );
  assert.equal(
    articleStore.current.research.editorial.articles[0]._contentLoaded,
    true,
  );
  assert.equal(
    articleStore.current.research.editorial.articles[1]._contentLoaded,
    false,
  );
});

test("a corrupt requested resource retains the entire last valid view and recovers on retry", async () => {
  const first = revision("first"),
    second = revision("second"),
    transport = network(first, second),
    store = storeFor(transport, { category: "protein" }),
    statuses = [];
  store.subscribe((_, status) => statuses.push(status));
  await store.refresh();
  const valid = store.current;
  transport.setPointer(second.pointer);
  transport.overrides.set(
    second.resources.catalogs.protein.file,
    '{"corrupted":true}',
  );
  await store.refresh();
  assert.equal(store.current, valid);
  assert.equal(store.current.config.name, "first");
  assert.equal(statuses.at(-1).state, "error");
  assert.match(statuses.at(-1).message, /integrity/);
  transport.overrides.delete(second.resources.catalogs.protein.file);
  await store.refresh();
  assert.notEqual(store.current, valid);
  assert.equal(store.current.config.name, "second");
  assert.equal(statuses.at(-1).state, "updated");
});

test("a failed resource request retains the last valid scoped view", async () => {
  const first = revision("first"),
    second = revision("second"),
    transport = network(first, second),
    store = storeFor(transport, { page: "articles", article: "whey-forms" }),
    statuses = [];
  store.subscribe((_, status) => statuses.push(status));
  await store.refresh();
  const valid = store.current;
  transport.setPointer(second.pointer);
  transport.failures.add(second.resources.articles["whey-forms"].file);
  await store.refresh();
  assert.equal(store.current, valid);
  assert.equal(statuses.at(-1).state, "error");
  assert.match(statuses.at(-1).message, /503/);
});

test("product and comparison resources load on demand without replacing or mutating the page view", async () => {
  const first = revision("first"),
    transport = network(first),
    store = storeFor(transport);
  await store.refresh();
  const initial = store.current;
  const detailed = await store.loadOffer("protein", "p1");
  assert.deepEqual(
    detailed.categories.protein.offers.map((row) => row.id),
    ["p1", "p2"],
  );
  assert.ok(
    detailed.categories.protein.offers.every(
      (row) => row.product === "Whey" && row.notes === "Full evidence first",
    ),
  );
  assert.equal(detailed.categories.creatine.offers.length, 0);
  assert.equal(store.current, initial);
  assert.equal(initial.categories.protein.offers.length, 0);
  assert.equal(initial.research.sources.length, 0);
  const count = transport.requests.length;
  await store.loadOffer("protein", "p2");
  assert.equal(transport.requests.length, count);
  const comparison = await store.loadComparison();
  assert.equal(comparison.categories.protein.offers.length, 3);
  assert.equal(comparison.categories.creatine.offers.length, 1);
  assert.equal(store.current, initial);
  assert.ok(downloaded(transport).includes(first.resources.comparison.file));
  assert.ok(
    !downloaded(transport).includes(first.resources.catalogs.protein.file),
  );
});

test("a product detail resource cannot mix unrelated product lines", async () => {
  const fixture = revision("mixed", { mixedProduct: true }),
    transport = network(fixture),
    store = storeFor(transport);
  await store.refresh();
  const valid = store.current;
  await assert.rejects(
    store.loadOffer("protein", "p1"),
    /product|offer|scope/i,
  );
  assert.equal(store.current, valid);
});

test("a lazy result from an older revision is rejected after a successful refresh", async () => {
  const first = revision("first"),
    second = revision("second"),
    transport = network(first, second),
    store = storeFor(transport);
  await store.refresh();
  const started = deferred(),
    release = deferred();
  transport.gates.set(first.resources.products.whey.file, () => {
    started.resolve();
    return release.promise;
  });
  const old = store.loadOffer("protein", "p1");
  await started.promise;
  transport.setPointer(second.pointer);
  await store.refresh();
  release.resolve();
  await assert.rejects(old, /dataset changed/i);
  assert.equal(store.current.config.name, "second");
  assert.equal(store.current.categories.protein.offers.length, 0);
});

test("a refresh follows a guide selection completed while the next revision is downloading", async () => {
  const first = revision("first"),
    second = revision("second"),
    transport = network(first, second),
    store = storeFor(transport, { page: "research", guide: "protein" });
  await store.refresh();
  await store.loadGuide("protein");
  const started = deferred(),
    release = deferred();
  transport.gates.set(second.resources.guides.protein.file, () => {
    started.resolve();
    return release.promise;
  });
  transport.setPointer(second.pointer);
  const refreshing = store.refresh();
  await started.promise;
  const selected = await store.loadGuide("creatine");
  assert.equal(selected.config.name, "first");
  assert.equal(
    selected.research.articles.find(
      (article) => article.category === "creatine",
    )._contentLoaded,
    true,
  );
  release.resolve();
  await refreshing;
  assert.equal(store.current.config.name, "second");
  const committed = store.current.research.articles.find(
    (article) => article.category === "creatine",
  );
  assert.equal(committed._contentLoaded, true);
  assert.deepEqual(committed.process, ["Complete guide second"]);
  assert.ok(
    downloaded(transport).includes(second.resources.guides.creatine.file),
  );
});

test("a slower earlier guide selection cannot replace the scope of the latest completed selection", async () => {
  const first = revision("first"),
    second = revision("second"),
    transport = network(first, second),
    store = storeFor(transport);
  await store.refresh();
  const started = deferred(),
    release = deferred();
  transport.gates.set(first.resources.guides.protein.file, () => {
    started.resolve();
    return release.promise;
  });
  const earlier = store.loadGuide("protein");
  await started.promise;
  await store.loadGuide("creatine");
  release.resolve();
  await earlier;
  transport.setPointer(second.pointer);
  await store.refresh();
  assert.equal(store.current.config.name, "second");
  assert.equal(
    store.current.research.articles.find(
      (article) => article.category === "creatine",
    )._contentLoaded,
    true,
  );
  assert.equal(
    store.current.research.articles.find(
      (article) => article.category === "protein",
    )._contentLoaded,
    false,
  );
});

test("static reading URLs and legacy query URLs infer the same requested content", () => {
  assert.equal(
    pageDataScope(new URL("https://example.com/guide-protein.html"), {
      page: "research",
    }).guide,
    "protein",
  );
  assert.equal(
    pageDataScope(
      new URL("https://example.com/research.html?category=protein"),
      { page: "research" },
    ).guide,
    "protein",
  );
  assert.equal(
    pageDataScope(new URL("https://example.com/article-whey-forms.html"), {
      page: "articles",
    }).article,
    "whey-forms",
  );
  assert.equal(
    pageDataScope(
      new URL("https://example.com/articles.html?article=whey-forms"),
      { page: "articles" },
    ).article,
    "whey-forms",
  );
  assert.equal(
    pageDataScope(new URL("https://example.com/protein.html"), {
      category: "protein",
    }).category,
    "protein",
  );
});

test("valid-hash resources for a different scope do not replace the last valid view", async () => {
  for (const [options, scope] of [
    [{ wrongCatalog: true }, { category: "protein" }],
    [{ wrongGuide: true }, { page: "research", guide: "protein" }],
    [{ wrongArticle: true }, { page: "articles", article: "whey-forms" }],
  ]) {
    const first = revision("first"),
      bad = revision("bad", options),
      transport = network(first, bad),
      store = storeFor(transport, scope),
      statuses = [];
    store.subscribe((_, status) => statuses.push(status));
    await store.refresh();
    const good = store.current;
    transport.setPointer(bad.pointer);
    await store.refresh();
    assert.equal(store.current, good);
    assert.equal(statuses.at(-1).state, "error");
  }
});
