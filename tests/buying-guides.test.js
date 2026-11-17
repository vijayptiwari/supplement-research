import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {selectResearch,guideMarkup} from '../docs/research.js';
import {searchCatalog} from '../docs/search.js';
import {buyingPriority,buyingOffer} from '../docs/guidance.js';
import {categoryPrimer} from '../docs/marketplace.js';

test('every current category has sourced audience, food and conditional purchase guidance',async()=>{
 const s=createSnapshot(await loadBundle());assert.deepEqual(s.quality.errors,[]);
 for(const c of Object.values(s.categories)){
  const a=s.research.articles.find(a=>a.category===c.id),g=a.buyingGuide;assert.ok(g.whoCanConsider.length);assert.ok(g.whoShouldReview.length);assert.ok(g.foodSummary);assert.ok(g.foodSourceIds.length);assert.ok(g.value.sourceIds.length);assert.ok(g.value.targetedUse);assert.ok(g.value.scope);
  for(const score of [g.value.routineScore,g.value.targetedScore])assert.ok(Number.isInteger(score)&&score>=1&&score<=5);
  const html=guideMarkup(a,c,new Map(s.research.sources.map(r=>[r.id,r])),s.research.valuePolicy);
  for(const part of ['who','foods','value']){assert.ok(html.includes(`id="${a.id}-${part}"`));assert.ok(html.includes(`href="#${a.id}-${part}"`));}
  const offer=buyingOffer(s,c);assert.ok(offer.includes('CATEGORY BUYING GUIDE'));assert.ok(offer.includes(g.value.targetedUse.replaceAll('&','&amp;')));assert.ok(offer.includes(g.value.scope.replaceAll('&','&amp;')));
 }
});

test('food and audience searches retrieve guides and retain their references',async()=>{
 const s=createSnapshot(await loadBundle());
 for(const a of s.research.articles.filter(a=>a.buyingGuide.foods.length)){
  const q=a.buyingGuide.foods[0].name,result=selectResearch(s.research,{category:a.category,q});assert.equal(result.articles.length,1,a.category);
  assert.ok(a.buyingGuide.foodSourceIds.every(id=>result.sources.some(source=>source.id===id)));
  assert.ok(searchCatalog(s,{category:a.category,q}).guides.some(g=>g.id===a.id));
 }
});

test('priority filters apply the chosen context and data updates change displays without changing prices',async()=>{
 const b=await loadBundle(),a=b.research.articles.find(a=>a.category==='protein'),oldPrice=b.categories.protein.offers[0].price;
 a.buyingGuide.value.routineScore=1;a.buyingGuide.value.targetedScore=5;
 let s=createSnapshot(b);
 assert.equal(selectResearch(s.research,{category:'protein',priority:4,priorityContext:'routine'}).articles.length,0);
 assert.equal(selectResearch(s.research,{category:'protein',priority:4,priorityContext:'targeted'}).articles.length,1);
 a.buyingGuide.value.routineScore=4;s=createSnapshot(b);
 assert.equal(selectResearch(s.research,{category:'protein',priority:4,priorityContext:'routine'}).articles.length,1);
 assert.ok(buyingPriority(a.buyingGuide,s.research.valuePolicy).includes('4 out of 5 editorial purchase priority'));
 assert.equal(s.categories.protein.offers[0].price,oldPrice);
 const filtered=selectResearch(s.research,{priority:5,priorityContext:'targeted'}),cited=new Set(filtered.articles.flatMap(a=>a.sourceIds));assert.equal(filtered.sources.length,cited.size);assert.ok(filtered.sources.every(source=>cited.has(source.id)));
});

test('missing policy, malformed ratings, incomplete context and unresolved food sources reject publication',async()=>{
 const original=await loadBundle();
 const mutations=[b=>delete b.research.valuePolicy,b=>b.research.valuePolicy=null,b=>b.research.valuePolicy.scale[0]=null,b=>b.research.articles[0].buyingGuide.value.routineScore=6,b=>b.research.articles[0].buyingGuide.value.targetedScore='5',b=>b.research.articles[0].buyingGuide.value.targetedUse='',b=>b.research.articles[0].buyingGuide.foodSourceIds=['missing'],b=>b.research.articles[0].buyingGuide.foods=[null],b=>delete b.research.articles[0].buyingGuide];
 for(const mutate of mutations){const b=structuredClone(original);mutate(b);assert.ok(createSnapshot(b).quality.errors.some(e=>e.field==='research'));}
 const old=structuredClone(original);delete old.research.valuePolicy;for(const a of old.research.articles)delete a.buyingGuide;const legacy=createSnapshot(old);assert.deepEqual(legacy.quality.errors,[]);const html=categoryPrimer(legacy,legacy.categories.protein);assert.ok(html.includes('How it works'));assert.ok(!html.includes('-guide-foods')&&!html.includes('-guide-value'));
});

test('food-form distinctions and narrow high-priority uses remain explicit in published guidance',async()=>{
 const s=createSnapshot(await loadBundle()),get=id=>s.research.articles.find(a=>a.category===id).buyingGuide;
 assert.ok(get('hmb').foods.every(f=>f.relationship!=='direct'));
 assert.ok(get('fish-oil').foods.some(f=>f.relationship==='different-form'&&/ALA|alpha/i.test(f.detail)));
 assert.match(get('creatine').value.scope,/monohydrate/i);assert.match(get('vitamin-b').value.scope,/specific|appropriate|missing|B12/i);
 assert.ok(get('ashwagandha').whoShouldReview.some(text=>/avoid.*pregnan/i.test(text)));
 const c=s.categories.creatine,primer=categoryPrimer(s,c);assert.ok(primer.includes('purchase priority'));assert.ok(!primer.includes('AggregateRating'));
});
