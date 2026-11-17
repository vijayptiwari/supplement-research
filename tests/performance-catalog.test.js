import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUnitInputs,completeUnitLabel} from '../docs/units.js';
import {filterOffers} from '../docs/core.js';
import {unitPack,unitText,unitFormula} from '../docs/unit-catalog.js';
import {buildComparison} from '../docs/compare.js';
import {createSnapshot} from '../docs/model.js';
import {loadBundle} from '../scripts/build_site.mjs';
import {searchCatalog} from '../docs/search.js';
import {recommend} from '../docs/recommender.js';

const definition={id:'bcaa',measurement:'units',supportsPowder:true,mainNutrient:'bcaaMg',referenceQuantity:1000,referenceUnit:'mg',compoundLabel:'labelled BCAAs',nutrientFields:[{key:'bcaaMg',label:'BCAA total',unit:'mg'}]};
const powder={id:'example',brand:'Example',product:'BCAA',flavour:'Unflavoured',type:'BCAA',subclass:'2:1:1',form:'Powder',grams:250,servingGrams:5,price:1000,bcaaMg:4000,energyPerServing:12};

test('powder costs use net mass and verified label serving and react to data updates',()=>{
 const {offer:r,issues}=normalizeUnitInputs({...powder,packServings:999,referenceCost:999,powderCost:999},definition);
 assert.deepEqual(issues,[]);assert.equal(r.packCount,null);assert.equal(r.servingUnits,null);assert.equal(r.packServings,50);assert.equal(r.unitCost,null);assert.equal(r.powderCost,4);assert.equal(r.servingCost,20);assert.equal(r.referenceCost,5);assert.equal(r.energy,240);
 assert.equal(normalizeUnitInputs({...powder,price:1500},definition).offer.referenceCost,7.5);
 assert.equal(normalizeUnitInputs({...powder,servingGrams:10},definition).offer.referenceCost,10);
 assert.equal(normalizeUnitInputs({...powder,bcaaMg:2000},definition).offer.referenceCost,10);
 assert.equal(filterOffers([r],{grams:['250'],servingGramsMin:'5',bcaaMgMin:'4000',complete:true},'bcaa',definition).length,1);
 assert.equal(filterOffers([r],{grams:['500']},'bcaa',definition).length,0);
});

test('unknown and invalid powder serving data never become marketed servings or active content',()=>{
 const r=normalizeUnitInputs({...powder,servingGrams:null,marketedServings:50},definition).offer;
 assert.equal(r.packServings,null);assert.equal(r.servingCost,null);assert.equal(r.referenceCost,null);assert.equal(r.energy,null);assert.equal(r.powderCost,4);assert.equal(completeUnitLabel(r,definition),false);
 for(const servingGrams of [-5,'5',0,300]){const x=normalizeUnitInputs({...powder,servingGrams},definition);assert.equal(x.offer.packServings,null);assert.ok(x.issues.some(i=>i.field==='servingGrams'&&i.severity==='error'));}
 for(const bcaaMg of ['4000',-1,6000])assert.ok(normalizeUnitInputs({...powder,bcaaMg},definition).issues.some(i=>i.field==='bcaaMg'&&i.severity==='error'));
 assert.ok(normalizeUnitInputs({...powder,packCount:50},definition).issues.some(i=>i.severity==='error'));
 assert.ok(normalizeUnitInputs({...powder,energyPerServing:1000},definition).issues.some(i=>i.field==='energyPerServing'&&i.severity==='error'));
});

test('amino acid subsets and carnitine compounds stay separate without inferred potency',()=>{
 assert.ok(normalizeUnitInputs({...powder,eaaMg:3000},definition).issues.some(i=>i.field==='bcaaMg'));
 assert.ok(normalizeUnitInputs({...powder,leucineMg:1000,isoleucineMg:1000,valineMg:1000},definition).issues.some(i=>i.field==='bcaaMg'));
 assert.ok(normalizeUnitInputs({...powder,bcaaMg:3000,leucineMg:4000},definition).issues.some(i=>i.field==='bcaaMg'&&i.severity==='error'));
 const c={...definition,id:'l-carnitine',mainNutrient:'carnitineMg',nutrientFields:[{key:'carnitineMg',label:'L-carnitine',unit:'mg'},{key:'carnitineCompoundMg',label:'Carnitine compound',unit:'mg',costQuantity:1000}]};
 const {offer:r}=normalizeUnitInputs({price:600,form:'Capsule',packCount:60,servingUnits:2,carnitineCompoundMg:1000},c);
 assert.equal(r.carnitineMg,null);assert.equal(r.referenceCost,null);assert.equal(r.costPer_carnitineCompoundMg,20);
});

