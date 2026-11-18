import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {editorialCoverage,editorialNarrativeWords} from '../docs/editorial-model.js';
import {editorialMarkup,selectEditorial} from '../docs/articles.js';
import {validateLearningContent} from '../docs/learning-validation.js';

const bundle=loadBundle(),snapshot=bundle.then(createSnapshot);

test('every supplement has two or three substantive dedicated articles, independent of related reading',async()=>{
 const s=await snapshot,e=s.research.editorial,p=e.coveragePolicy;
 assert.deepEqual(s.quality.errors,[]);assert.ok(p);
 assert.equal(p.minimumPrimaryArticles,2);assert.equal(p.maximumPrimaryArticles,3);
 for(const c of editorialCoverage(e,s.config.categories)){
  assert.ok(c.primary>=p.minimumPrimaryArticles&&c.primary<=p.maximumPrimaryArticles,c.id);
  const primary=e.articles.filter(a=>a.category===c.id);
  assert.equal(new Set(primary.map(a=>a.title)).size,primary.length);
  assert.ok(selectEditorial(e,{category:c.id}).length>=primary.length);
 }
 for(const a of e.articles){
  assert.ok(editorialNarrativeWords(a)>=p.minimumNarrativeWords,a.id);
  assert.ok(a.sourceIds.length>=2,a.id);
  assert.ok(!/lorem ipsum|\bTODO\b|\bTBD\b/i.test(JSON.stringify(a)),a.id);
 }
 assert.ok(e.series.some(s=>s.id==='practical-guides'));
});

test('all expanded readers resolve their chapter, citation and accessible diagram anchors',async()=>{
 const s=await snapshot;
 for(const a of s.research.editorial.articles){const html=editorialMarkup(a,s),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,a.id);
  for(const [,id] of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(id),a.id+' '+id);
  for(const [,value] of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g))for(const id of value.split(/\s+/))assert.ok(ids.includes(id),a.id+' '+id);
  assert.ok(!html.includes('Reference unavailable'),a.id);
  assert.ok(html.includes('ILLUSTRATED MECHANISM'),a.id);
 }
});

test('coverage checks reject gaps, related-only substitutions and thin articles before publication',async()=>{
 const original=await bundle;
 for(const change of [
  r=>{r.editorial.articles=r.editorial.articles.filter(a=>a.category!=='biotin');r.editorial.articles[0].relatedCategories=[...(r.editorial.articles[0].relatedCategories||[]),'biotin'];},
  r=>{const a=r.editorial.articles.find(a=>a.series==='practical-guides');a.intro='Brief.';a.sections=[{id:'short',title:'Brief',body:'Brief.',sourceIds:a.sourceIds.slice(0,1)}];delete a.forms;delete a.myths;},
  r=>{r.editorial.coveragePolicy.minimumNarrativeWords=0;}
 ]){const r=structuredClone(original.research),errors=[];change(r);validateLearningContent(r,(await snapshot).categories,e=>errors.push(e));assert.ok(errors.length);}
});

test('narrative word counts omit source identifiers and compare primary and related membership separately',()=>{
 const a={category:'one',relatedCategories:['two'],intro:'A useful reading.',sections:[{title:'Example',body:'A distinct explanation.'}],sourceIds:['irrelevant '.repeat(100)]};
 assert.equal(editorialNarrativeWords(a),7);
 const e={articles:[a,{category:'two',intro:'Another article.'}]};
 assert.deepEqual(editorialCoverage(e,[{id:'one',label:'One'},{id:'two',label:'Two'}]),[{id:'one',label:'One',primary:1,related:0,total:1},{id:'two',label:'Two',primary:1,related:1,total:2}]);
});
