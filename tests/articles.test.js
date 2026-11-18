import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {editorialMarkup,editorialReadingMinutes,selectEditorial} from '../docs/articles.js';
import {validateLearningContent} from '../docs/learning-validation.js';
import {buildSite,loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {searchCatalog} from '../docs/search.js';

function fixture(){
 const sources=[{id:'review-source',title:'Original review',url:'https://example.org/review',kind:'Review',year:2026,checked:'2026-11-18',limitations:'Population and design matter.'},{id:'pathway-source',title:'Original mechanism source',url:'https://example.org/mechanism',kind:'Expert overview',year:2026,checked:'2026-11-18',limitations:'A mechanism does not establish an outcome.'}];
 const pathway={title:'A shared body-process diagram',summary:'An educational schematic.',caveat:'A simplified process.',sourceIds:['pathway-source'],tracks:[{label:'A biological process',steps:['Input','Transport','Use'].map((label,index)=>({label,detail:`Process stage ${index+1}.`,compartment:'Body',icon:'molecule'}))}]};
 const base={category:'creatine',series:'myth-busters',title:'Creatine claims, checked',summary:'Understand evidence before choosing a product.',author:'Editorial team',reviewed:'2026-11-18',intro:'Start with the claim and its limits.',sections:[{id:'limits',title:'Where certainty ends',body:'Consider the study population and limits.',sourceIds:['review-source']}],sourceIds:['review-source']};
 const myths=Array.from({length:10},(_,index)=>({claim:`Claim ${index+1}`,verdict:'Requires context',explanation:'An individually sourced explanation.',sourceIds:['review-source']}));
 const forms=[{kind:'ingredient',name:'Ingredient example',description:'A chemical form or ingredient type.',metabolism:'A metabolic explanation.',evidence:'Ingredient evidence.',value:'An ingredient value check.',sourceIds:['review-source']},{kind:'delivery',name:'Delivery example',description:'A delivery format.',metabolism:'Delivery context.',evidence:'Delivery evidence.',value:'Delivery cost context.',sourceIds:['review-source']}];
 const articles=[{...structuredClone(base),id:'creatine-myths',myths:structuredClone(myths)},{...structuredClone(base),id:'protein-myths',category:'protein',title:'Protein claims, checked',myths:structuredClone(myths)},{...structuredClone(base),id:'creatine-types',series:'understanding-types',title:'Creatine types and formats',forms:structuredClone(forms)},{...structuredClone(base),id:'protein-types',category:'protein',series:'understanding-types',title:'Protein types and formats',forms:structuredClone(forms)}];
 return {config:{name:'Research',baseUrl:'https://example.org/'},categories:{creatine:{id:'creatine',label:'Creatine',page:'creatine.html'},protein:{id:'protein',label:'Protein',page:'protein.html'}},research:{sources,pathwayPolicy:{reviewed:'2026-11-18',summary:'Schematic explanations have limits.'},articles:['creatine','protein'].map(category=>({id:category+'-guide',category,pathway:structuredClone(pathway),sourceIds:['pathway-source']})),editorial:{reviewed:'2026-11-18',description:'A library of cited explanations.',series:[{id:'myth-busters',label:'Myth Busters',description:'Check claims against the evidence.'},{id:'understanding-types',label:'Understanding Types',description:'Separate ingredient types and delivery formats.'}],articles}}};
}

const checkAnchors=html=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(new Set(ids).size,ids.length,'Every article DOM ID must be unique.');
 for(const match of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(match[1]),'Missing link destination: '+match[1]);
 for(const match of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g))for(const id of match[1].split(/\s+/))assert.ok(ids.includes(id),'Missing accessible relationship: '+id);
};

test('editorial filtering combines series, category and normalized AND-term search without mutating data',()=>{
 const s=fixture(),e=s.research.editorial,original=structuredClone(e);
 assert.deepEqual(selectEditorial(e).map(a=>a.id),['creatine-myths','protein-myths','creatine-types','protein-types']);
 assert.equal(selectEditorial(e)[0],e.articles[0]);
 assert.deepEqual(selectEditorial(e,{series:'myth-busters',category:'protein',q:'claim limits'}).map(a=>a.id),['protein-myths']);
 assert.deepEqual(selectEditorial(e,{q:'CRÉATINE claims'}).map(a=>a.id),['creatine-myths']);
 assert.equal(selectEditorial(e,{q:'delivery metabolic'}).length,2);
 assert.equal(selectEditorial(e,{series:'unknown'}).length,0);
 assert.equal(selectEditorial(e,{q:'does-not-exist'}).length,0);
 assert.deepEqual(selectEditorial(undefined),[]);assert.deepEqual(e,original);
});

