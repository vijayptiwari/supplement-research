import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBundle } from "../scripts/build_site.mjs";
import { createSnapshot } from "../docs/model.js";
import { createOfferDialog } from "../docs/offer-dialog.js";

const snapshotPromise = loadBundle().then(createSnapshot);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function dialogDocument() {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: "",
        textContent: "",
        open: false,
        listeners: {},
        addEventListener(name, listener) {
          this.listeners[name] = listener;
        },
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
          this.listeners.close?.();
        },
      });
    return elements.get(selector);
  };
  return { querySelector: element };
}

test("pack evidence loads only when requested and renders the complete exact-offer evidence", async () => {
  const original = globalThis.document;
  const document = dialogDocument();
  globalThis.document = document;
  try {
    const snapshot = await snapshotPromise;
    const offer = snapshot.categories.protein.offers[0];
    const pending = deferred();
    const requests = [];
    const dialog = createOfferDialog({
      loadSnapshot: (...args) => {
        requests.push(args);
        return pending.promise;
      },
    });
    assert.deepEqual(requests, []);
    const opening = dialog.open("protein", offer.id);
    assert.deepEqual(requests, [["protein", String(offer.id)]]);
    assert.equal(document.querySelector("#evidence").open, true);
    assert.match(
      document.querySelector("#evidence-body").textContent,
      /Loading label and price evidence/,
    );
    pending.resolve(snapshot);
    await opening;
    assert.equal(
      document.querySelector("#evidence-title").textContent,
      `${offer.brand} · ${offer.product}`,
    );
    const markup = document.querySelector("#evidence-body").innerHTML;
    assert.match(markup, /completed quarters/);
    assert.match(markup, /Label basis &amp; data quality/);
    assert.ok(
      markup.includes(offer.priceAudit.sourceUrl.replaceAll("&", "&amp;")),
    );
  } finally {
    globalThis.document = original;
  }
});

test("a slower earlier pack request and a closed dialog cannot overwrite the latest selection", async () => {
  const original = globalThis.document;
  const document = dialogDocument();
  globalThis.document = document;
  try {
    const snapshot = await snapshotPromise;
    const offers = snapshot.categories.protein.offers;
    const first = offers[0];
    const second = offers.find((offer) => offer.product !== first.product);
    const requests = [];
    const dialog = createOfferDialog({
      loadSnapshot: () => {
        const request = deferred();
        requests.push(request);
        return request.promise;
      },
    });
    const firstOpening = dialog.open("protein", first.id);
    const secondOpening = dialog.open("protein", second.id);
    requests[1].resolve(snapshot);
    await secondOpening;
    const latest = document.querySelector("#evidence-body").innerHTML;
    requests[0].resolve(snapshot);
    await firstOpening;
    assert.equal(document.querySelector("#evidence-body").innerHTML, latest);
    assert.equal(
      document.querySelector("#evidence-title").textContent,
      `${second.brand} · ${second.product}`,
    );
    const thirdOpening = dialog.open("protein", first.id);
    document.querySelector("#evidence").close();
    requests[2].resolve(snapshot);
    await thirdOpening;
    assert.equal(document.querySelector("#evidence").open, false);
    assert.equal(document.querySelector("#evidence-body").innerHTML, latest);
  } finally {
    globalThis.document = original;
  }
});

test("variant selection works when the detail resource contains only one product line", async () => {
  const original = globalThis.document;
  const document = dialogDocument();
  globalThis.document = document;
  try {
    const snapshot = await snapshotPromise;
    const category = snapshot.categories.protein;
    const first = category.offers.find((offer) =>
      category.offers.some(
        (other) =>
          other.id !== offer.id &&
          other.brand === offer.brand &&
          other.product === offer.product,
      ),
    );
    const variants = category.offers.filter(
      (offer) => offer.brand === first.brand && offer.product === first.product,
    );
    const next = variants.find((offer) => offer.id !== first.id);
    const focused = {
      ...snapshot,
      categories: {
        ...snapshot.categories,
        protein: { ...category, offers: variants },
      },
    };
    const requests = [];
    const dialog = createOfferDialog({
      loadSnapshot: async (...args) => {
        requests.push(args);
        return focused;
      },
    });
    await dialog.open("protein", first.id);
    document
      .querySelector("#offer-variant")
      .listeners.change({ target: { value: String(next.id) } });
    assert.equal(requests.length, 1);
    assert.ok(
      document
        .querySelector("#evidence-body")
        .innerHTML.includes(`value="${next.id}" selected`),
    );
    assert.equal(
      document.querySelector("#evidence-title").textContent,
      `${next.brand} · ${next.product}`,
    );
  } finally {
    globalThis.document = original;
  }
});
