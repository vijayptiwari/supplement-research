# Editable content sources

The website is built from these files. `dist/data/` is generated output and must not be edited. There are three content directories:

```text
artifacts/
  wiki/
    protein.json
    creatine.json
  articles/
    an-independent-article.json
    series/
      myth-busters/
        _series.json
        <article-id>.json
  products/
    protein/
      avvatar/
        whey-protein.json
    creatine/
      one-science-nutrition/
        100-micronized-creatine.json
    _meta.json
```

The independent-article filename above illustrates where a new article belongs; it is not a published article. Existing articles retain their original series and URLs.

## Wiki

Each `wiki/<supplement-id>.json` owns the category's definition, catalog research date and complete educational guide. `category` defines measurements, filters, comparison units and its public page. `guide` contains processing steps, food quantities, intake context, medical evidence, safety, buying guidance and citations. `catalog` holds the separate product-research date; it must not contain offers. Updating prices does not advance the guide's review date.

Copy an existing compatible wiki file to introduce a category, use a unique category/guide ID and supply appropriately reviewed evidence. The category's `file` and `page` can be omitted to default to `<id>.json` and `<id>.html`. The build reuses the shared page shell; no new handwritten HTML is needed. New nutrient units or calculation semantics still need model support. New categories receive no automatic purchase recommendations without explicit reviewed selection rules.

## Articles

Each article is a JSON object with `schemaVersion: 1` and an `article` payload. An optional `order` controls its position. The payload uses the existing article fields: ID, category, title, introduction, sections, source IDs, author and review date.

- Independent articles live directly under `articles/`; omit `article.series` or set it to `null`.
- Series articles live under `articles/series/<series-id>/`. Its `_series.json` contains `schemaVersion: 1`, optional `order` and a `series` object with `id`, `label` and `description`. The directory supplies article membership; an explicitly supplied series ID must agree.
- The filename must equal the article ID plus `.json`. Existing article URLs remain `article-<id>.html`.

The library discovers article files and series automatically. Citation resolution, unique titles, meaningful content and the configured narrative minimum remain publication requirements. There is no fixed article-count quota for a category.

## Products and pricing

Each `products/<supplement-id>/<brand-slug>/<product-slug>.json` represents one named product line. Category, brand and product names must agree with its location. Use lowercase ASCII slugs; long names use the deterministic `artifactSlug` helper in `scripts/artifact_store.mjs`.

- `variants`: entries with an `offer` object containing the exact pack/flavour, stable ID, current listed price, label inputs, stock and sources. Preserve `null` for unknown values.
- `priceHistory`: entries with an `observation` object containing the full dated exact-variant price evidence. Keep historical evidence, exclusions and provenance; do not manufacture missing quarters.
- `refreshSources`: entries with a `profile` object containing the exact provider selectors and deliberately reviewed label inputs used by the price refresh tool.

These entries may include an optional numeric `order`, retained during migration so existing sorting and evidence ordering remain unchanged. New entries may omit it. Price history is stored as source observations; percentage changes, costs and chart points are calculated rather than stored as authoritative derived values.

`products/_meta.json` keeps ledger dates and any explicit unassigned observations/source profiles. It must not contain duplicate global `observations` or `products` arrays. Changing a product's name or brand requires moving its file and updating every variant's identity together.

## Shared metadata and references

Files directly under `artifacts/` contain shared site settings, brand details, recommender rules, references, research policies and audit/testing ledgers. `manifest.json` registers shared metadata, not individual products, wiki entries or articles. `references.json` is the common citation registry. Product-specific facts and article bodies belong in their content files.

## Validate and publish

```sh
npm run validate:artifacts
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run build
npm start
```

Commit the changed source files. GitHub Actions rebuilds the static site, including search, filters, SEO pages, exports and the atomic browser dataset. Open pages continue to refresh published dataset revisions automatically.

Maintained research tools write back through the artifact store. Python refreshes use an isolated compatibility workspace; imports validate the complete data and reject a stale source revision. The writer also checks for manual edits made during staging. User documentation and media are retained. Retired direct `docs/data` patchers are blocked.

For a manual staged workflow, use `npm run export:data`, edit the exported JSON in `outputs/artifact-export/docs/data/`, then run `npm run import:data`. These exports are temporary and are not another source of truth. Export again if source files changed in the meantime.