test('article readers render ten myth checks or both form classifications before their product handoff',()=>{
 const s=fixture();
 for(const a of s.research.editorial.articles){
  const html=editorialMarkup(a,s),handoff=html.indexOf('class="editorial-next"');
  checkAnchors(html);
  assert.ok(html.indexOf('class="editorial-intro"')<handoff);
  assert.ok(html.indexOf('class="editorial-references"')<handoff);
  assert.ok(!html.slice(0,handoff).includes(`href="${s.categories[a.category].page}"`));
  assert.equal((html.match(new RegExp(`href="${s.categories[a.category].page}"`,'g'))||[]).length,1);
  assert.ok(html.includes(`href="research.html?category=${a.category}"`));
  assert.ok(html.includes(`datetime="${a.reviewed}"`));
  if(a.myths)assert.equal((html.match(/class="editorial-myth"/g)||[]).length,10);
  if(a.forms){assert.ok(html.includes('INGREDIENT / CHEMICAL FORM'));assert.ok(html.includes('DELIVERY FORMAT'));for(const form of a.forms)assert.ok(html.includes(form.metabolism));}
 }
});

test('article readers reuse the category mechanism and include its original sources once in the bibliography',()=>{
 const s=fixture(),a=s.research.editorial.articles[0],html=editorialMarkup(a,s);
 assert.ok(!a.sourceIds.includes('pathway-source'),'The reused diagram has its own source registry links.');
 assert.ok(html.includes('class="pathway-figure"'));assert.ok(html.includes('A shared body-process diagram'));
 assert.equal((html.match(/id="editorial-creatine-myths-ref-pathway-source"/g)||[]).length,1);
 assert.ok(html.includes('href="https://example.org/mechanism"'));checkAnchors(html);
 delete s.research.articles[0].pathway;
 const withoutPathway=editorialMarkup(a,s);assert.ok(!withoutPathway.includes('class="pathway-figure"'));checkAnchors(withoutPathway);
 assert.ok(editorialMarkup(null,s).includes('Browse all articles'));
 a.myths[0].sourceIds=['missing-source'];assert.ok(editorialMarkup(a,s).includes('Reference unavailable'));
});

test('editorial values and source labels are escaped while unsafe original-source and product URLs stay inactive',()=>{
 const s=fixture(),a=s.research.editorial.articles[0],payload='<img src=x onerror="alert(1)">';
 for(const key of ['title','summary','author','intro'])a[key]=payload;
 Object.assign(a.myths[0],{claim:payload,verdict:payload,explanation:payload});Object.assign(a.sections[0],{title:payload,body:payload});
 s.research.editorial.series[0].label=payload;s.categories.creatine.label=payload;s.categories.creatine.page='javascript:alert(1)';
 Object.assign(s.research.sources[0],{title:payload,url:'javascript:alert(1)',limitations:payload});
 const html=editorialMarkup(a,s);
 assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
 assert.ok(!html.includes(payload));assert.ok(!html.includes('href="javascript:'));checkAnchors(html);
 const types=s.research.editorial.articles[2];for(const key of ['name','description','metabolism','evidence','value'])types.forms[0][key]=payload;
 const forms=editorialMarkup(types,s);assert.ok(!forms.includes(payload));assert.ok(forms.includes('&lt;img'));
});

test('reading time follows visible entry text instead of a hardcoded per-article value',()=>{
 assert.equal(editorialReadingMinutes({intro:''}),1);
 assert.equal(editorialReadingMinutes({intro:'word '.repeat(400)}),2);
 assert.equal(editorialReadingMinutes({intro:'word '.repeat(401)}),3);
 assert.equal(editorialReadingMinutes({intro:'word '.repeat(400),sourceIds:Array(100).fill('source-id')}),2);
});

