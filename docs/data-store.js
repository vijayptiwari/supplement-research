import { articleIdForLocation, guideIdForLocation } from "./routes.js";

const hashPattern = /^[a-f0-9]{64}$/;
const defaultDigest = async (text) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export function pageDataScope(
  location = globalThis.location,
  body = globalThis.document?.body?.dataset || {},
) {
  if (!location) return {};
  const page = body.page || "";
  return {
    page,
    category: body.category || "",
    guide: page === "research" ? guideIdForLocation(location, body.defaultCategory) : "",
    article:
      page === "articles" ? articleIdForLocation(location, body.articleId) : "",
  };
}

function checkCore(value) {
  if (
    !value?.config ||
    value.config.currency !== "INR" ||
    !Array.isArray(value.config.categories) ||
    !value.categories ||
    !Array.isArray(value.research?.articles) ||
    !Array.isArray(value.research?.editorial?.articles) ||
    !value.stats
  )
    throw Error("Invalid published page data.");
  for (const definition of value.config.categories)
    if (
      !value.categories[definition.id] ||
      !Array.isArray(value.categories[definition.id].offers)
    )
      throw Error("Missing published category.");
  return value;
}

function combine(core, ...patches) {
  let result = {
    ...core,
    categories: { ...core.categories },
    research: { ...core.research, editorial: { ...core.research.editorial } },
  };
  for (const patch of patches.filter(Boolean)) {
    if (patch.categories)
      result.categories = { ...result.categories, ...patch.categories };
    if (patch.category) {
      if (
        !core.categories[patch.category.id] ||
        !Array.isArray(patch.category.offers)
      )
        throw Error("Invalid category resource.");
      result.categories[patch.category.id] = patch.category;
    }
    if (patch.research)
      result.research = { ...result.research, ...patch.research };
    if (patch.recommender) result.recommender = patch.recommender;
    for (const [key, field, identity] of [
      ["guide", "articles", "category"],
      ["article", "editorial", "id"],
    ])
      if (patch[key]) {
        const item = patch[key],
          entries =
            field === "editorial"
              ? result.research.editorial.articles
              : result.research.articles;
        if (
          !entries.some((a) => a[identity] === item[identity]) ||
          item._contentLoaded !== true
        )
          throw Error("Invalid content resource.");
        const articles = entries.map((a) =>
          a[identity] === item[identity] ? item : a,
        );
        if (field === "editorial")
          result.research.editorial = {
            ...result.research.editorial,
            articles,
          };
        else result.research.articles = articles;
      }
    if (patch.sources) {
      const sources = new Map(result.research.sources.map((s) => [s.id, s]));
      for (const source of patch.sources) sources.set(source.id, source);
      result.research.sources = [...sources.values()];
    }
    if (patch.searchIndex)
      result = {
        ...result,
        ...patch,
        config: { ...core.config, ...patch.config },
        categories: { ...core.categories, ...patch.categories },
        research: { ...core.research, ...patch.research },
      };
  }
  return checkCore(result);
}

