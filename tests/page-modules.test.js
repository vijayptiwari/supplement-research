import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFormatting, catalogFormula } from "../docs/page-utils.js";

const docs = fileURLToPath(new URL("../docs/", import.meta.url));
const source = (file) => fs.readFile(path.join(docs, file), "utf8");
async function staticGraph(entries) {
  const seen = new Set();
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await source(file);
    for (const match of text.matchAll(
      /(?:import|export)\s+[\s\S]*?\sfrom\s*['"]\.\/([\w-]+\.js)['"]/g,
    ))
      await visit(match[1]);
  }
  for (const entry of entries) await visit(entry);
  return seen;
}

test("home module graph excludes source validators and feature renderers until requested", async () => {
  const graph = await staticGraph(["site.js", "marketplace.js", "seo.js"]);
  for (const name of [
    "model.js",
    "guidance-validation.js",
    "learning-validation.js",
    "research.js",
    "articles.js",
    "recommender.js",
    "search.js",
    "page-audit.js",
    "page-catalog.js",
    "offer-dialog.js",
    "compare.js",
  ])
    assert.equal(
      graph.has(name),
      false,
      `${name} must load only for its feature`,
    );
});

test("all literal lazy imports resolve and ordinary page controllers do not load the complete snapshot", async () => {
  const shell = await source("site.js");
  const imports = [
    ...shell.matchAll(/import\(['"]\.\/([\w-]+\.js)['"]\)/g),
  ].map((match) => match[1]);
  assert.ok(imports.includes("page-catalog.js"));
  assert.ok(imports.includes("offer-dialog.js"));
  assert.ok(imports.includes("compare.js"));
  for (const file of imports) await fs.access(path.join(docs, file));
  assert.doesNotMatch(shell, /loadFull\s*\(/);
  assert.doesNotMatch(await source("page-catalog.js"), /loadFull\s*\(/);
});

test("shared catalog formatting preserves zero values and uses the configured compound for calculations", () => {
  const snapshot = {
    config: { locale: "en-IN", currency: "INR" },
    categories: {
      custom: {
        id: "custom",
        concentrationField: "active",
        referenceGrams: 2,
        compoundLabel: "active compound",
      },
    },
  };
  const { num, money, size } = createFormatting(snapshot);
  assert.equal(num(0), "0");
  assert.match(money(0), /0\.00/);
  assert.match(money(null), /Unknown/);
  assert.equal(size({ category: "custom", kg: 1 }), "1 kg");
  const markup = catalogFormula(snapshot, [
    {
      category: "custom",
      brand: "A & B",
      product: "Example",
      flavour: "Plain",
      kg: 1,
      grams: 1000,
      price: 1000,
      active: 50,
      cost: 2,
      referenceCost: 4,
      rankingEligible: true,
    },
  ]);
  assert.ok(markup.includes("A &amp; B"));
  assert.ok(markup.includes("active compound"));
  assert.ok(markup.includes("50%"));
  assert.ok(markup.includes("2 g comparison portion"));
  assert.ok(markup.includes("÷ (1,000 g × 50% ÷ 100)"));
  assert.ok(!markup.includes("�"));
});