test('publication rejects malformed cross-series optional content and unresolved individual citations',()=>{
 const initial=fixture(),valid=[];validateLearningContent(initial.research,initial.categories,message=>valid.push(message));assert.deepEqual(valid,[]);
 const mutations=[s=>s.research.editorial.articles[2].myths='invalid',s=>s.research.editorial.articles[0].forms='invalid',s=>s.research.editorial.articles[0].forms=[{...s.research.editorial.articles[2].forms[0],kind:'unknown'}],s=>s.research.editorial.articles[0].myths[0].sourceIds=['missing-source'],s=>s.research.editorial.articles[0].myths.pop()];
 for(const mutate of mutations){const s=fixture(),errors=[];mutate(s);validateLearningContent(s.research,s.categories,message=>errors.push(message));assert.ok(errors.length,'A malformed editorial revision must not be published.');}
});

test('the built Articles page retains runtime shell contracts, fingerprinted imports and sitemap discovery',async()=>{
 const destination=await fs.mkdtemp(path.join(os.tmpdir(),'supplement-articles-build-'));
 try{
  const {snapshot,assetVersion}=await buildSite(destination),html=await fs.readFile(path.join(destination,'articles.html'),'utf8'),site=await fs.readFile(path.join(destination,'site.js'),'utf8'),articles=await fs.readFile(path.join(destination,'articles.js'),'utf8'),sitemap=await fs.readFile(path.join(destination,'sitemap.xml'),'utf8');
  for(const fragment of ['data-page="articles"','id="articles-library"','id="global-search"','id="category-nav"','id="dataset-status"','id="refresh-data"','aria-controls="navigation"','aria-label="Use system theme"','id="evidence"','id="close"','id="evidence-body"','href="articles.html"'])assert.ok(html.includes(fragment),fragment);
  assert.ok(html.includes(`site.js?v=${assetVersion}`));assert.ok(html.includes(`marketplace.css?v=${assetVersion}`));assert.ok(html.includes('application/ld+json'));assert.ok(!html.includes('DATA_METADATA'));
  assert.ok(site.includes(`from './articles.js?v=${assetVersion}'`));assert.ok(site.includes("pageType==='articles')renderArticles(next)"));
  assert.ok(articles.includes(`from './pathways.js?v=${assetVersion}'`));assert.ok(articles.includes(`from './model.js?v=${assetVersion}'`));
  assert.ok(sitemap.includes(snapshot.config.baseUrl+'articles.html'));
 }finally{await fs.rm(destination,{recursive:true,force:true});}
});

test('published series cover the launch topics with resolved citations and are included in education search',async()=>{
 const bundle=await loadBundle(),snapshot=createSnapshot(bundle),e=snapshot.research.editorial;
 assert.deepEqual(snapshot.quality.errors,[]);
 for(const category of ['protein','creatine'])for(const series of ['myth-busters','understanding-types']){
  const a=e.articles.find(a=>a.category===category&&a.series===series);assert.ok(a);
  const html=editorialMarkup(a,snapshot);checkAnchors(html);
  assert.ok(!html.includes('Reference unavailable'));
  assert.ok(html.includes('ILLUSTRATED MECHANISM'));
 }
 const forms=e.articles.find(a=>a.id==='protein-types').forms.map(f=>f.name).join(' ');
 for(const term of ['Casein','Egg','Yeast','algal'])assert.ok(forms.includes(term));
 const result=searchCatalog(snapshot,{q:'creatine gummies',kind:'guides'});
 assert.ok(result.guides.some(g=>g.id==='creatine-types'&&g.href==='articles.html?article=creatine-types'));
 assert.equal(searchCatalog(snapshot,{q:'creatine gummies',kind:'products'}).guides.length,0);
 const before=editorialMarkup(e.articles[0],snapshot),copy=structuredClone(snapshot);
 copy.research.editorial.articles[0].myths[0].explanation='A new reviewed explanation from an updated snapshot.';
 assert.ok(editorialMarkup(copy.research.editorial.articles[0],copy).includes('A new reviewed explanation'));
 assert.ok(!before.includes('A new reviewed explanation'));
});