test('pre-workout unknown total caffeine stays unknown when one caffeine component is disclosed',()=>{
 const c={...definition,id:'pre-workout',mainNutrient:'multi',nutrientFields:[{key:'caffeineMg',label:'Total caffeine',unit:'mg'},{key:'caffeineAnhydrousMg',label:'Caffeine anhydrous',unit:'mg'},{key:'citrullineMg',label:'Citrulline',unit:'mg'},{key:'citrullineMalateMg',label:'Citrulline malate',unit:'mg'}]};
 const {offer:r,issues}=normalizeUnitInputs({...powder,bcaaMg:null,caffeineAnhydrousMg:100,caffeineMg:null,citrullineMalateMg:2000,declaredNutrients:['caffeineMg','caffeineAnhydrousMg','citrullineMalateMg'],stimulantStatus:'Contains caffeine'},c);
 assert.ok(!issues.some(i=>i.severity==='error'));assert.equal(r.caffeineMg,null);assert.equal(r.citrullineMg,null);assert.equal(r.referenceCost,r.servingCost);assert.equal(completeUnitLabel(r,c),false);
 assert.ok(normalizeUnitInputs({...powder,stimulantStatus:'Labelled caffeine-free',caffeineMg:50,declaredNutrients:['caffeineMg']},c).issues.some(i=>i.field==='caffeineMg'&&i.severity==='error'));
 for(const [caffeineMg,caffeineAnhydrousMg,stimulantStatus] of [[0,100,'Labelled caffeine-free'],[50,100,'Contains caffeine'],[0,null,'Contains caffeine']])assert.ok(normalizeUnitInputs({...powder,caffeineMg,caffeineAnhydrousMg,stimulantStatus,declaredNutrients:['caffeineMg']},c).issues.some(i=>i.field==='caffeineMg'&&i.severity==='error'));
});

test('powder pack and serving labels and formula expose grams without null units',()=>{
 const r=normalizeUnitInputs(powder,definition).offer;
 r.priceAudit={status:'verified'};
 assert.equal(unitPack(r),'250 g powder');assert.equal(unitText(r),'5 g powder');
 const html=unitFormula(definition,[r],{money:n=>String(n),num:n=>String(n)});
 assert.match(html,/250 g powder/);assert.match(html,/50 label servings/);assert.ok(!html.includes('null units'));
});

test('five performance categories connect sourced packs, guides, filters and powder comparisons',async()=>{
 const s=createSnapshot(await loadBundle());assert.deepEqual(s.quality.errors,[]);
 for(const id of ['l-arginine','l-carnitine','bcaa','eaa','pre-workout']){
  const c=s.categories[id];assert.ok(c.offers.length);assert.ok(c.supportsPowder);assert.equal(s.research.articles.filter(a=>a.category===id).length,1);
  const found=searchCatalog(s,{q:id.replaceAll('-',' '),category:id});assert.ok(found.products.length);assert.equal(found.guides.length,1);
  for(const r of c.offers){assert.equal(r.priceAudit.status,'verified');assert.equal(r.trend.history.length,13);assert.ok(r.trend.history.filter(h=>!h.isCurrent).every(h=>!h.verified&&h.price==null));if(r.packServings==null)assert.equal(r.servingCost,null);else assert.equal(r.servingCost,r.price/r.packServings);}
  const powder=c.offers.find(r=>r.form==='Powder');if(powder){const rows=buildComparison(s,[{category:id,id:powder.id}]).rows;assert.match(rows.find(r=>r.id==='pack').values[0],/g powder/);assert.ok(rows.some(r=>r.id==='powder-cost'));}
 }
});

test('performance stack review stays optional and explains overlapping amino acids and stimulants',async()=>{
 const s=createSnapshot(await loadBundle()),result=recommend(s,{goals:['performance-claims'],context:'adult-clear',existing:['protein','creatine'],diet:'any',budget:''});
 for(const id of ['l-arginine','l-carnitine','bcaa','eaa','pre-workout']){const item=result.items.find(i=>i.category===id);assert.ok(item);assert.equal(item.eligible,false);assert.equal(item.review,true);assert.deepEqual(item.offers,[]);}
 assert.ok(result.warnings.some(w=>w.includes('BCAAs are three')));assert.ok(result.warnings.some(w=>w.includes('coffee')));assert.ok(result.warnings.some(w=>w.includes('duplicate ingredients')));
});

test('carnitine form searches match the actual chemical form rather than all category offers',async()=>{
 const s=createSnapshot(await loadBundle());
 for(const query of ['acetyl l carnitine','alcar']){const found=searchCatalog(s,{q:query,category:'l-carnitine'});assert.equal(found.guides.length,1);assert.ok(found.products.length);assert.ok(found.products.flatMap(p=>p.variants).every(r=>/acetyl/i.test(r.type)));}
 const tartrate=searchCatalog(s,{q:'lclt',category:'l-carnitine'}).products.flatMap(p=>p.variants);assert.ok(tartrate.length);assert.ok(tartrate.every(r=>/tartrate/i.test(r.type)));
});
