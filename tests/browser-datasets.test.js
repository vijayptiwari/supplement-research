import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadArtifactSources} from '../scripts/artifact_store.mjs';
import {browserProjections,catalogOffer} from '../scripts/browser_datasets.mjs';
import {createSnapshot} from '../docs/model.js';
import {filterOffers} from '../docs/core.js';
import {rankedOffers} from '../docs/catalog-model.js';
import {marketHomeMarkup} from '../docs/marketplace.js';
import {editorialMarkup,selectEditorial} from '../docs/articles.js';
import {selectResearch} from '../docs/research.js';
import {recommend} from '../docs/recommender.js';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const sources=await loadArtifactSources();
const snapshot=createSnapshot(sources.bundle);
const projections=browserProjections(snapshot);
const ids=rows=>rows.map(row=>String(row.id));
const sortedKeys=value=>Object.keys(value).sort();

test('reading-library summaries preserve phrase searches, article searches and matching sources',()=>{
 const library=projections.library.research;
 for(const q of ['calcium absorption','protein intake','creatine monohydrate','amino acids','kidney disease','curcumin','editorial']){
  const expected=selectResearch(snapshot.research,{q}),actual=selectResearch(library,{q});
  assert.deepEqual(ids(actual.articles),ids(expected.articles),q);
  assert.deepEqual(ids(actual.sources),ids(expected.sources),q+' sources');
  assert.deepEqual(ids(selectEditorial(library.editorial,{q})),ids(selectEditorial(snapshot.research.editorial,{q})),q+' articles');
 }
});

test('article scopes preserve every rendered section, pathway and original citation',()=>{
 for(const article of snapshot.research.editorial.articles){
  const resource=projections.articles[article.id];
  const partial={...projections.core,research:{...projections.core.research,sources:resource.sources,articles:projections.core.research.articles.map(a=>a.category===article.category?resource.guide:a),editorial:{...projections.core.research.editorial,articles:projections.core.research.editorial.articles.map(a=>a.id===article.id?resource.article:a)}}};
  assert.equal(editorialMarkup(resource.article,partial),editorialMarkup(article,snapshot),article.id);
 }
});

test('scoped stack data preserves clinical decisions and exact eligible pack selections',()=>{
 const partial={...projections.core,...projections.stack};
 for(const input of [
  {goals:['strength'],existing:[],proteinGap:'yes',context:'adult-clear',diet:'any',milkAllergy:'no',fishAllergy:'no'},
  {goals:['strength'],existing:['bcaa','vitamin-d'],proteinGap:'yes',context:'review',diet:'vegan',milkAllergy:'yes',fishAllergy:'yes'},
  {goals:['strength'],existing:['protein'],proteinGap:'no',context:'adult-clear',budget:500,diet:'any',milkAllergy:'no',fishAllergy:'no'},
 ]){
  const decisions=result=>result.items.map(({offers,...item})=>({...item,offers:offers.map(row=>[row.id,row.price,row.cost,row.referenceCost])}));
  assert.deepEqual(decisions(recommend(partial,input)),decisions(recommend(snapshot,input)));
 }
});

test('browser summaries discover every published topic and article without copying full content',()=>{
 assert.deepEqual(snapshot.quality.errors,[]);
 assert.deepEqual(sortedKeys(projections.core.categories),sortedKeys(snapshot.categories));
 assert.deepEqual(ids(projections.core.research.articles),ids(snapshot.research.articles));
 assert.deepEqual(ids(projections.core.research.editorial.articles),ids(snapshot.research.editorial.articles));
 assert.deepEqual(sortedKeys(projections.guides),snapshot.research.articles.map(a=>a.category).sort());
 assert.deepEqual(sortedKeys(projections.articles),snapshot.research.editorial.articles.map(a=>a.id).sort());
 for(const category of Object.values(projections.core.categories)){
  assert.equal(category._offersLoaded,false);
  assert.deepEqual(category.offers,[]);
  assert.deepEqual(category.stats,snapshot.categories[category.id].stats);
 }
 for(const article of [...projections.core.research.articles,...projections.core.research.editorial.articles]){
  assert.equal(article._contentLoaded,false);
  for(const field of ['intro','sections','myths','forms','evidenceNotes','comparison','bodySteps','pathway','intakeGuide','medicalGuide'])assert.equal(Object.hasOwn(article,field),false,article.id+' '+field);
  if(article.buyingGuide)assert.deepEqual(Object.keys(article.buyingGuide),['value']);
  assert.ok(Number.isInteger(article.sourceCount));
 }
 const html=marketHomeMarkup(projections.core);
 for(const category of Object.values(snapshot.categories))assert.ok(html.includes('guide-'+category.id+'.html'),category.id);
 assert.doesNotMatch(html,/undefined|null/);
});