/** Verified immutable resources are assembled before publishing a new view. */
export function createDataStore({
  fetcher = globalThis.fetch,
  baseUrl = new URL("./data/", import.meta.url),
  digest = defaultDigest,
  scope = pageDataScope,
} = {}) {
  let current = null,
    version = null,
    pending = null,
    manifest = null,
    core = null,
    activeScope = null,
    scopeGeneration = 0,
    guideRequest = 0;
  const listeners = new Set(),
    cache = new Map();
  const emit = (status) => {
    for (const listener of listeners) listener(current, status);
  };
  const read = async (url, cacheMode = "no-store") => {
    const response = await fetcher(url, { cache: cacheMode });
    if (!response.ok)
      throw Error(`Dataset request failed (${response.status}).`);
    return response;
  };
  const resource = (descriptor) => {
    if (
      !descriptor ||
      !hashPattern.test(descriptor.sha256) ||
      !new RegExp("^[a-z0-9-]+\\." + descriptor.sha256 + "\\.json$").test(
        descriptor.file,
      )
    )
      throw Error("Invalid dataset resource.");
    if (!cache.has(descriptor.sha256))
      cache.set(
        descriptor.sha256,
        (async () => {
          const raw = await (
            await read(new URL(descriptor.file, baseUrl), "force-cache")
          ).text();
          if ((await digest(raw)) !== descriptor.sha256)
            throw Error("Dataset integrity check failed.");
          return JSON.parse(raw);
        })().catch((error) => {
          cache.delete(descriptor.sha256);
          throw error;
        }),
      );
    return cache.get(descriptor.sha256);
  };
  const full = async (selectedManifest) => {
    const bundle = await resource(selectedManifest.legacy);
    const { createSnapshot } = await import("./model.js");
    const snapshot = createSnapshot(bundle);
    if (snapshot.quality.errors.length)
      throw Error("Published dataset failed validation.");
    return snapshot;
  };
  async function view(selectedManifest, selectedCore, requested = {}) {
    const r = selectedManifest.resources,
      patches = [];
    if (requested.page === "audit") return full(selectedManifest);
    if (requested.page === "recommender") patches.push(await resource(r.stack));
    if (requested.page === "search") patches.push(await resource(r.search));
    if (requested.category) {
      if (!r.catalogs[requested.category])
        throw Error("Missing category dataset.");
      const category = await resource(r.catalogs[requested.category]);
      if (category.category?.id !== requested.category)
        throw Error("Category resource does not match this page.");
      patches.push(category);
      if (r.guides[requested.category]) {
        const guide = await resource(r.guides[requested.category]);
        if (guide.guide?.category !== requested.category)
          throw Error("Guide resource does not match this page.");
        patches.push(guide);
      }
    }
    if (requested.guide) {
      if (!r.guides[requested.guide]) throw Error("Missing guide dataset.");
      const guide = await resource(r.guides[requested.guide]);
      if (guide.guide?.category !== requested.guide)
        throw Error("Guide resource does not match this page.");
      patches.push(guide);
    }
    if (requested.article) {
      if (!r.articles[requested.article])
        throw Error("Missing article dataset.");
      const article = await resource(r.articles[requested.article]);
      if (article.article?.id !== requested.article)
        throw Error("Article resource does not match this page.");
      patches.push(article);
    }
    if (requested.page === "policy") patches.push(await resource(r.references));
    if (
      ((requested.page === "research" && !requested.guide) ||
        (requested.page === "articles" && !requested.article) ||
        requested.page === "directory") &&
      r.library
    )
      patches.push(await resource(r.library));
    return combine(selectedCore, ...patches);
  }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const pointer = await (
          await read(new URL("version.json?t=" + Date.now(), baseUrl))
        ).json();
        if (
          !hashPattern.test(pointer.version) ||
          ![1, 2].includes(pointer.schemaVersion) ||
          pointer.file !==
            `${pointer.schemaVersion === 1 ? "snapshot" : "manifest"}.${pointer.version}.json`
        )
          throw Error("Invalid dataset version pointer.");
        if (pointer.version === version) {
          emit({ state: "unchanged", version, checkedAt: new Date() });
          return current;
        }
        const descriptor = { file: pointer.file, sha256: pointer.version };
        let next,
          nextManifest = null,
          nextCore = null;
        if (pointer.schemaVersion === 1) {
          nextManifest = { legacy: descriptor };
          next = await full(nextManifest);
        } else {
          nextManifest = await resource(descriptor);
          if (
            nextManifest.schemaVersion !== 2 ||
            !nextManifest.resources?.core ||
            !nextManifest.offerKeys
          )
            throw Error("Invalid dataset manifest.");
          nextCore = checkCore(await resource(nextManifest.resources.core));
          // A guide selection may finish while the next revision downloads.
          // Assemble the latest selected scope before committing that revision.
          let requestedGeneration;
          do {
            requestedGeneration = scopeGeneration;
            next = await view(
              nextManifest,
              nextCore,
              activeScope || (typeof scope === "function" ? scope() : scope),
            );
          } while (requestedGeneration !== scopeGeneration);
        }
        current = next;
        manifest = nextManifest;
        core = nextCore;
        version = pointer.version;
        emit({ state: "updated", version, checkedAt: new Date() });
        return current;
      } catch (error) {
        emit({
          state: "error",
          version,
          message: error.message,
          checkedAt: new Date(),
        });
        return current;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }
  async function pinned(loader) {
    if (!current) await refresh();
    const revision = version,
      selected = manifest;
    if (!selected) throw Error("Dataset is unavailable.");
    const value = await loader(selected);
    if (version !== revision)
      throw Error("The dataset changed. Please try again.");
    return value;
  }
  return {
    refresh,
    loadFull: () => pinned(full),
    loadComparison: () =>
      pinned(async (m) =>
        core ? combine(core, await resource(m.resources.comparison)) : current,
      ),
    loadOffer: (category, id) =>
      pinned(async (m) => {
        if (!core) return current;
        const key = m.offerKeys[JSON.stringify([category, String(id)])];
        if (!key || !m.resources.products[key])
          throw Error("This offer is no longer available.");
        const product = await resource(m.resources.products[key]),
          offers = product.category?.offers || [];
        const selected = offers.find((r) => String(r.id) === String(id));
        if (
          product.category?.id !== category ||
          !selected ||
          offers.some(
            (r) =>
              r.category !== category ||
              r.brand !== selected.brand ||
              r.product !== selected.product,
          )
        )
          throw Error("Product resource does not match this offer.");
        return combine(
          core,
          product,
          m.resources.guides[category]
            ? await resource(m.resources.guides[category])
            : null,
        );
      }),
    loadGuide: async (category) => {
      const request = ++guideRequest;
      const requested = { page: "research", guide: category };
      const next = await pinned((m) =>
        core ? view(m, core, requested) : current,
      );
      if (request === guideRequest) {
        activeScope = requested;
        scopeGeneration++;
      }
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get current() {
      return current;
    },
  };
}

export const dataStore = createDataStore();
export function watchData(onSnapshot, onStatus) {
  let last = null,
    timer;
  const unsubscribe = dataStore.subscribe((snapshot, status) => {
    if (snapshot && snapshot !== last) {
      last = snapshot;
      onSnapshot(snapshot);
      clearInterval(timer);
      timer = setInterval(() => {
        if (!document.hidden) dataStore.refresh();
      }, snapshot.config.refreshIntervalMs);
    }
    if (!timer)
      timer = setInterval(() => {
        if (!document.hidden) dataStore.refresh();
      }, 60000);
    onStatus?.(snapshot, status);
  });
  const focus = () => {
    if (!document.hidden) dataStore.refresh();
  };
  window.addEventListener("focus", focus);
  window.addEventListener("pageshow", focus);
  document.addEventListener("visibilitychange", focus);
  dataStore.refresh();
  return () => {
    unsubscribe();
    clearInterval(timer);
    window.removeEventListener("focus", focus);
    window.removeEventListener("pageshow", focus);
    document.removeEventListener("visibilitychange", focus);
  };
}
