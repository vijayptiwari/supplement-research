import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {auditStack} from '../docs/stack-audit.js';
import {referenceDefaults} from '../docs/intake.js';

const snapshot=loadBundle().then(createSnapshot);

test('HK Vitals fish oil cost uses EPA plus DHA, independently of total oil mass',async()=>{
 const s=await snapshot,c=s.categories['fish-oil'];
 for(const [id,count,oil,epa,dha] of [['fish-oil-hkv-185660',60,1000,180,120],['fish-oil-hkv-185722',90,1000,180,120],['fish-oil-hkv-259099',60,1150,525,375]]){
  const r=c.offers.find(r=>r.id===id);assert.ok(r);assert.equal(r.packCount,count);assert.equal(r.servingUnits,1);assert.equal(r.fishOilMg,oil);assert.equal(r.epaMg,epa);assert.equal(r.dhaMg,dha);assert.equal(r.epaDhaMg,epa+dha);
  assert.equal(r.referenceCost,r.price/(count*(epa+dha))*c.referenceQuantity);assert.equal(r.priceAudit.status,'verified');assert.ok(r.url.includes('navKey=VRNT-'));
 }
});

test('collagen flavour and retail-size labels retain their own serving and co-nutrient values',async()=>{
 const s=await snapshot,c=s.categories.collagen,find=id=>c.offers.find(r=>r.id==='collagen-hkv-'+id);
 const coffee=find(291407),orange100=find(234963),orange200=find(185734),plain=find(269759),bundle=find(277467);
 assert.equal(coffee.vitaminCMg,65);assert.equal(orange200.vitaminCMg,40);assert.equal(orange100.energyPerServing,27.81);assert.equal(orange200.energyPerServing,27.98);
 assert.equal(orange200.servingGrams,8);assert.equal(plain.servingGrams,5);assert.equal(plain.collagenPeptidesMg,5000);assert.equal(plain.vitaminCMg,null);
 assert.equal(bundle.grams,400);assert.match(bundle.packaging,/2 × 200 g/);assert.equal(bundle.packServings,50);
 for(const r of [coffee,orange100,orange200,plain,bundle]){assert.equal(r.collagenComplexMg,null);assert.equal(r.nativeTypeIIMg,null);assert.equal(r.hyaluronicAcidMg,null);assert.ok(r.labelSources.length>=2);}
});

test('HK Vitals combination products contribute verified co-nutrients and expose unmodeled ingredients',async()=>{
 const s=await snapshot,r=s.categories.collagen.offers.find(r=>r.id==='collagen-hkv-257623'),result=auditStack(s,[{category:'collagen',offerId:r.id,quantity:8}],referenceDefaults());
 for(const [key,amount] of [['glutathioneMg',125],['zincMg',8.5],['biotinMcg',20],['vitaminCMg',40]])assert.ok(result.rows.some(x=>x.key===key&&x.amount===amount),key);
 assert.ok(result.gaps.some(x=>x.includes('Licorice')));assert.ok(result.gaps.some(x=>x.includes('Sodium hyaluronate')));assert.ok(!result.rows.some(x=>x.key==='protein'));
 const melatonin=s.categories.melatonin.offers.find(r=>r.id==='melatonin-hkv-282201');assert.equal(melatonin.melatoninMg,10);assert.ok(melatonin.additionalIngredients.some(i=>i.name.startsWith('Tagar')&&i.amount===250));
});
