# Supplement Research — India

[Website](https://vijayptiwari.github.io/supplement-research/) · [GitHub project](https://github.com/vijayptiwari/supplement-research)

Research across protein, creatine, amino acids, pre-workouts and counted supplement categories from dated public product listings, labels and archived prices. The website is a static app powered by one validated dataset revision. Counts, filter choices, ranges, rankings, costs, evidence coverage, trend colours, dates, examples, metadata and downloads are derived from that revision. No quarterly UI edits are needed.

## File-based source architecture

All editable product and content data lives in [artifacts/](artifacts/README.md):

```text
artifacts/
  wiki/<supplement-id>.json
  articles/<independent-article-id>.json
  articles/series/<series-id>/_series.json
  articles/series/<series-id>/<article-id>.json
  products/<supplement-id>/<brand-slug>/<product-slug>.json
```

Wiki files own category definitions and complete education guides. Product files own exact variants, dated price observations and refresh-source profiles. Articles can belong to a series or stand independently. The build discovers these files without a hand-maintained content list. Existing public URLs are preserved. Shared references, site settings, policies and audits are metadata files directly under `artifacts/`.

## Quarterly update workflow

1. Edit the relevant `artifacts/products/<supplement>/<brand>/<product>.json`. Retain stable exact-offer IDs; assign new IDs to different variants. Prices and label inputs live under `variants[].offer`.
2. Append exact dated evidence to that product's `priceHistory[].observation`. Keep old evidence and explicit exclusions. Update the category's separate product `catalog.checked` date in `artifacts/wiki/<supplement>.json`; do not redate its guide unless the education was actually reviewed.
3. Keep missing nutrition as `null`, with source URLs and limitations. Energy is **kcal per 100 g** for the relevant powder fields. Label-serving amounts, elemental mineral content and chemical compound mass remain distinct.
4. Run `npm run validate:artifacts`, `npm test`, `python -m unittest discover -s tests -p 'test_*.py'` and `npm run build`. Inspect `dist/data/quality-report.json` and preview with `npm start`.
5. Commit source changes and push to `main`. GitHub Actions validates and publishes `dist/`. No quarterly UI edits are needed.

Maintained catalog, archival-price and Trustified import tools write through the artifact store. Staged updates reject concurrent manual edits, retain unrelated content and preserve label-review dates. [The source guide](artifacts/README.md) documents new categories, articles, products and the staged export/import workflow.

Open visible pages check for a published revision every minute, when returning to the tab and through **Refresh data**. They assemble the resources needed for the current page from one validated revision and retain existing controls. Invalid or incomplete updates keep the last valid view. This refreshes published research, not merchant checkout prices.

## Source files and calculations

- `artifacts/wiki/`: category measurement definitions, product research dates and complete education guides.
- `artifacts/products/`: product variants, label inputs, price evidence and refresh profiles, grouped by supplement and brand.
- `artifacts/articles/`: independent articles and file-defined series.
- `artifacts/site.json`: display, currency, freshness and polling policies; categories are discovered from wiki files.
- `artifacts/references.json` and `research-policy.json`: shared citations and editorial/clinical/intake policies.
- `artifacts/brands.json` and `recommender.json`: optional brand details and reviewed selection policies.
- `docs/model.js`: complete source validation and normalization at build time and for the full audit dataset.
- `scripts/browser_datasets.mjs`: generates summary, category, article, guide, product-detail, search and tool resources from the validated source model.
- `docs/data-store.js`: verifies hashes, loads the current page's resources and commits complete views from one revision.
- `docs/site.js`: shared shell with lazy page controllers; display helpers are separate from source validators.

`dist/data/` contains generated compatibility exports, immutable browser resources and their manifest. The old editable `docs/data/*.json` collection has been migrated and removed; editing a generated export does not update the sources. The archived Excel workbook is retained.

Compound cost = price / (net pack grams × labelled percentage / 100). Powder cost = price / net pack grams. Comparison-portion cost = compound cost × the configured reference grams. The portion is not the manufacturer's scoop or intake advice. Protein per scoop uses the recorded scoop weight and concentration. Missing energy stays unknown, including on the homepage; a recorded zero remains zero.

Rankings use **grams of labelled compound per ₹100**, with the best eligible pack per brand and product. Eligibility requires known concentration, confirmed in-stock status and a matching recent dated price. This is a cost comparison, not an assessment of efficacy or independent laboratory quality. Different creatine chemical forms are not assumed equivalent. Shared label profiles and conflicts are disclosed, not silently resolved. Stored legacy `cost`, `doseCost`, `score` and `trend` values are ignored and recalculated.

## Twelve-quarter price history

The audit uses the **12 completed calendar quarters** before each category research date, plus a separately labelled current observation. The window rolls automatically with the dataset date; `historyQuarters` in `site.json` controls its length. Every offer retains a slot for every requested quarter, including explicit unknowns.

Each completed-quarter price is the latest verified, exact-variant dated snapshot available in that quarter. Quarter-on-quarter percentages require two adjacent verified snapshots; gaps are never interpolated or carried forward. A current-versus-oldest endpoint comparison is labelled separately and does not imply complete intervening evidence. A full-window change is recorded only when all requested historical quarters are verified. Current price evidence must also belong to the research date's current calendar quarter.

The website shows coverage per category and quarter, per-offer timelines and charts with visible gaps, historical-coverage filters, and source evidence. `dist/data/price-history.csv` and `price-history.json` contain one row per exact offer and quarter, plus current observations. The existing `price-audit.csv` remains the latest-quarter change summary. Missing prices remain null in JSON and empty in CSV, never zero.

To collect public archival evidence for the full window:

```sh
python scripts/research_price_history.py --quarters 12 --alternatives 2 --structured --workers 4
npm test
npm run build
```

The collector searches HTML captures and optional archived product JSON/JS feeds through the [Internet Archive CDX API](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server), follows index pagination, checks capture timestamps, and accepts prices only when an exact variant or SKU can be matched. Local response caches support repeatable review and retries. Use `--cached-only --alternatives 2` for an offline re-audit, or `--skip-known-failures` when trying additional capture dates without repeating already failed requests. Previous manual exclusions are retained. `artifacts/history-research.json` records attempted public sources, archive retrieval failures and quotes collected per quarter; a failed lookup or absent archive is not proof of a product launch date. Review the research log and exclusions before publishing. Incomplete index queries are explicitly flagged, and incomplete historical coverage is shown on the site.

## Price evidence and trends

Each observation includes `category`, `offerId`, ISO `date`, numeric `price`, `currency: INR`, exact official `sourceUrl`, public `evidenceUrl`, and `kind` (`official-live` or `official-archive`). Preserve `variantId` and `matchBasis` where available. Historical evidence accepted for comparison has `kind: official-archive` and `qualityStatus: verified`; excluded quotes retain `qualityStatus: excluded` and `exclusionReason`. A former live observation is not automatically promoted to publicly verified historical evidence.

The latest official-live observation must match the catalog price and fall within the configured age window relative to the category research date. Missing, conflicting or stale observations cannot verify a price. The previous completed calendar quarter is calculated from each research date, including year rollover. The latest eligible verified observation in that quarter is the baseline. Every displayed change has two dated sources; missing history is never interpolated or treated as unchanged. These are listed-price snapshots, **not quarterly averages**.

Green = decrease, red = increase, blue = verified unchanged, grey = no verified comparison. Group summaries disclose mixed directions and partial coverage. Unverified current catalog prices have an amber marker and are excluded from rankings. Unknown concentration is excluded from compound-cost comparisons. The freshness threshold is a research policy, not a promise that prices remain valid for that duration.

Prior synthetic history generators remain disabled. Existing research scripts can help collect inputs, but their output must be checked for exact weight/flavour/SKU matches. Never substitute MRP discounts, another variant or a current page for dated historical evidence.

## Build, exports and hosting

Use Node 22+ and Python 3 for the preview server:

```sh
npm test
npm run build
npm start
```

Open http://localhost:8080. Serve **`dist/`**, not `docs/` directly: the build creates the version manifest and validated snapshot. No application dependencies, backend or API keys are required.

The build produces normalized catalog JSON, price-audit JSON/CSV, a field-level quality report and dataset-driven SEO/JSON-LD. A small `version.json` points to an immutable `manifest.<sha256>.json`, which lists hashed page resources. Home pages load summaries; readers load the current guide or article; catalogs load one category; exact pack details load one product line. Search and the stack builder have their own projections. The complete `snapshot.<sha256>.json` remains available for the audit view and compatibility. The browser verifies resource hashes before atomically replacing a view, keeping revisions separate and rejecting stale asynchronous results. Generated exports support offline auditing; the website has no export controls. JSON download files belong to the latest deployed build. Original dated Excel workbooks remain archival files and are not presented as current downloads; editing a workbook alone does not update the website.

Run `npm run measure:payloads` after building to write `outputs/browser-payloads.json`. It measures uncompressed JSON bytes and the entry module's static import graph, not browser timing or Core Web Vitals. Add valid artifacts, validate and publish to update content without changing UI code; new calculation units or recommendation policies still need reviewed code.

`.github/workflows/check.yml` runs tests and the build before deploying the Pages artifact. GitHub Pages must use **GitHub Actions** as its build source. A rejected update leaves the last successful deployment available. Generated `dist/` is ignored by Git; edit source inputs rather than generated bundles. Relative paths support the repository subpath.

## Data quality priorities

The coverage panel and quality report identify missing concentration, energy and scoop values, price evidence gaps and nutrition notes requiring review. Complete those fields from exact-variant labels first, archive dated merchant evidence for future comparisons, and keep source/research dates explicit. Recorded manufacturer claims are not independent lab verification. Sold-out offers and uncertain stock remain searchable but do not enter rankings. No pack price is inferred from another size.
Deployment follows the [GitHub Pages custom workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).


## Count-based supplement categories

Ashwagandha, Fish Oil, Vitamin D, Magnesium, ZMC, Glutathione, Melatonin, Biotin, Vitamin C, Vitamin B and Folic Acid / Folate use counted packs, not inferred kilogram prices. Per-product `refreshSources` entries record curated official product handles, label sources, serving basis and separate label-check dates. Raw category files and the observation ledger supply all displayed prices, counts, nutrient amounts, filters and calculations.

Refresh official prices with `python scripts/build_additional_catalog.py --as-of YYYY-MM-DD --refresh`, review changes and exact pack counts, then run tests and build. To update selected categories only, append `--categories glutathione melatonin`; other category files and research dates stay unchanged. Review labels separately before changing their check dates. This is a quarterly research update workflow, not a live merchant checkout-price feed; deployed dataset revisions refresh automatically in the browser.

Amounts refer to the stated label serving. Fish oil comparisons use verified EPA+DHA rather than total oil; Vitamin D converts 1 microgram to 40 IU; mineral comparisons use explicitly elemental amounts, with compound masses stored separately. Ashwagandha material and extract classes remain distinct, and withanolides require a verified standardized extract amount. ZMC requires all three named minerals and compares serving costs without combining mineral masses into an efficacy score. Glutathione costs use declared glutathione rather than a blend total or precursor amount. Melatonin costs use the exact labelled strength and serving basis; release formulations and combination ingredients are distinct profiles. Biotin uses micrograms and Vitamin C uses milligrams. Vitamin B keeps individual vitamins and B-complex profiles distinct: `declaredNutrients` lists the vitamin keys claimed by each offer, and the complete-label filter checks those keys rather than demanding all B vitamins in a single-vitamin product. No combined B-vitamin mass or potency score is calculated. Nutrient fields can define `costQuantity` to calculate, filter, sort and compare separate vitamin costs; all such costs are rederived from price, pack count, label serving and the declared amount. Folic acid mass, methylfolate mass and micrograms DFE remain separate with no implicit conversion. Lower ingredient cost is not a measure of absorption, sleep benefit or suitability. Reference quantities are comparison units, not intake recommendations.

Unknown serving sizes, conflicting labels and uncertain elemental amounts remain null. Historical slots for new categories remain unverified until exact-variant dated public evidence is found. No past prices are generated from current prices. Every offer exposes official price and label sources in its evidence dialog.


## Amino acids and pre-workout products

L-Arginine, L-Carnitine, BCAA, EAA and Pre-workout use the same label-serving model with `supportsPowder: true`. Counted products use `packCount` / `servingUnits`; powder products use verified net `grams` / `servingGrams`. Powder label servings per pack = net grams / serving grams. Pack price divided by those servings gives serving cost; labelled milligrams per serving supply the ingredient-cost denominator. Marketed serving counts and scoop weights are never inferred. Powder energy per 100 g is calculated only from known kcal per serving and serving mass.

Free L-carnitine and the full mass of tartrate or acetyl compounds remain separate; compound costs apply within the stated chemical form. BCAA are a subset of EAA and are not added to the EAA total. Pre-workout costs compare label servings without a combined potency score. Total caffeine and caffeine anhydrous component amounts are separate: botanical caffeine that is not quantified leaves the total unknown. Caffeine status is a filter, not a claim that every stimulant is absent. Citrulline malate mass is not converted to free citrulline. All comparison quantities are accounting units, not dose advice.

The importer requires exact `variantIds` or `variantTitles` for powder profiles so one variant cannot inherit another pack's weight. Each curated profile preserves flavour, form, label basis, label dates and sources. Refresh selected prices with `python scripts/build_additional_catalog.py --as-of YYYY-MM-DD --refresh --categories l-arginine l-carnitine bcaa eaa pre-workout`, then review changes, run checks and deploy. Unknowns and conflicting labels stay explicit; new historical quarters remain empty until dated public sources verify them.

The stack builder's performance-claims review includes all five categories without automatically selecting products or quantities. It explains overlap among complete protein, BCAA and EAA, and possible duplicate creatine, arginine and caffeine exposure in pre-workouts. It does not calculate a daily stimulant total or prescribe a regimen.

The additional Citrulline, Beta-Alanine, Taurine, Betaine and HMB catalogs use the same dataset-driven serving model. Citrulline includes free L-citrulline and citrulline malate under one category, with chemical-form and declared-ratio filters. Free citrulline and malate compound masses stay separate. Betaine anhydrous / TMG and betaine HCl stay separate, as do declared HMB payload, calcium HMB compound and HMB free acid. No presumed molecular ratios, absorption multipliers or equivalence between these forms enter the cost formulas. Unknown payloads stay null even when a compound amount is known; each known compound has its own clearly labelled cost comparison.

Official non-Shopify product families can use `kind: jsonld` source profiles with a canonical `productUrl`, exact `variantSku` and exact `variantUrl`. The importer accepts the matching ProductGroup variant only, validates INR and a positive price, checks a declared structured weight against the curated pack, and rejects missing or conflicting matches. It never substitutes an aggregate family price or another SKU.

Their guides and stack review distinguish mechanisms from demonstrated outcomes, explain pre-workout overlap and keep suitability and dose decisions separate from label-cost comparisons. Update their exact source profiles and observations with `--categories citrulline beta-alanine taurine betaine hmb`; each category retains its own price and label dates.

## Articles and research

The wiki/article files and shared research metadata contain the category guides, editorial review dates, selected reference metadata, summaries and limitations. It is bundled into the same content-addressed dataset as the catalogs, so editing the data and publishing a validated build updates the reading library without editing UI components. `research.html` supports category, topic and reference-type filters, with shareable query parameters. Catalog pages link directly to the relevant guide collection.

This is curated educational coverage, not a systematic review or a brand endorsement. Preserve population, formulation, outcome and safety context. Check original sources and disclosures, update review dates only after review, and distinguish publication years from the date a reference was checked. Dataset validation rejects unsafe source URLs, duplicate IDs and unresolved citations. Avoid extrapolating component evidence to ZMC combinations or one extract to all Ashwagandha products.


## Supplement stack recommender

`recommender.html` provides goal presets, requirements, existing-category checks and a total upfront pack budget. Rules and explanatory evidence live in `artifacts/recommender.json`, bundled with the catalog and research dataset. `docs/recommender.js` evaluates those rules and current verified, in-stock offers. It is a transparent rules-based tool, not an AI diagnosis or a dosing engine.

Protein requires a self-identified dietary gap. Creatine candidates are pure unflavoured monohydrate; fish oil requires verified serving and EPA+DHA inputs. Stress, mineral, melatonin, glutathione and micronutrient categories provide educational review rather than automatic product picks. Underage, pregnancy/breastfeeding, medicines, health conditions and uncertain contexts pause product shortlists. Existing categories are not suggested again; ZMC and B-complex / biotin / folate overlap are explained. Ingredient preferences are not vegan or allergen certification.

Users explicitly select exact packs; combined totals use current dataset prices and disclose budget overruns. No pack is added automatically. This is an upfront purchase total, not monthly consumption or a personalized regimen. Answers are held in page memory and are not serialized to a URL or local profile. Dataset refreshes re-evaluate eligible choices. Update policy evidence and review dates deliberately, run validation and tests, then deploy.


Guides also include sourced `bodySteps`/`bodySources`, `treatment`, `whoMayBenefit`, `routineUse` and `sectionSources`. Explain mechanisms separately from demonstrated outcomes, distinguish treating a deficiency from curing an unrelated disease, and distinguish needing a nutrient from needing a supplement. Do not infer that every member of a risk group has a deficiency. Routine pediatric guidance must not be translated into adult catalog product recommendations. Validation checks these sections and their citations; topic search includes the new text.


## Education-first marketplace experience

All live pages now load `docs/marketplace.css` as their single presentation system. The earlier stylesheets remain in the repository for history but are not linked by current pages. The shared header provides global search, primary journeys and visible supplement-category navigation. Home discovery content is rendered from the category, research and price datasets by `docs/marketplace.js`.

`search.html` searches guides and exact product variants together. Search family prices distinguish verified in-stock offers from unavailable or unverified quotes. Checkbox facets support searchable option lists without modifier keys. Catalog cards show an explicit representative pack selected by evidence and stock status before price; active filters are individually removable. Category illustrations are labelled and do not impersonate manufacturer packaging or independent product tests.

`docs/compare.js` keeps up to three exact offers from one category for the current browser-tab session. Only public category/offer identifiers are stored; prices are reloaded from the validated dataset, and stack-builder health answers remain in memory. Comparison includes labelled nutrient units, price/stock observation dates and source links; it does not produce an efficacy score. Dataset updates reconcile selections. `docs/recommender.js` uses a goals → requirements → review workflow with explicit eligibility/allergy answers, existing-category overlap checks, searchable optional pack selection and current upfront totals. Product suggestions remain separate from clinical review.

The research reader retains all clinical sections and references and links directly to matching product catalogs. Guide text matches retain their cited references even if the cited title does not contain the search term. Every new module and page is included in the existing validation, fingerprinting and deployment workflow.

## Suitability, foods and purchase priority

Every current research article includes a `buyingGuide` in the wiki/article files and shared research metadata: who can consider it, who should review use first, a food-source summary, individual foods marked `direct`, `precursor` or `different-form`, and source IDs. An empty food list is valid only with an explanatory summary, such as no ordinary food equivalent for a botanical extract. Do not imply that precursor foods or different chemical forms supply a supplement-equivalent amount.

`valuePolicy` defines the five-level editorial purchase-priority scale and its routine-use baseline. Each guide stores separate `routineScore` and `targetedScore` values, a named `targetedUse`, formulation/population `scope`, reasoning, worth/skip conditions and supporting references. These numbers are editorial judgments, not clinical trial results, a validated risk score, laboratory certification or brand-quality ratings. A high targeted rating does not establish that a visitor has that need or that every product in the category fits it.

The reader exposes audience, food and value sections; the library filters by purchase context and minimum priority. Catalog primers and all exact-offer dialogs link to the same category assessment with its scope. Food and suitability searches find guides without changing ingredient matches for products. `docs/guidance.js` renders the shared content; no category-specific values live in UI code. Update the data and its editorial review dates, check the citations and run validation before publication. Missing policies, out-of-range scores, incomplete conditions and unresolved references prevent deployment. Published revisions update the guidance and filters through the existing dataset refresh path.


## Food amounts, intake references and combined stack review

Every current guide has source-linked food quantities (or an explicit quantity gap), an `intakeGuide` and a `medicalGuide` in the wiki/article files and shared research metadata. Exact food preparation and the original serving basis are preserved. USDA entries retain NDB identifiers. Dry laboratory samples, precursors, natural folate and different forms are explicitly labelled; none is silently converted into an equivalent supplement dose.

`intakePolicy` contains expandable training profiles and adult age bands. Use goal and workload rather than invented dosing tiers for 2/3/5 sessions or beginner/advanced training. US NIH/National Academies RDA/AI references are explicitly distinguished from Indian recommendations, studied supplemental protocols and safety ceilings. Body mass is optional; no default mass or daily product quantity is assigned. `medicalPolicy` separates established indication-specific care, supportive use, mixed findings and unestablished treatment claims. Disease terms retrieve education, never automatic product treatments. Citations, units, ranges, context and serving bases are validated before accepting a dataset revision.

The stack review embeds the same suitability, purchase priority, quantified foods, intake, medical evidence and safety sections used by the reader. Checked existing categories appear even when outside the selected goals. A healthy adult may record one exact existing pack per category for arithmetic only; this never turns a review-only category into a product recommendation. Existing packs do not enter the new-purchase budget. Exact identifiers and quantities stay in memory, refresh against new dataset values and clear on reset.

`docs/stack-audit.js` computes label ingredient subtotals, daily pack cost and duration only from explicit daily product amounts. Powder uses grams; counted products use individual units divided by the verified label serving. Vitamin D IU/µg is counted once. Compound masses remain separate from elemental/free amounts, and different product salt/material masses are not summed as equivalent. EPA+DHA, EAA/BCAA and component rows are overlapping measures; no grand ingredient-mass total is shown. Unknown quantity, serving, payload or caffeine total remains a visible gap; known subtotals with missing contributions are lower bounds. Only exceedances of sourced ceilings/benchmarks are flagged, never a declaration that a stack below a limit is safe. Food, other drinks/products and medicines are not a complete diet or interaction assessment. The audit is arithmetic, not a dose schedule, diagnosis or individual medical recommendation.


## Education before products

Generic supplement navigation, home category cards and catalog learning links open the full category guide at its basics. Explicit product-search and comparison routes remain available. Within a guide, the only link to that category's catalog is the final product handoff after the educational chapters and references. Section navigation can jump to the handoff without imposing a reading gate. Switching the guide dropdown clears a stale search/fragment and brings the new masthead into view.

Each `buyingGuide.practices` contains sourced do/don't actions. The reader and stack review render the same actions and buying explanations. `recommender.productPolicy` holds the common and category-specific purchase checks; `docs/product-policy.js` evaluates that definition, and the education renderer explains the same check IDs and parameter values. These filters cover recorded price evidence, stock, field validation, budget, known label amounts and applicable form/diet/allergy criteria. Need and health-context gates remain part of the surrounding stack policy. Only the categories explicitly eligible for automatic shortlisting receive product suggestions; review-only categories retain a clear manual-review explanation.

Active-content and serving-cost formulas explain price comparisons without treating greater strength or lower cost per milligram as better clinical value. Label validation and declared concentration do not establish laboratory purity, authenticity or individual suitability. Eligible offers remain ordered by upfront pack price. Changes to shared criteria or practical guidance are validated before the dataset can be published, and the existing revision refresh updates guide and stack explanations together.

## Illustrated pathways and editorial series

All category guides have a `pathway` in the wiki/article files and shared research metadata: a title, summary, up to three labelled tracks, three or four steps per track (`label`, `detail`, `compartment`, `icon`), an interpretation caveat and `sourceIds`. Optional `returnLabel` denotes an evidenced recycling route, not a generic feedback arrow. `pathwayPolicy` states the limits of these simplified diagrams. Combination products use parallel ingredient routes, while uncertain mechanisms remain explicit. `docs/pathways.js` draws accessible native SVG illustrations, with horizontal and vertical layouts selected by available content width; the text mechanism remains available. Sources must resolve and belong to the parent guide before publication.

The selector and contents share one sticky guide rail. The original controls move into that rail without cloning IDs or losing event bindings. On narrow screens the compact supplement selector stays above collapsible contents; measured header/navigation heights keep chapter anchors visible.

`articles.html` publishes the editorial series declared in `research.editorial.series`; entries live in `research.editorial.articles`, separate from the category guides in `research.articles`. Each entry has a unique slug, category, series, title, summary, introduction, author, review date, sourced sections and an explicit source list. `myth-busters` requires exactly ten individually explained and cited claims. `understanding-types` requires individually sourced form comparisons: `name`, `kind` (`ingredient` or `delivery`), `description`, `metabolism`, `evidence`, and `value`. The distinction prevents a gummy, capsule, micronized material or powder from being automatically treated as a superior chemical form. Keep processing details and outcomes qualified to the exact formulation and studied population.

Publish a new article by adding its data and any verified references to the registry, then running the normal validation/build/deploy. The library counts, filters, computed reading times, related links, global education search, homepage series, sitemap entries and reader citations derive from this dataset. Articles reuse the current category pathway rather than maintaining another physiology copy. A quarterly data publication refreshes these values through the same validated snapshot mechanism; no article body or series count belongs in a UI component. Original citations and their limitations appear in the reader. Publication rejects incomplete series entries, broken references, invalid form kinds and malformed pathway data; failed refreshes retain the last valid dataset.

## Cross-category comparisons and information-only supplements

Editorial entries may include `relatedCategories` (unique existing category IDs, excluding their primary category). The same comparison is discoverable under each relevant topic in article filters, guide reading suggestions, global education search and stack reading links. Facet counts count membership; the global search total counts each article once. The optional `comparison` overview defines a title, keyed columns and individually sourced rows, rendered as a desktop table and mobile cards. Values, citations, related topics and source membership are validated with the snapshot.

Unpublished categories can use an information-only mode: `measurement: "education"`, `educationOnly: true`, an empty offers array and an explicit dated scope. It has a full guide, pathway, food quantity gaps, intake and medical context, do/don't guidance, value checks and a review-only stack rule. This mode rejects offers and price observations and cannot obtain automatic product suggestions. Its landing page opens education; learning links replace a product handoff until a separate product audit is published. Adding a category to the knowledge library does not manufacture product prices, historical coverage or a universal dosing target.

## Dedicated reading coverage

`research.editorial.coveragePolicy` declares the minimum and maximum number of dedicated articles per configured supplement, the minimum narrative reading length and the reviewed editorial scope. A related-category tag helps discovery but never replaces a dedicated article. Validation rejects a newly introduced coverage gap, duplicate titles or entries below the declared reading minimum; it continues to require resolved citations for every section, claim, form and comparison row. These checks enforce completeness, while editorial review must still assess accuracy, relevance, study limits and distinct reader value.

The library derives its topic counts from `docs/editorial-model.js`, distinguishes dedicated and related articles in topic choices, and initially shows 12 matching articles with an accessible show-more action. Filters reset the visible window; accepted dataset refreshes preserve the filter controls and visible limit. The practical-guides series focuses on specific decisions such as interpreting a label, evaluating a claim, avoiding ingredient overlap or deciding whether a supplement addresses a real need. Category guides, stack reading links, search, reading times and source lists continue to use the same dataset.

## Cited synthesis and technical SEO

The evidence-in-context series adds one distinct article for each category. Each entry connects multiple relevant sources and includes individually sourced `evidenceNotes`: finding, design, population, outcome and limits. These distinguish an acute response from a long-term outcome, a biomarker from a clinical benefit and a combined formula from one ingredient. Validation requires at least two complete notes and three sources for this series. Checked dates describe a source review, not a claim of independent clinical peer review.

`npm run build` generates full reading HTML from the validated snapshot using the same article/guide renderers as the browser. Canonical pages are `article-<id>.html` and `guide-<category>.html`; no article body is duplicated into a handwritten page. Quarterly publications rebuild all static content, metadata, word counts, source links, topic directories and the sitemap. Browser refresh continues to update published snapshots without mixing revisions.

`library.html` exposes every article through ordinary links, grouped by supplement, so the complete library does not depend on a crawler clicking Show more. The homepage, article index, guide index and product tables are also readable before JavaScript. Legacy query-style reading URLs and the Collagen education alias navigate to canonical pages while preserving section anchors and extra controls. These are client navigations on GitHub Pages, not HTTP 301 redirects.

Each reading page has an absolute canonical URL, a specific title/description, Open Graph/Twitter metadata, Article and Breadcrumb structured data, honest organizational authorship and original citations. A review date is `dateModified`; `datePublished` is emitted only when explicitly recorded. No clinician credentials, aggregate product ratings or rich-result eligibility are invented. The editorial-policy page explains AI-assisted research/drafting, source selection, evidence limits, data checks and public corrections.

Search and filtered variants carry noindex metadata and retain the base canonical. The sitemap contains canonical indexable pages only, with source review dates. The project publishes a robots file and sitemap, but GitHub project Pages cannot place this repository's robots.txt at the host root. No Search Console submission or indexing/ranking result is implied. An owner can submit `https://vijayptiwari.github.io/supplement-research/sitemap.xml` in Search Console. These choices follow Google's [JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [article structured-data documentation](https://developers.google.com/search/docs/appearance/structured-data/article) and [robots.txt location requirements](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt).

`tests/seo.test.js` checks complete pre-JavaScript reading content, discoverable links, metadata/citations, canonical routes, sitemap coverage, legacy compatibility, noindex variants and local assets. Collagen uses the shared tone class across home cards and guide illustrations rather than a separate unstyled fallback.

## Product research refresh: 19 November 2026

The catalog now contains 1,248 exact offers across 41 brands and 24 categories. This audit added 77 offers and reverified 1,167 of the 1,171 previous exact prices; unresolved packs retain their earlier evidence dates. Source snapshots and individual product research are compiled in `artifacts/catalog-research.json`; the small snapshot summary drives the public audit section without making every visitor download the full research log. `catalog-data-requirements.json` defines shared and category-specific requirements, and records excluded pricing/identity cases. These are selected public-source checks, not independent ingredient assays or proof of authenticity.

Price observations and label checks remain separate. 80 label profiles were reviewed on the audit date, including explicit gaps and conflicts. Examples include actual biotin versus botanical extract mass, elemental versus compound mineral quantities, free amino acids versus salts, and native type II collagen versus hydrolysed peptides or mixed complexes. Additional declared ingredients outside the modeled nutrient keys appear in pack details and are flagged in stack arithmetic rather than counted as zero.

Collagen now has four independently sourced retail offers: peptide powders and hydrolysed mixed-complex powder/capsules. The full guide remains the default education-first route, with product exploration at its end. Peptide mass and mixed-complex mass have separate cost fields; neither substitutes for complete protein or native type II potency. Collagen remains review-only with no automatic buying suggestion or assigned quantity. The generic education-only mode remains available for future categories without audited offers.

`merge_catalog_research.mjs --as-of YYYY-MM-DD fragment.json ...` validates reviewed fragments before writing, preserves stable offer IDs and existing historical observations, and publishes the audit summary. Source profiles pin exact Shopify IDs, ProductGroup variants or Magento child/options. The importer fails closed on unknown providers and rejects aggregate or ambiguous prices. Magento sources require every option, exactly one child, positive INR finalPrice, tax-inclusive evidence and matching net powder weight; child stock stays unknown when unavailable. Do not infer historical prices, broaden clinical eligibility or convert unsupported liquid products to powder/count units.

## HealthKart marketplace enrichment: 20 November 2026

The follow-up adds 117 category entries, bringing the catalog to 1,365 entries across 42 brands, including MuscleTech. It covers omitted HK Vitals ranges, MuscleBlaze/Fuel One performance products, new protein packs, and selected MuscleTech/GNC marketplace listings. Existing protein and GNC labels were refined from exact selected-pack panels. Cross-listed multivitamin packs can appear in several relevant nutrient categories; category-entry totals are not unique retail SKU counts.

HealthKart is recorded as a retailer, separately from the brand and disclosed seller. Ten independently dated marketplace quotes appear in pack details without replacing manufacturer prices, cost rankings or historical observations. New retailer-sourced primary packs identify HealthKart explicitly. Contradictory advertising images do not override the actual composition panel: examples include GNC EPA/DHA claims, EAA totals, creatine concentration, botanical extract versus biotin payload and collagen co-nutrients. Unknown amounts and conflicts remain visible.

The `hk-product` importer reads public `__NEXT_DATA__` JSON from HK Vitals and HealthKart-platform pages. It checks the exact product, source brand, publication flags, selected variant ID, complete attributes, actual pack size and unconditional INR price. Membership/coupon prices, ignored selectors and wrong-product responses fail validation. Rounded pounds need separately reviewed explicit gram-weight label evidence. One Fuel One page currently has exact public JSON-LD evidence but no supported automatic refresh profile; it needs a manual check until its new page format is supported.

Partial refreshes merge stable IDs into the configured category file, preserving unrelated offers and retailer quotes. Cumulative audit reports retain the preceding whole-catalog review and each source's actual date. Quarterly price refreshes do not advance label-review dates. Protein formulas with pharmacologically active additions or unquantified caffeine remain available for manual review and are excluded from automatic purchase shortlists.

## Nutrabay enrichment: 20 November 2026

Added 55 new pack listings appearing as 70 category entries, bringing the catalog to 1,435 entries across 45 brands. The reviewed selection includes Nutrabay protein, creatine, amino acids, pre-workouts and wellness formulas, plus selected Isopure, OSOAA, Miduty and GreenOpia listings. Both existing Nutrabay beta-alanine IDs were retained and refreshed. A separate Nutrabay quote corroborates the existing GNC 60-softgel pack without replacing its manufacturer price or duplicating the pack.

The `nutrabay-product` source reads only the exact selected `getVariantDetails` record from public server-rendered JSON. It checks product/variant IDs, SKU, brand, slug, full attributes, explicit net mass/count, publication state, ordinary INR `sale_price` and stock. Family defaults, parent minimums, combo prices, coupons and unrelated redirection links are excluded. Selected unit counts are not confused with serving counts. A rounded kg detail table can be resolved only with an exact gram selector and deliberately reviewed gram-label evidence, retained in the source profile.

Examples of preserved label distinctions include 96.8% monohydrate plus FOS versus flavoured 75% creatine; carnitine tartrate versus free carnitine; citrulline malate versus free citrulline; and native type II ingredient versus hydrolysed collagen peptides. EPA+DHA is calculated from its stated components rather than total omega-3. Miduty liposomal ingredient masses are recorded separately while unambiguous pure-active doses remain unknown. Fortified protein formulas with unmodeled added iron/micronutrients require product review and do not enter automatic stack shortlists. Product advertising and FAQ claims are not promoted to independent clinical evidence.

## Trustified evidence and brand expansion: 20 November 2026

Added 40 verified pack listings across Alpino, Mille, Only What's Needed, One Science Nutrition, Cutler Nutrition, Foodstrong and XLR8. The catalog now contains 1,475 category entries across 52 brands. Exact prices, stock and labels have their own source dates; incomplete and contradictory label values stay explicit. Source profiles support future price refreshes without UI edits, including strict reviewed-weight evidence for exact ProductGroup variants and exact Dukaan SKU selection with the storefront's `sku_id` parameter.

The independently versioned testing ledger is `artifacts/trustified-reports.json`. It retains 291 source-URL/batch records across 90 source brand names: 216 reported passed, 39 failed, 32 expired and 4 unknown. These are published source records, not a claim that 291 distinct laboratory tests were performed. Aliases, certification pages and retests can describe the same sample. Adjacent date text has been separated from batch identifiers, with raw observations and contradictions preserved. Foods and categories outside the current lineup are documented as exclusions.

The Sources & data quality page provides brand, category, status and batch search. Exact pack details, catalog filters and comparisons use the same ledger. Results are linked only through reviewed product-line mappings; no current retail batch is verified. A linked failed sample creates a conservative review hold for automatic stacks and cost rankings, while the price and label remain visible. Passing records do not clear separate formulation concerns, and results are never inherited by every product from the same brand. Expired source listings are separate from retail-pack expiry.

`artifacts/testing-product-matches.json` contains exact catalog names, explicit source identities and source-URL allowlists where generic product names are ambiguous. Regenerate the ledger with `node scripts/import_trustified_reports.mjs PUBLIC_HARVEST.json`, then run the normal checks and build. New report data, counts and evidence links refresh through the existing atomic dataset revision; a testing-only update does not redate prices or label reviews. Review changed formulations and identity conflicts before adding new mappings. Product-category downloads contain report IDs rather than duplicating the complete report gallery for every flavour.
