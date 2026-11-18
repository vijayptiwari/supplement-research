import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {guideMarkup,selectResearch} from '../docs/research.js';
import {productChecksFor,offerMatchesProductPolicy} from '../docs/product-policy.js';
import {productSelectionMarkup} from '../docs/guidance.js';
import {stackCategoryMarkup} from '../docs/stack-audit.js';
import {recommend} from '../docs/recommender.js';

const snapshot=loadBundle().then(createSnapshot),base={goals:['strength'],context:'adult-clear',existing:[],diet:'any',proteinGap:'yes',budget:'',milkAllergy:'no',fishAllergy:'no'};
const markup=(s,a)=>guideMarkup(a,s.categories[a.category],new Map(s.research.sources.map(r=>[r.id,r])),s.research.valuePolicy,s.research.intakePolicy,s.research.medicalPolicy,undefined,s.recommender.productPolicy,s.recommender.rules.find(r=>r.category===a.category),s.research.educationPolicy);

test('every guide presents sourced practical actions and value checks before its single product handoff',async()=>{
 const s=await snapshot;
 for(const a of s.research.articles){
  const p=a.buyingGuide.practices,html=markup(s,a),handoff=html.indexOf(`id="${a.id}-products"`),catalog=`href="${s.categories[a.category].page}"`;
  assert.ok(p.dos.length>=2&&p.donts.length>=2,a.category);assert.ok(p.sourceIds.every(id=>a.sourceIds.includes(id)));
  for(const key of ['process','practices','safety','value','labels','sources'])assert.ok(html.indexOf(`id="${a.id}-${key}"`)<handoff,a.category+key);
  assert.ok(!html.slice(0,handoff).includes(catalog),a.category+' premature comparison');assert.equal(html.split(catalog).length-1,1);
  for(const item of [...p.dos,...p.donts])assert.ok(html.includes(item.title.replaceAll('&','&amp;').replaceAll("'",'&#39;')));
  assert.ok(html.includes('Learning path'));assert.ok(html.includes('How to spot value for money'));
 }
});
test('the guide and stack review explain the same operational checks used by automatic candidates',async()=>{
 const s=await snapshot;
 for(const a of s.research.articles){
  const checks=productChecksFor(s.recommender.productPolicy,a.category),guide=markup(s,a),stack=stackCategoryMarkup(s,a.category,{profile:'hybrid',age:31});
  for(const check of checks){assert.ok(guide.includes(`data-selection-check="${check.id}"`),a.category+check.id);assert.ok(stack.includes(`data-selection-check="${check.id}"`));}
  if(s.recommender.rules.find(r=>r.category===a.category).review)assert.ok(guide.includes('stays in educational review'));
 }
});
test('changing a policy threshold updates the explanation and actual candidate filtering together',async()=>{
 const s=structuredClone(await snapshot),policy=s.recommender.productPolicy,check=policy.categories.creatine.find(c=>c.id==='creatine-concentration');
 assert.ok(recommend(s,base).items.find(i=>i.category==='creatine').offers.length);
 check.value=99;
 assert.ok(productSelectionMarkup(s.categories.creatine,policy).includes('99% labelled monohydrate'));
 assert.equal(recommend(s,base).items.find(i=>i.category==='creatine').offers.length,0);
});
test('common and category checks continue to reject unsuitable or unquantified purchase candidates',async()=>{
 const s=await snapshot,p=s.recommender.productPolicy,protein=recommend(s,base).items.find(i=>i.category==='protein').offers[0];
 for(const mutate of [r=>r.stock='Sold out',r=>r.priceAudit.status='unverified',r=>r.quality.errors=1,r=>r.cost=null]){const r=structuredClone(protein);mutate(r);assert.equal(offerMatchesProductPolicy(p,'protein',r,base),false);}
 assert.equal(offerMatchesProductPolicy(p,'protein',protein,{...base,budget:0}),false);
 assert.equal(offerMatchesProductPolicy(p,'protein',protein,{...base,milkAllergy:'yes'}),false);
 assert.equal(offerMatchesProductPolicy(p,'protein',{...protein,type:'Whey'},{...base,diet:'vegan'}),false);
 const creatine=recommend(s,base).items.find(i=>i.category==='creatine').offers[0];
 for(const extra of [{type:'HCL'},{creatine:90},{flavour:'Orange'}])assert.equal(offerMatchesProductPolicy(p,'creatine',{...creatine,...extra},base),false);
 const fish=recommend(s,{...base,goals:['diet-gaps']}).items[0].offers[0];
 for(const extra of [{epaDhaMg:null},{servingUnits:null}])assert.equal(offerMatchesProductPolicy(p,'fish-oil',{...fish,...extra},base),false);
 assert.equal(offerMatchesProductPolicy(p,'fish-oil',fish,{...base,diet:'vegan'}),false);
 assert.equal(offerMatchesProductPolicy(p,'fish-oil',fish,{...base,fishAllergy:'yes'}),false);
 assert.equal(offerMatchesProductPolicy(p,'magnesium',s.categories.magnesium.offers[0],base),false);
});
test('new practical guidance is searchable and retains its sources',async()=>{
 const s=await snapshot;
 for(const a of s.research.articles){const title=a.buyingGuide.practices.dos[0].title,r=selectResearch(s.research,{category:a.category,q:title});assert.equal(r.articles.length,1);assert.ok(a.buyingGuide.practices.sourceIds.every(id=>r.sources.some(s=>s.id===id)));}
});
test('missing practices, shared policies and unsafe or unexplained selection checks reject publication',async()=>{
 const original=await loadBundle();
 const changes=[b=>delete b.research.articles[0].buyingGuide.practices,b=>b.research.articles[0].buyingGuide.practices.donts=[],b=>b.research.articles[0].buyingGuide.practices.sourceIds=['missing'],b=>delete b.research.educationPolicy,b=>delete b.recommender.productPolicy,b=>b.recommender.productPolicy.common[0].field='constructor.prototype',b=>b.recommender.productPolicy.common[0].op='eval',b=>b.recommender.productPolicy.common[0].detail='',b=>b.recommender.productPolicy.categories.protein=[],b=>b.recommender.productPolicy.common.push(null)];
 for(const change of changes){const b=structuredClone(original);change(b);assert.ok(createSnapshot(b).quality.errors.some(e=>['research','recommender'].includes(e.field)));}
});
