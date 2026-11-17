import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {matchingReferences,referenceAmount,intakeMarkup,medicalMarkup} from '../docs/intake.js';
import {auditStack,stackCategoryMarkup} from '../docs/stack-audit.js';
import {recommend} from '../docs/recommender.js';
import {searchCatalog} from '../docs/search.js';

const snapshot=loadBundle().then(createSnapshot);
test('all current categories share sourced food quantities, intake context and medical evidence',async()=>{
 const s=await snapshot;assert.deepEqual(s.quality.errors,[]);
 for(const c of s.config.categories){
  const a=s.research.articles.find(a=>a.category===c.id);assert.ok(a.intakeGuide);assert.ok(a.medicalGuide.conditions.length);
  for(const f of a.buyingGuide.foods)assert.ok(f.quantityStatus==='quantified'?f.amounts.every(m=>m.per.label&&m.sourceIds.length):f.quantityNote);
  const html=stackCategoryMarkup(s,c.id,{profile:'hybrid',age:31,sex:'female',weight:60});
  for(const term of ['Food alternatives','Intake references','Medical conditions','Safety, interactions'])assert.ok(html.includes(term),c.id+term);
 }
});
test('training frequency and experience do not invent new dose tiers; g/kg uses only entered mass',async()=>{
 const s=await snapshot,a=s.research.articles.find(a=>a.category==='protein'),rows=a.intakeGuide.targets;
 const base={profile:'strength-power',age:31,sex:'female'};
 assert.deepEqual(matchingReferences(rows,{...base,sessions:2}),matchingReferences(rows,{...base,sessions:5}));
 const t=matchingReferences(rows,base)[0];assert.equal(referenceAmount(t).daily,null);assert.deepEqual(referenceAmount(t,60).daily,{min:72,max:120});
 assert.equal(matchingReferences(rows,{...base,age:17}).length,0);
 assert.equal(matchingReferences(rows,{...base,profile:'everyday'})[0].min,.8);
});
test('age and sex change total micronutrient references; supplemental limits retain their own basis',async()=>{
 const s=await snapshot,get=c=>s.research.articles.find(a=>a.category===c).intakeGuide;
 assert.equal(matchingReferences(get('magnesium').targets,{age:19,sex:'male'})[0].min,400);
 assert.equal(matchingReferences(get('magnesium').targets,{age:31,sex:'female'})[0].min,320);
 assert.equal(matchingReferences(get('vitamin-d').targets,{age:71})[0].min,20);
 assert.equal(get('magnesium').limits[0].basis,'supplement-daily');assert.equal(get('folic-acid').limits[0].basis,'synthetic-folic-acid');
 assert.equal(get('fish-oil').targets.length,0);
 const refs=new Map(s.research.sources.map(s=>[s.id,s]));assert.ok(!intakeMarkup(get('protein'),{weight:60},refs,{restricted:true}).includes('At entered mass'));
});
function fixture(){
 const row=(id,extra)=>({id,brand:'Test',product:id,isUnitOffer:true,form:'Capsule',packCount:60,servingUnits:2,price:600,priceAudit:{status:'verified'},...extra});
 const fields=keys=>keys.map(key=>({key,label:key,unit:key.endsWith('Mcg')?'µg':'mg'}));
 return {config:{locale:'en-IN',currency:'INR'},research:{articles:[{intakeGuide:{limits:[{key:'magnesiumMg',label:'Supplemental magnesium UL',max:350,unit:'mg',basis:'supplement-daily',minAge:19,maxAge:null,notes:'Excludes food.'}]}}]},categories:{
  protein:{id:'protein',offers:[row('powder',{isUnitOffer:false,grams:1000,protein:80})]},
  magnesium:{id:'magnesium',mainNutrient:'magnesiumMg',nutrientFields:fields(['magnesiumMg']),offers:[row('mg',{magnesiumMg:400})]},
  zmc:{id:'zmc',mainNutrient:'multi',nutrientFields:fields(['magnesiumMg','calciumMg','zincMg','vitaminDIu']),offers:[row('combo',{magnesiumMg:200,calciumMg:400,zincMg:10,vitaminDIu:600})]},
  'vitamin-d':{id:'vitamin-d',mainNutrient:'vitaminDIu',nutrientFields:fields(['vitaminDIu','vitaminDMcg']),offers:[row('d',{vitaminDIu:1000,vitaminDMcg:25})]},
  'pre-workout':{id:'pre-workout',mainNutrient:'caffeineMg',nutrientFields:fields(['caffeineMg','caffeineAnhydrousMg','caffeineComponentMg','citrullineMg','citrullineMalateMg']),offers:[row('blend',{form:'Powder',grams:300,servingGrams:10,caffeineMg:null,caffeineAnhydrousMg:100,caffeineComponentMg:120,citrullineMalateMg:3000})]}
 }};
}
const selection=(category,offerId,quantity)=>({category,offerId,quantity});
test('ingredient inventory uses powder grams and label serving units, with costs and duration rederived',()=>{
 const s=fixture(),result=auditStack(s,[selection('protein','powder',30),selection('magnesium','mg',1)]);
 assert.equal(result.rows.find(r=>r.key==='protein').amount,24);assert.equal(result.rows.find(r=>r.key==='magnesiumMg').amount,200);
 assert.equal(result.packs[0].dailyCost,18);assert.equal(result.packs[0].days,1000/30);assert.equal(result.packs[1].dailyCost,10);
 s.categories.protein.offers[0].protein=70;s.categories.protein.offers[0].price=1000;
 const updated=auditStack(s,[selection('protein','powder',30)]);assert.equal(updated.rows[0].amount,21);assert.equal(updated.packs[0].dailyCost,30);
});
test('Vitamin D IU and micrograms are counted once and elemental mineral overlaps trigger a lower-bound alert',()=>{
 const r=auditStack(fixture(),[selection('zmc','combo',2),selection('magnesium','mg',1),selection('vitamin-d','d',2)],{age:31});
 assert.equal(r.rows.find(r=>r.key==='vitaminDMcg').amount,40);assert.equal(r.rows.find(r=>r.key==='magnesiumMg').amount,400);assert.equal(r.limitAlerts.length,1);
 assert.equal(r.limitAlerts[0].basis,'supplement-daily');assert.ok(!r.rows.some(r=>r.key==='vitaminDIu'));
});
test('unknown daily amounts and missing serving bases never become a one-serving plan',()=>{
 const s=fixture();let r=auditStack(s,[selection('magnesium','mg','')]);assert.equal(r.rows.length,0);assert.equal(r.packs[0].dailyCost,null);assert.ok(r.gaps.length);
 s.categories.magnesium.offers[0].servingUnits=null;r=auditStack(s,[selection('magnesium','mg',1)]);assert.equal(r.rows.length,0);assert.ok(r.gaps.some(g=>g.includes('serving basis')));
 r=auditStack(s,[selection('magnesium','mg',0)]);assert.equal(r.packs[0].dailyCost,0);assert.equal(r.rows.length,0);
});
test('numeric catalog IDs resolve from browser strings and different compound masses remain separate',()=>{
 const s=fixture();s.categories.protein.offers[0].id=465;
 assert.equal(auditStack(s,[selection('protein','465',30)]).rows[0].amount,24);
 for(const c of ['magnesium','zmc']){s.categories[c].nutrientFields.push({key:'magnesiumCompoundMg',label:'Magnesium compound',unit:'mg'});s.categories[c].offers[0].magnesiumCompoundMg=100;}
 const rows=auditStack(s,[selection('magnesium','mg',2),selection('zmc','combo',2)]).rows.filter(r=>r.key.startsWith('magnesiumCompoundMg:'));
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.amount===100));
});
test('declared but unknown co-vitamins make combined totals lower bounds',async()=>{
 const s=await snapshot,zmc=s.categories.zmc.offers.find(r=>r.id==='zmc-42526511202526'),d=s.categories['vitamin-d'].offers.find(r=>r.vitaminDMcg>0&&r.servingUnits>0);
 assert.ok(zmc.declaredNutrients.includes('vitaminB12Mcg'));
 const result=auditStack(s,[selection('zmc',zmc.id,1),selection('vitamin-d',d.id,1)]);
 assert.ok(result.rows.find(r=>r.key==='vitaminDMcg').partial);
 assert.ok(result.gaps.some(g=>g.includes('B12')));
});
test('caffeine components are overlapping lower bounds; malate mass is not converted to free citrulline',()=>{
 const r=auditStack(fixture(),[selection('pre-workout','blend',10)]);const caffeine=r.rows.find(r=>r.key==='caffeineMg');
 assert.equal(caffeine.amount,120);assert.ok(caffeine.partial);assert.equal(r.rows.find(r=>r.key==='citrullineMalateMg').amount,3000);assert.ok(!r.rows.some(r=>r.key==='citrullineMg'));
 assert.ok(r.gaps.some(g=>g.includes('total caffeine')));
});
test('existing categories are reviewed even outside selected goals without changing product eligibility',async()=>{
 const s=await snapshot,r=recommend(s,{goals:['strength'],existing:['vitamin-b'],context:'adult-clear',proteinGap:'yes',diet:'any',budget:'',milkAllergy:'no',fishAllergy:'no'});
 const held=r.items.find(i=>i.category==='vitamin-b');assert.ok(held.held);assert.equal(held.eligible,false);assert.equal(held.offers.length,0);
});
test('medical distinctions are discoverable without treating food or condition terms as product ingredients',async()=>{
 const s=await snapshot,r=searchCatalog(s,{q:'Parkinson'});assert.ok(r.guides.some(g=>g.category==='creatine'));assert.equal(r.products.length,0);
 const a=s.research.articles.find(a=>a.category==='creatine');assert.ok(a.medicalGuide.conditions.every(e=>e.level==='insufficient'));
 const html=medicalMarkup(a.medicalGuide,s.research.medicalPolicy,new Map(s.research.sources.map(r=>[r.id,r])));assert.ok(html.includes('stopped for futility'));
});
test('invalid clinical evidence, quantities, serving basis or reference profiles reject dataset publication',async()=>{
 const b=await loadBundle();
 for(const mutate of [b=>b.research.articles[0].intakeGuide.targets[0].min=-1,b=>b.research.articles[0].intakeGuide.targets[0].profileIds=['invented'],b=>b.research.articles[0].intakeGuide.targets[0].sourceIds=['missing'],b=>b.research.articles[0].buyingGuide.foods[0].amounts[0].per.label='',b=>b.research.articles[0].buyingGuide.foods[0].amounts[0].max=-1,b=>b.research.articles[0].medicalGuide.conditions[0].level='cure',b=>delete b.research.articles[0].intakeGuide,b=>delete b.research.intakePolicy,b=>delete b.research.medicalPolicy,b=>b.research.intakePolicy.ageBands=[null],b=>b.research.articles[0].medicalGuide.conditions={}]){
  const copy=structuredClone(b);mutate(copy);assert.ok(createSnapshot(copy).quality.errors.some(e=>e.field==='research'));
 }
});
