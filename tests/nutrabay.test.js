import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot,retailerQuoteIssues} from '../docs/model.js';
import {offerMatchesProductPolicy} from '../docs/product-policy.js';
import {auditStack} from '../docs/stack-audit.js';
import {referenceDefaults} from '../docs/intake.js';

const snapshot=loadBundle().then(createSnapshot);

test('Nutrabay retailer quotes pin their product and variant on the correct portal',()=>{
 const quote={retailer:'Nutrabay',price:379,currency:'INR',checked:'2026-11-20',sourceUrl:'https://nutrabay.com/product/gnc-fish-body-oil-softgel-1000mg?pId=1695028&vId=8363178',variantId:'8363178',productId:'1695028',matchBasis:'Exact brand, 60-softgel pack, SKU and composition reviewed.'};
 assert.deepEqual(retailerQuoteIssues([quote],'2026-11-20'),[]);
 for(const patch of [{variantId:'1'},{productId:'1'},{sourceUrl:quote.sourceUrl+'&vId=1'},{sourceUrl:quote.sourceUrl.replace('nutrabay.com','unrelated.example')},{sourceUrl:quote.sourceUrl.replace('&vId=8363178','')},{sourceUrl:quote.sourceUrl.replace('pId=1695028','pId=bad')}])assert.ok(retailerQuoteIssues([{...quote,...patch}],'2026-11-20').some(e=>e.severity==='error'));
});

test('Nutrabay creatine formulas retain actual compound percentages instead of purity advertising',async()=>{
 const s=await snapshot,c=s.categories.creatine,pure=c.offers.find(r=>r.id==='creatine-nb-4334621'),gold=c.offers.find(r=>r.id==='creatine-nb-3038491');
 assert.equal(pure.creatine,96.8);assert.equal(pure.scoop,3.1);assert.equal(pure.energy,6.12);assert.ok(pure.additionalIngredients.some(i=>i.name.includes('FOS')&&i.amount===100));
 assert.equal(gold.creatine,75);assert.equal(gold.scoop,4);assert.equal(gold.creatineServing,3);assert.equal(gold.energy,0);
 assert.equal(offerMatchesProductPolicy(s.recommender.productPolicy,'creatine',pure,{}),false);
});

test('Nutrabay amino acids and stimulants keep compound and component boundaries',async()=>{
 const s=await snapshot,cm=s.categories.citrulline.offers.find(r=>r.id==='citrulline-nb-9059870'),carn=s.categories['l-carnitine'].offers.find(r=>r.id==='l-carnitine-nb-6398653'),spark=s.categories['pre-workout'].offers.find(r=>r.id==='pre-workout-nb-1560762');
 assert.equal(cm.citrullineMalateMg,2500);assert.equal(cm.citrullineMg,null);assert.equal(carn.carnitineCompoundMg,1000);assert.equal(carn.carnitineMg,null);assert.equal(carn.referenceCost,null);
 assert.equal(spark.caffeineMg,200);assert.equal(spark.citrullineMalateMg,3000);assert.equal(spark.citrullineMg,null);
 const result=auditStack(s,[{category:'pre-workout',offerId:spark.id,quantity:10}],referenceDefaults());assert.ok(result.rows.some(r=>r.key==='caffeineMg'&&r.amount===200));
});

test('Nutrabay fish oil and carrier formulations do not overstate active payloads',async()=>{
 const s=await snapshot,fish=s.categories['fish-oil'].offers.find(r=>r.id==='fish-oil-nb-6255885');assert.equal(fish.fishOilMg,1250);assert.equal(fish.epaDhaMg,840);
 for(const [category,id,key] of [['glutathione','glutathione-nb-2239568','glutathioneMg'],['vitamin-c','vitamin-c-nb-5281558','vitaminCMg']]){const r=s.categories[category].offers.find(r=>r.id===id);assert.equal(r[key],null);assert.equal(r.referenceCost,null);assert.ok(r.additionalIngredients[0].amount>0);}
 const collagen=s.categories.collagen.offers.find(r=>r.id==='collagen-nb-8144042');assert.equal(collagen.collagenPeptidesMg,12000);assert.equal(collagen.nativeTypeIIMg,40);
});

test('fortified protein requires review and existing Nutrabay identities remain stable',async()=>{
 const s=await snapshot,r=s.categories.protein.offers.find(r=>r.id==='protein-nb-9960505');assert.equal(r.protein,40);assert.equal(r.requiresProductReview,true);assert.equal(offerMatchesProductPolicy(s.recommender.productPolicy,'protein',r,{milkAllergy:'no',diet:'any'}),false);
 const beta=s.categories['beta-alanine'].offers.find(r=>r.id==='beta-alanine-nutrabay-6440277');assert.equal(beta.servingGrams,5);assert.equal(beta.betaAlanineMg,5000);assert.equal(beta.stock,'Sold out');assert.ok(!s.categories['beta-alanine'].offers.some(r=>r.id==='beta-alanine-nb-6440277'));
});
