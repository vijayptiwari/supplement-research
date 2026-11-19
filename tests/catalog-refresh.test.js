import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {auditStack} from '../docs/stack-audit.js';
import {referenceDefaults} from '../docs/intake.js';
import {catalogResearchMarkup} from '../docs/catalog-research.js';
import {otherIngredientsMarkup} from '../docs/unit-catalog.js';

const bundle=loadBundle(),snapshot=bundle.then(createSnapshot),read=name=>fs.readFile(new URL('../docs/data/'+name,import.meta.url),'utf8').then(JSON.parse);

test('every supplement gains exact sourced offers and the audit distinguishes price checks from label review',async()=>{
 const s=await snapshot,a=await read('catalog-research.json'),requirements=await read('catalog-data-requirements.json');
 assert.deepEqual(s.quality.errors,[]);assert.equal(a.coverage.length,s.config.categories.length);assert.equal(requirements.categories.length,s.config.categories.length);
 assert.equal(a.additions.length,a.summary.newOffers);assert.equal(a.summary.offers,s.stats.offers);
 for(const c of a.coverage){assert.ok(c.newOffers>=1,c.category);assert.equal(c.offers,s.categories[c.category].offers.length);assert.ok(c.priceCheckedOnAuditDate<=c.offers);assert.ok(c.labelsCheckedOnAuditDate<=c.offers);}
 for(const added of a.additions){const r=s.categories[added.category].offers.find(r=>String(r.id)===String(added.offerId));assert.ok(r);assert.ok(s.brands[r.brand],r.brand);assert.equal(r.labelChecked,a.checked);assert.equal(r.priceAudit.checked,a.checked);assert.equal(r.priceAudit.status,'verified');assert.ok(s.observations.some(o=>o.category===added.category&&String(o.offerId)===String(r.id)&&o.date===a.checked&&o.kind==='official-live'&&o.sourceUrl===r.url&&o.price===r.price));}
 assert.ok(a.summary.existingOffersPriceChecked<a.coverage.reduce((sum,c)=>sum+c.beforeOffers,0),'Unresolved exact variants must not be described as reverified.');
 for(const gap of a.research.filter(r=>['exact-price-unverified','not-refreshed'].includes(r.status))){const r=s.categories[gap.category].offers.find(r=>String(r.id)===String(gap.offerId));assert.equal(r.stock,'Listed; confirm stock');assert.notEqual(r.priceAudit.checked,a.checked);}
 const html=catalogResearchMarkup(s);assert.ok(html.includes('These are separate checks.'));assert.ok(html.includes('catalog-data-requirements.json'));assert.ok(html.includes('catalog-research.json'));
});

test('reviewed missing or contradictory ingredient amounts stay unknown rather than acquiring active costs',async()=>{
 const s=await snapshot,g=s.categories.glutathione.offers.find(r=>r.id==='glutathione-39591594164304');assert.ok(g);assert.equal(g.glutathioneMg,null);assert.equal(g.referenceCost,null);assert.ok(g.notes.includes('Conflict'));
 const z=s.categories.zmc.offers.find(r=>r.brand==='Carbamide Forte');assert.ok(z);assert.equal(z.servingUnits,null);for(const key of ['calciumMg','magnesiumMg','zincMg'])assert.equal(z[key],null);assert.equal(z.servingCost,null);
 const biotin=s.categories.biotin.offers.find(r=>r.brand==='Carbamide Forte');assert.ok(biotin);assert.equal(biotin.biotinMcg,40);assert.ok(biotin.biotinMcg<10000);
});

test('collagen accounting preserves distinct material bases and counts known co-ingredients',async()=>{
 const s=await snapshot,c=s.categories.collagen,peptide=c.offers.find(r=>r.id==='collagen-42667417108651'),complex=c.offers.find(r=>r.id==='collagen-49980078063901');
 assert.equal(c.mainNutrient,'multi');assert.equal(peptide.collagenPeptidesMg,10120);assert.equal(peptide.collagenComplexMg,null);assert.equal(complex.collagenComplexMg,1800);assert.equal(complex.collagenPeptidesMg,null);
 assert.equal(peptide.packServings,300/10.2);assert.equal(complex.packServings,30);assert.equal(complex.servingCost,complex.price/30);
 const result=auditStack(s,[{category:'collagen',offerId:complex.id,quantity:4}],referenceDefaults());assert.ok(result.rows.some(r=>r.key==='collagenComplexMg:'+complex.id&&r.amount===1800));assert.ok(!result.rows.some(r=>r.key==='protein'));assert.ok(result.gaps.some(g=>g.includes('Black pepper')));
});

test('other declared ingredients are escaped and are visible gaps in stack totals',async()=>{
 const s=await snapshot,r=s.categories.melatonin.offers.find(r=>r.id==='melatonin-44687355478301');assert.ok(r.notes.includes('Contains milk'));assert.ok(otherIngredientsMarkup(r).includes('Lactium'));
 const result=auditStack(s,[{category:'melatonin',offerId:r.id,quantity:1}],referenceDefaults());assert.ok(result.rows.some(x=>x.key==='melatoninMg'&&x.amount===3));assert.ok(result.gaps.some(x=>x.includes('Lactium')));
 assert.ok(!otherIngredientsMarkup({additionalIngredients:[{name:'<script>bad()</script>',amount:null,unit:'mg'}]}).includes('<script>'));
});

test('invalid audit coverage cannot replace the validated public snapshot',async()=>{
 const original=await bundle;for(const change of [r=>r.coverage.pop(),r=>r.summary.newOffers=-1,r=>r.requirementsFile='../../untrusted.html',r=>r.checked='invalid']){const b=structuredClone(original);change(b.catalogResearch);assert.ok(createSnapshot(b).quality.errors.some(e=>e.field==='catalogResearch'));}
});

test('protein co-ingredients remain explicit gaps and malformed ingredient lists cannot publish',async()=>{
 const s=await snapshot,r=s.categories.protein.offers.find(r=>r.id==='pr-scitron-45884819407001'),result=auditStack(s,[{category:'protein',offerId:r.id,quantity:37}],referenceDefaults());assert.ok(result.gaps.some(g=>g.includes('Calcium HMB')));assert.ok(!result.rows.some(x=>x.key==='hmbMg'));
 const b=structuredClone(await bundle),row=b.categories.protein.offers.find(r=>r.id==='pr-scitron-45884819407001');row.additionalIngredients='invalid';assert.ok(createSnapshot(b).quality.errors.some(e=>e.field==='additionalIngredients'));
});
