import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {normalizeUnitInputs} from '../docs/units.js';
import {createSnapshot} from '../docs/model.js';
import {loadBundle} from '../scripts/build_site.mjs';
import {buildComparison} from '../docs/compare.js';
import {searchCatalog} from '../docs/search.js';
import {filterOffers} from '../docs/core.js';
import {recommend} from '../docs/recommender.js';

const definitions=JSON.parse(await fs.readFile(new URL('../docs/data/site.json',import.meta.url),'utf8')).categories;
const category=id=>definitions.find(c=>c.id===id);
const counted={price:600,packCount:60,servingUnits:2,form:'Capsule'};

test('citrulline-malate ratio and compound mass do not manufacture free citrulline',()=>{
 const c=category('citrulline'),{offer:r}=normalizeUnitInputs({price:900,grams:300,servingGrams:3,form:'Powder',citrullineMalateRatio:'2:1',citrullineMalateMg:3000},c);
 assert.equal(r.citrullineMg,null);assert.equal(r.referenceCost,null);assert.equal(r.costPer_citrullineMalateMg,3);
 assert.equal(filterOffers([r],{type:[],costPer_citrullineMalateMgMax:4},c.id,c).length,1);
 assert.equal(filterOffers([r],{citrullineMgMin:1},c.id,c).length,0);
 const updated=normalizeUnitInputs({...r,price:1200},c).offer;assert.equal(updated.costPer_citrullineMalateMg,4);
});

test('betaine HCl and HMB compounds retain independent label costs without implied active conversion',()=>{
 const betaine=normalizeUnitInputs({...counted,betaineHclMg:600},category('betaine')).offer;
 assert.equal(betaine.betaineMg,null);assert.equal(betaine.referenceCost,null);assert.equal(betaine.costPer_betaineHclMg,100/3);
 for(const field of ['calciumHmbMg','hmbFreeAcidMg']){
  const r=normalizeUnitInputs({...counted,[field]:1000},category('hmb')).offer;
  assert.equal(r.hmbMg,null);assert.equal(r.referenceCost,null);assert.equal(r['costPer_'+field],20);
 }
});

test('all added payload fields reject negative, string and non-finite amounts',()=>{
 for(const [id,keys] of [['citrulline',['citrullineMg','citrullineMalateMg']],['beta-alanine',['betaAlanineMg']],['taurine',['taurineMg']],['betaine',['betaineMg','betaineHclMg']],['hmb',['hmbMg','calciumHmbMg','hmbFreeAcidMg']]])for(const key of keys)for(const value of [-1,'1000',Infinity]){
  const {offer,issues}=normalizeUnitInputs({...counted,[key]:value},category(id));assert.equal(offer[key],null);assert.ok(issues.some(i=>i.field===key&&i.severity==='error'));
 }
});

test('new actives have exact sourced offers, complete guides, calculated comparisons and explicit history gaps',async()=>{
 const s=createSnapshot(await loadBundle());assert.deepEqual(s.quality.errors,[]);
 for(const id of ['citrulline','beta-alanine','taurine','betaine','hmb']){
  const c=s.categories[id];assert.ok(c.offers.length);assert.equal(s.research.articles.filter(a=>a.category===id).length,1);
  for(const r of c.offers){assert.equal(r.priceAudit.status,'verified');assert.ok(r.trend.history.filter(h=>!h.isCurrent).every(h=>h.price==null&&!h.verified));assert.equal(r.trend.history.length,13);if(r.packServings==null)assert.equal(r.servingCost,null);else assert.equal(r.servingCost,r.price/r.packServings);}
  const results=searchCatalog(s,{q:id.replaceAll('-',' '),category:id});assert.ok(results.products.length);assert.equal(results.guides.filter(g=>!g.editorial).length,1);
  const rows=buildComparison(s,[{category:id,id:c.offers[0].id}]).rows;assert.ok(rows.some(r=>r.id==='serving-cost'));assert.ok(rows.some(r=>r.id===c.mainNutrient));
 }
});

test('form searches do not spread malate, TMG or hydrochloride aliases across every offer',async()=>{
 const s=createSnapshot(await loadBundle());
 for(const [id,q,pattern] of [['citrulline','malate',/malate/i],['betaine','tmg',/anhydrous|trimethylglycine|tmg/i],['betaine','hcl',/hydrochloride|hcl/i]]){
  const rows=searchCatalog(s,{q,category:id}).products.flatMap(p=>p.variants);
  if(s.categories[id].offers.some(r=>pattern.test(r.type)))assert.ok(rows.length);
  assert.ok(rows.every(r=>pattern.test(r.type)));
 }
});

test('stack review includes all new actives and checks pre-workout and compound distinctions',async()=>{
 const s=createSnapshot(await loadBundle()),result=recommend(s,{goals:['performance-claims'],context:'adult-clear',existing:['pre-workout'],diet:'any',budget:''});
 for(const id of ['citrulline','beta-alanine','taurine','betaine','hmb']){const item=result.items.find(i=>i.category===id);assert.ok(item);assert.equal(item.review,true);assert.equal(item.eligible,false);assert.deepEqual(item.offers,[]);}
 assert.ok(result.warnings.some(w=>w.includes('duplicate ingredients')&&w.includes('beta-alanine')));assert.ok(result.warnings.some(w=>w.includes('TMG')&&w.includes('HCl')));assert.ok(result.warnings.some(w=>w.includes('leucine metabolite')));
});
