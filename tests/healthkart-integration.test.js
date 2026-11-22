import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadArtifactSources} from '../scripts/artifact_store.mjs';
import {applyCatalogResearch} from '../scripts/merge_catalog_research.mjs';
import {createSnapshot,normalizeOffer,retailerQuoteIssues} from '../docs/model.js';
import {retailerQuotesMarkup,primarySourceLabel} from '../docs/retailer-quotes.js';
import {unitDetails} from '../docs/unit-catalog.js';
import {catalogResearchMarkup} from '../docs/catalog-research.js';
import {recommend} from '../docs/recommender.js';
import {productReviewMarkup} from '../docs/product-review.js';

const sources=loadArtifactSources(),bundle=sources.then(s=>s.bundle),read=name=>sources.then(s=>structuredClone(s.legacyDocuments[name]));
const quote={retailer:'HealthKart',seller:'Bright Lifecare',price:899,currency:'INR',checked:'2026-11-19',sourceUrl:'https://www.healthkart.com/sv/test-product/SP-123?navKey=VRNT-456',variantId:'456',matchBasis:'Exact brand, flavour and net pack size matched to selected variant 456.',stock:'In stock'};
const money=n=>'₹'+n,num=n=>String(n??'Unknown'),link=(u,t)=>`<a href="${u}">${t}</a>`;

test('separate retailer quotes cannot alter primary cost or create primary price evidence',async()=>{
 const b=await bundle;
 for(const id of ['protein','fish-oil']){const definition=b.config.categories.find(c=>c.id===id),raw=b.categories[id].offers[0],before=normalizeOffer(raw,definition,'2026-11-20',[],b.config),after=normalizeOffer({...raw,retailerQuotes:[quote]},definition,'2026-11-20',[],b.config);
  assert.equal(after.price,raw.price);assert.equal(after.cost,before.cost);assert.equal(after.unitCost,before.unitCost);assert.equal(after.referenceCost,before.referenceCost);assert.equal(after.priceAudit.status,'unverified');assert.equal(after.trend.completedQuartersTracked,0);assert.equal(after.retailerQuotes[0].price,899);
 }
});

