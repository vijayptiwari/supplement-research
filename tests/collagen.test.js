import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildSite,loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot,pageMetadata} from '../docs/model.js';
import {editorialCategories,selectEditorial,editorialMarkup} from '../docs/articles.js';
import {validateLearningContent} from '../docs/learning-validation.js';
import {guideMarkup} from '../docs/research.js';
import {searchCatalog} from '../docs/search.js';
import {recommend} from '../docs/recommender.js';
import {stackCategoryMarkup} from '../docs/stack-audit.js';
import {referenceDefaults,matchingReferences} from '../docs/intake.js';

const snapshot=loadBundle().then(createSnapshot);
const base={goals:['strength'],context:'adult-clear',diet:'any',proteinGap:'yes',existing:[],budget:'',milkAllergy:'no',fishAllergy:'no'};
const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
function assertInternalLinks(html){const all=ids(html);assert.equal(all.length,new Set(all).size);for(const [,target]of html.matchAll(/href="#([^"]+)"/g))assert.ok(all.includes(target),'Missing destination '+target);}
function guide(s,category){const a=s.research.articles.find(a=>a.category===category);return guideMarkup(a,s.categories[category],new Map(s.research.sources.map(r=>[r.id,r])),s.research.valuePolicy,s.research.intakePolicy,s.research.medicalPolicy,referenceDefaults(),s.recommender.productPolicy,s.recommender.rules.find(r=>r.category===category),s.research.educationPolicy,s.research.pathwayPolicy,s.research.editorial);}

test('comparison discovery includes primary and related categories without mutating the published entry',async()=>{
 const s=await snapshot,e=s.research.editorial,a=e.articles.find(a=>a.id==='eaa-bcaa-protein'),original=structuredClone(a);
 assert.deepEqual(editorialCategories(a),['protein','eaa','bcaa']);
 for(const category of ['protein','eaa','bcaa']){
  assert.ok(selectEditorial(e,{series:'comparisons',category,q:'EAA BCAA protein'}).some(x=>x.id===a.id));
  assert.ok(searchCatalog(s,{kind:'guides',category,q:'EAA BCAA protein'}).guides.some(x=>x.id===a.id));
  assert.ok(guide(s,category).includes('article-'+a.id+'.html'));
 }
 assert.deepEqual(a,original);assert.ok(!selectEditorial(e,{category:'melatonin',q:'EAA BCAA protein'}).some(x=>x.id===a.id));
});

test('global search totals count a cross-category article once while facets retain its relevant topics',async()=>{
 const s=await snapshot,all=searchCatalog(s,{kind:'guides',q:'EAA BCAA protein'});
 assert.equal(all.allCategoryTotal,all.guides.length);
 assert.ok(all.facets.filter(f=>['protein','eaa','bcaa'].includes(f.id)).every(f=>f.guides>=1));
 const filtered=searchCatalog(s,{kind:'guides',category:'bcaa',q:'EAA BCAA protein'});
 assert.equal(filtered.allCategoryTotal,all.allCategoryTotal);
 assert.equal(new Set(all.guides.map(a=>a.id)).size,all.guides.length);
});

test('comparison summaries render cited table cells, mobile cards and resolved source anchors',async()=>{
 const s=await snapshot;
 for(const a of s.research.editorial.articles.filter(a=>a.comparison)){
  const html=editorialMarkup(a,s);assertInternalLinks(html);
  assert.ok(html.includes('class="editorial-comparison-table"'));assert.ok(html.includes('class="editorial-comparison-cards"'));
  assert.ok(html.includes('scope="row"')&&html.includes('scope="col"'));
  assert.ok(html.indexOf('AT A GLANCE')<html.indexOf('class="editorial-next"'));
  assert.ok(!html.includes('Reference unavailable'));
  for(const row of a.comparison.rows){for(const column of a.comparison.columns)assert.ok(html.includes(row.values[column.key].replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')));for(const id of row.sourceIds)assert.ok(html.includes('href="#editorial-'+a.id+'-ref-'+id+'"'));}
 }
 const a=structuredClone(s.research.editorial.articles.find(a=>a.comparison));a.comparison.rows[0].values[a.comparison.columns[0].key]='<img src=x onerror="bad()">';
 assert.ok(editorialMarkup(a,s).includes('&lt;img src=x onerror=&quot;bad()&quot;&gt;'));assert.ok(!editorialMarkup(a,s).includes('<img src=x'));
});

test('malformed comparison revisions and invalid related-category membership cannot publish',async()=>{
 const s=await snapshot,baseArticle=s.research.editorial.articles.find(a=>a.comparison),mutations=[
  a=>a.comparison.columns[1].key=a.comparison.columns[0].key,
  a=>delete a.comparison.rows[0].values[a.comparison.columns[0].key],
  a=>a.comparison.rows[0].sourceIds=['unresolved-source'],
  a=>a.comparison.rows=[],a=>a.comparison.columns='invalid',
  a=>a.relatedCategories=[a.category],a=>a.relatedCategories=['unknown-category'],a=>a.relatedCategories=['eaa','eaa']
 ];
 for(const mutate of mutations){const r=structuredClone(s.research),a=r.editorial.articles.find(a=>a.id===baseArticle.id),errors=[];mutate(a);validateLearningContent(r,s.categories,e=>errors.push(e));assert.ok(errors.length);}
});

function educationBundle(){return {config:{schemaVersion:1,name:'Research',baseUrl:'https://example.org/',currency:'INR',rankingLimit:5,maxPriceAgeDays:100,refreshIntervalMs:60000,pageSizes:{flat:20,grouped:10},quickPicks:[],categories:[{id:'collagen',label:'Collagen',file:'collagen.json',page:'collagen.html',measurement:'education',educationOnly:true,compoundLabel:'collagen material'}]},categories:{collagen:{checked:'2026-11-18',offers:[],scope:'Education only; no product offers have been audited.'}},observations:[],brands:{}};}

test('education-only categories publish dated scope and zero offers without manufactured pricing data',()=>{
 const b=educationBundle(),s=createSnapshot(b);assert.deepEqual(s.quality.errors,[]);assert.deepEqual(s.categories.collagen.offers,[]);assert.equal(s.categories.collagen.educationOnly,true);assert.equal(s.categories.collagen.scope,b.categories.collagen.scope);assert.equal(s.stats.offers,0);
 for(const mutate of [b=>b.config.categories[0].educationOnly=false,b=>b.categories.collagen.offers=[{}],b=>b.observations=[{category:'collagen',qualityStatus:'excluded'}],b=>b.categories.collagen.scope='',b=>b.categories.collagen.checked='invalid',b=>b.config.categories[0].measurement='units']){
  const bad=educationBundle();mutate(bad);assert.throws(()=>createSnapshot(bad),/Education-only/i);
 }
});

test('the collagen guide exposes sourced food quantities, adult intake limits, medical context and distinct pathways',async()=>{
 const s=await snapshot,c=s.categories.collagen,a=s.research.articles.find(a=>a.category==='collagen'),refs=new Set(s.research.sources.map(r=>r.id));
 assert.deepEqual(s.quality.errors,[]);assert.ok(c.educationOnly);assert.equal(c.offers.length,0);assert.equal(c.stats.offers,0);
 assert.ok(a.buyingGuide.practices.dos.length&&a.buyingGuide.practices.donts.length);assert.ok(a.medicalGuide.conditions.length);
 assert.ok(a.pathway.tracks.length>=2);assert.ok(a.pathway.sourceIds.every(id=>refs.has(id)&&a.sourceIds.includes(id)));
 for(const food of a.buyingGuide.foods){assert.ok(food.quantityNote);if(food.quantityStatus==='quantified')for(const amount of food.amounts){assert.ok(amount.per.label);assert.ok(amount.sourceIds.every(id=>refs.has(id)));}else assert.deepEqual(food.amounts,[]);}
 assert.ok(!a.intakeGuide.targets.some(t=>t.referenceType==='RDA'));
 assert.deepEqual(matchingReferences(a.intakeGuide.targets,{age:31,profile:'strength-power',sessions:2}),matchingReferences(a.intakeGuide.targets,{age:31,profile:'strength-power',sessions:5}));
 assert.ok(searchCatalog(s,{category:'collagen',kind:'guides',q:'collagen'}).guides.some(x=>x.id==='collagen-guide'));
 assert.equal(searchCatalog(s,{category:'collagen',kind:'products'}).totals.products,0);
});

test('collagen remains a review item even when held and never replaces complete-protein guidance',async()=>{
 const s=await snapshot,rule=s.recommender.rules.find(r=>r.category==='collagen');assert.ok(rule.review);
 for(const existing of [[],['collagen','protein']]){const result=recommend(s,{...base,goals:rule.goals,existing}),item=result.items.find(i=>i.category==='collagen');assert.ok(item.review);assert.equal(item.eligible,false);assert.deepEqual(item.offers,[]);if(existing.length){assert.ok(item.held);assert.ok(result.warnings.some(w=>w.includes('Collagen is not an equivalent replacement')));}}
 const overlaps=recommend(s,{...base,goals:['performance-claims'],existing:['protein','eaa','bcaa','collagen']});assert.ok(overlaps.warnings.some(w=>w.includes('BCAAs are three')));
});

test('stack notes reuse collagen information and comparison links across the affected categories',async()=>{
 const s=await snapshot;
 for(const category of ['protein','eaa','bcaa'])assert.ok(stackCategoryMarkup(s,category,referenceDefaults()).includes('article-eaa-bcaa-protein.html'));
 const html=stackCategoryMarkup(s,'collagen',referenceDefaults());for(const phrase of ['Who it suits','Food alternatives','Intake references','Medical conditions','Do’s, don’ts','Safety, interactions','Comparisons and related articles'])assert.ok(html.includes(phrase));
 assert.ok(html.includes('article-collagen-vs-protein.html'));assert.ok(!html.includes('data-offer='));
});

test('collagen education readers have learning handoffs without empty or fictitious catalog calls to action',async()=>{
 const s=await snapshot,html=guide(s,'collagen');assertInternalLinks(html);
 assert.ok(html.includes('CONTINUE LEARNING'));assert.ok(html.includes(s.categories.collagen.scope));
 assert.ok(!html.includes('Explore Collagen products'));assert.ok(!html.includes('0 exact pack offers'));assert.ok(!html.includes('href="collagen.html"'));
 for(const a of s.research.editorial.articles.filter(a=>a.category==='collagen')){const reader=editorialMarkup(a,s);assertInternalLinks(reader);assert.ok(!reader.includes('Explore Collagen products'));assert.ok(!reader.includes('href="collagen.html"'));assert.ok(reader.includes('guide-collagen.html'));}
});

test('build publishes the collagen education landing, dated scope and article discovery without a catalog identity',async()=>{
 const destination=await fs.mkdtemp(path.join(os.tmpdir(),'collagen-learning-'));
 try{const {snapshot:s,assetVersion}=await buildSite(destination),html=await fs.readFile(path.join(destination,'collagen.html'),'utf8'),data=JSON.parse(await fs.readFile(path.join(destination,'data/collagen.json'),'utf8')),metadata=pageMetadata(s,'collagen');
  assert.ok(html.includes('data-page="research"')&&html.includes('data-default-category="collagen"'));assert.ok(html.includes('id="research-library"'));assert.ok(html.includes(`site.js?v=${assetVersion}`));assert.ok(html.includes('Collagen: benefits, evidence &amp; buying guide'));assert.ok(!html.includes('Collagen catalog ·'));
  assert.equal(metadata.structured['@type'],'Article');assert.equal(data.scope,s.categories.collagen.scope);assert.deepEqual(data.offers,[]);
  const sitemap=await fs.readFile(path.join(destination,'sitemap.xml'),'utf8');assert.ok(sitemap.includes('collagen.html'));assert.ok(sitemap.includes('article-eaa-bcaa-protein.html'));assert.ok(sitemap.includes('article-collagen-vs-protein.html'));
 }finally{await fs.rm(destination,{recursive:true,force:true});}
});