test('lean catalog rows preserve costs, eligibility, testing decisions and exact filter results',()=>{
 for(const category of Object.values(snapshot.categories)){
  const lean=projections.catalogs[category.id].category;
  assert.deepEqual(ids(lean.offers),ids(category.offers));
  assert.deepEqual(category.stats,lean.stats);
  for(let i=0;i<category.offers.length;i++){
   const original=category.offers[i],row=lean.offers[i];
   for(const key of ['cost','referenceCost','score','rankingEligible','price','type','subclass','flavour','grams','kg','packCount','stock','requiresProductReview','productReviewReason'])assert.deepEqual(row[key],original[key],category.id+'/'+row.id+' '+key);
   assert.deepEqual(row.priceAudit,original.priceAudit);
   assert.equal(row.testing.reviewRequired,original.testing.reviewRequired);
   assert.deepEqual(row.trend.history.map(h=>h.quarter),original.trend.history.filter(h=>h.verified).map(h=>h.quarter));
   assert.ok(row.trend.history.every(h=>h.verified));
   assert.equal(row.trend.completedQuartersTracked,original.trend.completedQuartersTracked);
   assert.equal(row.trend.fullHistoryVerified,original.trend.fullHistoryVerified);
  }
  const first=category.offers[0];
  const states=[{},...['linked','unlinked','passed','failed','expired','unknown'].map(testing=>({testing})),...['any','full','none'].map(historyCoverage=>({historyCoverage})),...['up','down','stable','unknown'].map(priceTrend=>({priceTrend})),{knownCost:true},{complete:true}];
  if(first)states.push({brand:[first.brand],product:[first.product],flavour:[first.flavour]},{priceMin:first.price,priceMax:first.price},{q:first.product});
  for(const quarter of new Set(category.offers.flatMap(row=>row.trend.history.map(h=>h.quarter))))states.push({historyQuarter:quarter});
  for(const state of states)assert.deepEqual(ids(filterOffers(lean.offers,state,category.id,category)),ids(filterOffers(category.offers,state,category.id,category)),category.id+' '+JSON.stringify(state));
  assert.deepEqual(ids(rankedOffers(lean,1000)),ids(rankedOffers(category,1000)),category.id+' ranking');
 }
});

test('product details retain complete variant evidence and histories under a stable product identity',()=>{
 const seen=new Set();
 for(const [key,projection] of Object.entries(projections.products)){
  assert.match(key,/^[a-f0-9]{24}$/);
  const category=projection.category,first=category.offers[0];
  assert.ok(first);
  const originals=snapshot.categories[category.id].offers.filter(row=>row.brand===first.brand&&row.product===first.product);
  assert.deepEqual(category.offers,originals);
  for(const row of category.offers){
   const identity=JSON.stringify([category.id,String(row.id)]);
   assert.equal(projections.offerKeys[identity],key);
   assert.equal(seen.has(identity),false,'Each exact offer belongs to one product detail.');
   seen.add(identity);
  }
 }
 assert.equal(seen.size,snapshot.stats.offers);
 assert.equal(Object.keys(projections.offerKeys).length,snapshot.stats.offers);
 // Projection creation cannot shorten the authoritative histories in place.
 for(const category of Object.values(snapshot.categories))for(const row of category.offers){
  const before=structuredClone(row);catalogOffer(row);assert.deepEqual(row,before);
 }
});

test('new category, product line and standalone article files enter browser resources without registration code',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'browser-dataset-artifacts-'));
 try{
  await fs.cp(path.join(projectRoot,'artifacts'),path.join(temp,'artifacts'),{recursive:true});
  const wiki=JSON.parse(await fs.readFile(path.join(temp,'artifacts/wiki/biotin.json'),'utf8'));
  wiki.category={...wiki.category,id:'fixture-browser-nutrient',label:'Fixture browser nutrient'};delete wiki.category.page;delete wiki.category.file;delete wiki.order;
  wiki.guide={...wiki.guide,id:'fixture-browser-nutrient-guide',category:wiki.category.id,title:'Fixture browser nutrient education'};
  wiki.catalog={checked:snapshot.asOf,category:wiki.category.id};
  await fs.writeFile(path.join(temp,'artifacts/wiki/fixture-browser-nutrient.json'),JSON.stringify(wiki));
  const raw={...sources.bundle.categories.biotin.offers[0],id:'fixture-browser-pack',category:wiki.category.id,brand:'Fixture Browser Brand',product:'Fixture Browser Product',url:'https://example.org/fixture-browser-product'};
  const product={schemaVersion:1,category:wiki.category.id,brand:raw.brand,product:raw.product,variants:[{offer:raw}],priceHistory:[],refreshSources:[]};
  const productFolder=path.join(temp,'artifacts/products',wiki.category.id,'fixture-browser-brand');await fs.mkdir(productFolder,{recursive:true});
  await fs.writeFile(path.join(productFolder,'fixture-browser-product.json'),JSON.stringify(product));
  const article={...structuredClone(sources.bundle.research.editorial.articles[0]),id:'fixture-browser-article',category:wiki.category.id,relatedCategories:[],series:null,title:'Fixture browser article'};
  await fs.writeFile(path.join(temp,'artifacts/articles/fixture-browser-article.json'),JSON.stringify({schemaVersion:1,article}));
  const next=createSnapshot((await loadArtifactSources(temp)).bundle);assert.deepEqual(next.quality.errors,[]);
  const browser=browserProjections(next),category=wiki.category.id;
  assert.ok(browser.core.categories[category]);assert.ok(browser.guides[category]);assert.ok(browser.catalogs[category]);
  assert.equal(browser.catalogs[category].category.offers[0].id,raw.id);
  assert.ok(browser.products[browser.offerKeys[JSON.stringify([category,raw.id])]]);
  assert.equal(browser.articles[article.id].article.title,article.title);
  assert.ok(browser.core.research.editorial.articles.some(item=>item.id===article.id&&item.series===null));
  assert.ok(browser.search.categories[category]);
 }finally{
  assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('browser-dataset-artifacts-'));
  await fs.rm(temp,{recursive:true,force:true});
 }
});