test('invalid retailer quotes and conflicting same-date quotes cannot publish',()=>{
 assert.deepEqual(retailerQuoteIssues([quote],'2026-11-20'),[]);
 for(const patch of [{price:0},{price:NaN},{currency:'USD'},{checked:'2026-11-21'},{checked:'2026-02-30'},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://example.com/?navKey=VRNT-456'},{sourceUrl:quote.sourceUrl+'&navKey=VRNT-999'},{variantId:'999'},{variantId:''},{matchBasis:''},{retailer:''},{stock:'probably'}])assert.equal(retailerQuoteIssues([{...quote,...patch}],'2026-11-20')[0]?.severity,'error',JSON.stringify(patch));
 assert.equal(retailerQuoteIssues([quote,{...quote,price:999}],'2026-11-20')[0]?.field,'retailerQuotes');
});

test('retailer presentation identifies seller, date, stale quotes and escapes source text',async()=>{
 const html=retailerQuotesMarkup({retailerQuotes:[{...quote,seller:'<img src=x onerror=bad()>',matchBasis:'<script>bad()</script>'}]},{money,asOf:'2027-04-01',maxAgeDays:100});
 assert.ok(html.includes('HealthKart listed price'));assert.ok(html.includes('₹899'));assert.ok(html.includes('19 November 2026'));assert.ok(html.includes('Quote needs a fresh check'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('primary listing above'));
 assert.equal(retailerQuotesMarkup({retailerQuotes:[{...quote,sourceUrl:'javascript:alert(1)'}]},{money,asOf:'2026-11-20'}),'');
 assert.equal(primarySourceLabel({sourceType:'retailer',retailer:'HealthKart'}),'HealthKart product listing');
 const s=createSnapshot(await bundle),c=s.categories['fish-oil'],r={...c.offers[0],retailerQuotes:[quote]};assert.ok(unitDetails(c,r,[r],{money,num,link,history:'',maxAgeDays:100}).includes('HealthKart listed price'));
 const site=await fs.readFile(new URL('../docs/site.js',import.meta.url),'utf8');assert.ok(site.includes('retailerQuotesMarkup(r,{money,asOf:c.asOf,maxAgeDays:snapshot.config.maxPriceAgeDays})'));
});

test('a partial follow-up retains previous category audit, profiles and observations with true dates',async()=>{
 const b=structuredClone(await bundle),sources=await read('additional-sources.json'),prior=await read('catalog-research.json'),category='fish-oil',old=b.categories[category].offers[0],oldObservations=structuredClone(b.observations),oldVitaminDate=b.categories['vitamin-d'].checked;
 const fragment={checked:'2026-11-19',categoriesCovered:[category],updates:[],additions:[],observations:[],retailerQuotes:[{category,offerId:old.id,...quote}]};
 const result=applyCatalogResearch(b,sources,prior,[fragment],{asOf:'2026-11-20'}),a=result.audit;
 assert.equal(a.reviewStart,prior.reviewStart||prior.checked);assert.equal(a.checked,'2026-11-20');assert.equal(a.coverage.length,b.config.categories.length);assert.equal(a.summary.newOffers,prior.summary.newOffers);assert.deepEqual(a.additions.map(x=>[x.category,x.offerId]),prior.additions.map(x=>[x.category,x.offerId]));
 assert.deepEqual(b.observations,oldObservations);assert.equal(b.categories['vitamin-d'].checked,oldVitaminDate);assert.equal(b.categories[category].checked,'2026-11-20');assert.equal(old.retailerQuotes[0].checked,'2026-11-19');
 assert.equal(a.summary.retailerQuotes,(prior.retailerQuotes?.length||0)+1);assert.ok(a.summary.labelsReviewedDuringPeriod>=a.summary.labelsCheckedOnAuditDate);
 const second=applyCatalogResearch(b,sources,a,[fragment],{asOf:'2026-11-20'});assert.equal(second.audit.summary.retailerQuotes,a.summary.retailerQuotes);assert.equal(old.retailerQuotes.length,1);
 assert.throws(()=>applyCatalogResearch(b,sources,a,[{...fragment,retailerQuotes:[{category,offerId:old.id,...quote,price:999}]}],{asOf:'2026-11-20'}),/Conflicting same-date/);
 const html=catalogResearchMarkup({...createSnapshot(b),catalogResearch:{...a,reportFile:'catalog-research.json',requirementsFile:'catalog-data-requirements.json'}});assert.ok(html.includes('research period'));assert.ok(html.includes('Prices verified on latest date'));assert.ok(html.includes('19 November 2026'));assert.ok(html.includes('20 November 2026'));
});

test('retailer label corroboration cannot masquerade as a new manufacturer price check',async()=>{
 const b=structuredClone(await bundle),sources=await read('additional-sources.json'),prior=await read('catalog-research.json'),category='vitamin-d',row=b.categories[category].offers.find(r=>r.id==='hkv-d3-60'),lastPriceReview=structuredClone(row.lastPriceReview),beforeObservations=structuredClone(b.observations),profile=sources.products.find(p=>p.id===row.id);
 const f={checked:'2026-11-19',categoriesCovered:[category],updates:[{category,offerId:row.id,patch:{id:row.id,labelChecked:'2026-11-19',notes:'Fixture: label reviewed separately.'},evidence:{checked:'2026-11-19',sourceUrl:row.url,evidenceUrl:quote.sourceUrl,matchBasis:'Exact selected pack label only; no primary price reviewed.'},profile:{...profile,category,notes:'Fixture source profile upgraded.'}}]};
 const result=applyCatalogResearch(b,sources,prior,[f],{asOf:'2026-11-20'});
 assert.deepEqual(row.lastPriceReview,lastPriceReview);assert.equal(row.lastLabelReview.checked,'2026-11-19');assert.equal(result.audit.summary.existingOffersPriceChecked,prior.summary.existingOffersPriceChecked);assert.deepEqual(b.observations,beforeObservations);assert.equal(sources.products.filter(p=>p.id===row.id).length,1);assert.equal(sources.products.find(p=>p.id===row.id).notes,'Fixture source profile upgraded.');
 assert.ok(result.audit.updates.some(u=>u.offerId===row.id&&u.reviewType==='label'));
});

test('reviewed family profiles split by exact pack without leaking labels to unreviewed sizes',async()=>{
 const b=structuredClone(await bundle),sources=await read('additional-sources.json'),prior=await read('catalog-research.json');
 const original={category:'fish-oil',brand:'Fixture brand',handle:'fixture',variantIds:['60','90','180'],servingUnits:null};sources.products.push(original);
 const reviewed={...original,variantIds:['60','90'],servingUnits:1,epaMg:180,dhaMg:120},unreviewed={...original,variantIds:['180']};
 const replacement={match:{category:original.category,brand:original.brand,handle:original.handle},profiles:[reviewed,unreviewed]},fragment={checked:'2026-11-20',sourceProfileReplacements:[replacement]};
 applyCatalogResearch(b,sources,prior,[fragment],{asOf:'2026-11-20'});assert.ok(!sources.products.includes(original));assert.equal(sources.products.find(p=>p.brand===original.brand&&p.variantIds.includes('180')).servingUnits,null);
 assert.equal(sources.products.filter(p=>p.brand===original.brand).length,2);
 applyCatalogResearch(b,sources,prior,[fragment],{asOf:'2026-11-20'});assert.equal(sources.products.filter(p=>p.brand===original.brand).length,2);
 sources.products.push({...original,variantIds:['999']});assert.throws(()=>applyCatalogResearch(b,sources,prior,[fragment],{asOf:'2026-11-20'}),/identify one family/);
});

test('protein formulas with additional review needs remain searchable but cannot enter automatic stacks',async()=>{
 const s=createSnapshot(await bundle),sources=await read('additional-sources.json'),ids=['protein-hk-205324','protein-hk-206008','protein-hk-274975','pr-scitron-45884819407001','pr-scitron-67676816670873'];
 const result=recommend(s,{goals:['strength'],existing:[],proteinGap:'yes',context:'adult-clear',diet:'any',milkAllergy:'no',fishAllergy:'no'}),protein=result.items.find(i=>i.category==='protein');assert.ok(protein.offers.length);
 for(const id of ids){const row=s.categories.protein.offers.find(r=>r.id===id),profile=sources.products.find(r=>r.id===id);assert.ok(row,id);assert.equal(row.requiresProductReview,true);assert.ok(row.productReviewReason);assert.equal(profile.requiresProductReview,true);assert.equal(profile.productReviewReason,row.productReviewReason);assert.ok(!protein.offers.some(r=>r.id===id));assert.ok(row.price>0);assert.ok(row.cost>0);assert.ok(productReviewMarkup(row).includes('excluded from automatic stack suggestions'));}
 assert.ok(s.recommender.productPolicy.common.some(c=>c.field==='requiresProductReview'&&c.op==='neq'&&c.value===true));
 const html=productReviewMarkup({requiresProductReview:true,productReviewReason:'<script>bad()</script>'});assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
 const c=s.categories['fish-oil'],r={...c.offers[0],requiresProductReview:true,productReviewReason:'Review combination ingredients.'};assert.ok(unitDetails(c,r,[r],{money,num,link,history:''}).includes('Review combination ingredients.'));
 const site=await fs.readFile(new URL('../docs/site.js',import.meta.url),'utf8');assert.ok(site.includes('${productReviewMarkup(r)}'));
});

test('manual product-review flags are validated for powders and unit products',async()=>{
 const b=await bundle;
 for(const id of ['protein','fish-oil']){const definition=b.config.categories.find(c=>c.id===id),row=b.categories[id].offers[0];for(const patch of [{requiresProductReview:'true'},{requiresProductReview:null},{requiresProductReview:true},{requiresProductReview:true,productReviewReason:''},{requiresProductReview:true,productReviewReason:123}]){const r=normalizeOffer({...row,...patch},definition,'2026-11-20',[],b.config);assert.ok(r.quality.issues.some(i=>i.field==='requiresProductReview'&&i.severity==='error'));}
  const r=normalizeOffer({...row,requiresProductReview:true,productReviewReason:'Review additional actives.'},definition,'2026-11-20',[],b.config);assert.ok(!r.quality.issues.some(i=>i.field==='requiresProductReview'));}
});

test('equal price facts retain distinct observation evidence metadata and exact repeats are idempotent',async()=>{
 const b=structuredClone(await bundle),sources=await read('additional-sources.json'),prior=await read('catalog-research.json'),original=b.observations.find(o=>o.kind==='official-live'&&o.qualityStatus!=='excluded'),corroboration={...original,matchBasis:'Fixture: independent exact-pack matching review of this same listed-price fact.'};
 const f={checked:'2026-11-20',observations:[structuredClone(original),corroboration]},encode=o=>JSON.stringify(o);
 applyCatalogResearch(b,sources,prior,[f],{asOf:'2026-11-20'});
 assert.ok(b.observations.some(o=>encode(o)===encode(original)));assert.ok(b.observations.some(o=>encode(o)===encode(corroboration)));assert.equal(b.observations.filter(o=>encode(o)===encode(original)).length,1);assert.equal(b.observations.filter(o=>encode(o)===encode(corroboration)).length,1);
 const count=b.observations.length;applyCatalogResearch(b,sources,prior,[f],{asOf:'2026-11-20'});assert.equal(b.observations.length,count);
});
