import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadArtifactSources} from '../scripts/artifact_store.mjs';
import {createSnapshot} from '../docs/model.js';
import {buildSearchIndex, searchCatalog} from '../docs/search.js';

// Compare the public discovery contract. Body prose and full reference records
// deliberately remain in the requested guide/article rather than this index.
function discovery(result) {
 return {
  ...Object.fromEntries(['query','terms','category','kind','facets','allCategoryTotal','totals'].map(key=>[key,result[key]])),
  products:result.products.map(product=>({
   ...Object.fromEntries(['id','category','categoryLabel','page','brand','product','matchingCount','totalCount','verifiedCount','availableCount','minPrice','lowestSourcedPrice','priceStatus','types','subclasses','flavours','packLabels'].map(key=>[key,product[key]])),
   variants:product.variants.map(offer=>offer.id),
   representative:product.representative?.id??null
  })),
  guides:result.guides.map(guide=>Object.fromEntries(['id','category','title','summary','href','categoryLabel','sourceCount'].map(key=>[key,guide[key]])))
 };
}

const snapshot=createSnapshot((await loadArtifactSources()).bundle);
const index=buildSearchIndex(snapshot);

test('compact index preserves discovery, exact packs, source counts and filters for the published catalog',()=>{
 const queries=['','gsh','bcomplex','b12','folic acid','whey chocolate','isolate vanilla','monohydrate','micronized','collagen','casein','carbohydrate','diabetes','intestinal absorption','creatine nitrate','muscleblaze','nutrabay','caffeine','500','1000','2000',...Object.values(snapshot.categories).map(category=>category.label)];
 for(const q of queries){
  assert.deepEqual(discovery(searchCatalog(index,{q})),discovery(searchCatalog(snapshot,{q})),q);
 }
 for(const state of [
  {q:'protein',category:'protein',kind:'products'},
  {q:'muscle',category:'creatine',kind:'guides'},
  {category:'vitamin-b',kind:'products'},
  {category:'collagen',kind:'guides'},
  {category:'new-category'},
  {q:'no-match-product-or-guide'}
 ])assert.deepEqual(discovery(searchCatalog(index,state)),discovery(searchCatalog(snapshot,state)),JSON.stringify(state));
});

test('compact discovery stores searchable tokens without full prose, price histories or assay reports',()=>{
 assert.equal(index.searchIndex,true);
 assert.deepEqual(index.research.sources,[]);
 const offers=Object.values(index.categories).flatMap(category=>category.offers);
 assert.equal(offers.length,snapshot.stats.offers);
 for(const offer of offers){
  assert.equal(typeof offer.searchText,'string');
  for(const key of ['testing','trend','history','priceHistory','labelNotes','retailerQuotes'])assert.equal(offer[key],undefined,key);
 }
 for(const article of [...index.research.articles,...index.research.editorial.articles]){
  assert.ok(Number.isInteger(article.sourceCount));
  assert.equal(typeof article.searchText,'string');
  for(const key of ['intro','sections','forms','myths','pathway','buyingGuide','intakeGuide','medicalGuide'])assert.equal(article[key],undefined,key);
 }
 assert.ok(JSON.stringify(index).length<JSON.stringify(snapshot).length/3);
 assert.deepEqual(buildSearchIndex(index),index);
});

test('index refresh reflects artifact changes without retaining an older price or new-product omission',()=>{
 const updated=structuredClone(snapshot),category=Object.values(updated.categories).find(category=>category.offers.length),offer=category.offers[0];
 offer.brand='New Search Brand';offer.product='New artifact line';offer.flavour='Distinct flavour';offer.price=1234;offer.priceAudit.status='verified';offer.stock='In stock';
 const result=searchCatalog(buildSearchIndex(updated),{q:'new search brand distinct'});
 assert.equal(result.products.length,1);
 assert.equal(result.products[0].representative.id,offer.id);
 assert.equal(result.products[0].minPrice,1234);
 assert.deepEqual(discovery(result),discovery(searchCatalog(updated,{q:'new search brand distinct'})));
 assert.equal(searchCatalog(index,{q:'new search brand distinct'}).products.length,0);
});
