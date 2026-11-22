import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorialCollections,editorialSeriesId,editorialSeriesLabel,standaloneSeriesId} from '../docs/editorial-model.js';
import {selectEditorial,editorialMarkup,editorialCardMarkup} from '../docs/articles.js';
import {validateLearningContent} from '../docs/learning-validation.js';
import {directoryMarkup} from '../docs/public-pages.js';
import {contentMetadata} from '../docs/seo.js';
import {marketHomeMarkup} from '../docs/marketplace.js';
import {recommend} from '../docs/recommender.js';

function fixture(){
 const category={id:'protein',label:'Protein',page:'protein.html'};
 const article={id:'reading-a-protein-label',category:'protein',title:'Reading a protein label',summary:'An independent label explainer.',author:'Editorial synthesis',reviewed:'2026-11-20',intro:'Start with the declared amount and its basis.',sections:[{id:'serving',title:'Check the serving',body:'A serving and a daily requirement are different quantities.',sourceIds:['label-reference']}],sourceIds:['label-reference']};
 return {config:{name:'Test library',baseUrl:'https://example.org/',categories:[category]},categories:{protein:category},research:{reviewed:'2026-11-20',articles:[],sources:[{id:'label-reference',title:'Original label guidance',url:'https://example.org/labels',kind:'Guidance',checked:'2026-11-20'}],editorial:{reviewed:'2026-11-20',description:'Cited reading material.',series:[],articles:[article]}}};
}
const errorsFor=s=>{const errors=[];validateLearningContent(s.research,s.categories,e=>errors.push(e));return errors;};

test('standalone articles can omit series or use null without requiring a series registry entry',()=>{
 const s=fixture();assert.deepEqual(errorsFor(s),[]);s.research.editorial.articles[0].series=null;assert.deepEqual(errorsFor(s),[]);
 for(const series of ['', ' ', 'unknown', {}, 1]){const next=fixture();next.research.editorial.articles[0].series=series;assert.ok(errorsFor(next).length);}
 const reserved=fixture();reserved.research.editorial.series=[{id:standaloneSeriesId,label:'Conflicting series',description:'Cannot replace the independent collection.'}];assert.ok(errorsFor(reserved).length);
});

test('standalone selection, search and collection counts derive from the current article files',()=>{
 const s=fixture(),e=s.research.editorial,article=e.articles[0];e.series.push({id:'label-basics',label:'Label Basics',description:'A named series.'});e.articles.push({...article,id:'series-labels',series:'label-basics',title:'Series label guide',summary:'A named series article.'});const original=structuredClone(e);
 assert.deepEqual(editorialCollections(e).map(c=>c.id),['label-basics',standaloneSeriesId]);assert.equal(editorialSeriesId(article),standaloneSeriesId);assert.equal(editorialSeriesLabel(article,e),'Independent article');
 assert.deepEqual(selectEditorial(e,{series:standaloneSeriesId}).map(a=>a.id),[article.id]);assert.deepEqual(selectEditorial(e,{series:'label-basics'}).map(a=>a.id),['series-labels']);assert.deepEqual(selectEditorial(e,{q:'independent',category:'protein'}).map(a=>a.id),[article.id]);assert.deepEqual(e,original);
 e.articles.shift();assert.deepEqual(editorialCollections(e).map(c=>c.id),['label-basics']);
});

test('reader, cards, directory and SEO label independent articles while preserving canonical article URLs and citations',()=>{
 const s=fixture(),a=s.research.editorial.articles[0],reader=editorialMarkup(a,s),card=editorialCardMarkup(a,s),directory=directoryMarkup(s),meta=contentMetadata(s,{kind:'article',id:a.id});
 for(const html of [reader,card,directory]){assert.match(html,/Independent article/);assert.doesNotMatch(html,/undefined|null/);}
 assert.match(reader,/articles\.html\?series=standalone/);assert.match(reader,/href="https:\/\/example.org\/labels"/);assert.match(card,/article-reading-a-protein-label\.html/);assert.match(directory,/article-reading-a-protein-label\.html/);
 assert.equal(meta.canonical,'https://example.org/article-reading-a-protein-label.html');const article=meta.structured['@graph'].find(n=>n['@type']==='Article');assert.equal(article.articleSection,'Independent article');assert.deepEqual(article.citation,['https://example.org/labels']);
});

test('standalone publication keeps citation and optional content validation intact',()=>{
 const noCitation=fixture();noCitation.research.editorial.articles[0].sections[0].sourceIds=['missing'];assert.ok(errorsFor(noCitation).length);
 const badForms=fixture();badForms.research.editorial.articles[0].forms='unsupported';assert.ok(errorsFor(badForms).length);
 const named=fixture();named.research.editorial.series=[{id:'label-basics',label:'Label Basics',description:'A named series.'}];named.research.editorial.articles[0].series='label-basics';assert.deepEqual(errorsFor(named),[]);assert.match(editorialMarkup(named.research.editorial.articles[0],named),/Label Basics/);assert.doesNotMatch(editorialMarkup(named.research.editorial.articles[0],named),/Independent article/);
});

test('optional coverage bounds allow editorial growth while preserving substantive reading and source checks',()=>{
 const s=fixture(),e=s.research.editorial;e.coveragePolicy={reviewed:'2026-11-20',summary:'Publish sourced articles when useful, without an arbitrary category count.',minimumNarrativeWords:40};e.articles[0].sections[0].body='Source-supported explanation. '.repeat(45);
 for(let i=0;i<6;i++)e.articles.push({...structuredClone(e.articles[0]),id:'independent-'+i,title:'Independent question '+i});
 assert.deepEqual(errorsFor(s),[]);
 for(const patch of [{minimumPrimaryArticles:0},{maximumPrimaryArticles:null},{minimumPrimaryArticles:'3'},{minimumPrimaryArticles:4,maximumPrimaryArticles:3},{minimumNarrativeWords:0}]){const next=structuredClone(s);Object.assign(next.research.editorial.coveragePolicy,patch);assert.ok(errorsFor(next).length);}
 for(const patch of [{minimumPrimaryArticles:8},{maximumPrimaryArticles:6}]){const next=structuredClone(s);Object.assign(next.research.editorial.coveragePolicy,patch);assert.ok(errorsFor(next).some(e=>e.includes('article-count bounds')));}
 const short=structuredClone(s);short.research.editorial.articles[0].sections[0].body='Too brief.';assert.ok(errorsFor(short).some(e=>e.includes('too brief')));
 const unsourced=structuredClone(s);unsourced.research.editorial.articles[0].sections[0].sourceIds=['missing'];assert.ok(errorsFor(unsourced).some(e=>e.includes('citation')));
});

test('homepage discovers an independent collection even when the library has no named series',()=>{
 const s=fixture();s.stats={offers:0,verifiedPrices:0};Object.assign(s.categories.protein,{offers:[],stats:{offers:0,brands:0}});
 const html=marketHomeMarkup(s);assert.match(html,/articles\.html\?series=standalone/);assert.match(html,/Independent articles/);assert.match(html,/1 article · Read independent articles/);
 s.research.editorial.series.push({id:'label-basics',label:'Label Basics',description:'A named series.'});s.research.editorial.articles.push({...s.research.editorial.articles[0],id:'named-reading',series:'label-basics'});
 const mixed=marketHomeMarkup(s);assert.match(mixed,/articles\.html\?series=label-basics/);assert.match(mixed,/articles\.html\?series=standalone/);
});

test('new wiki categories without stack rules remain visible as held educational reviews and never gain automatic offers',()=>{
 const s=fixture();s.recommender={rules:[],productPolicy:{common:[],categories:{}}};s.categories.protein.offers=[{id:'exact',price:1}];s.research.articles=[{category:'protein',sourceIds:['label-reference']}];
 const input={goals:['strength'],existing:['protein','missing','constructor'],context:'adult-clear',budget:''},result=recommend(s,input);
 assert.equal(result.items.length,1);const [item]=result.items;assert.equal(item.category,'protein');assert.equal(item.held,true);assert.equal(item.review,true);assert.equal(item.eligible,false);assert.deepEqual(item.offers,[]);assert.deepEqual(item.sources,['label-reference']);assert.match(item.reason,/No category-specific stack selection policy/);
 assert.deepEqual(recommend(s,{...input,existing:[]}).items,[]);
 const restricted=recommend(s,{...input,context:'review'});assert.equal(restricted.restricted,true);assert.ok(restricted.warnings.length);assert.deepEqual(restricted.items[0].offers,[]);
 s.recommender.rules=[{category:'protein',goals:['strength'],review:true,status:'Named policy',reason:'Existing reviewed selection policy.',sources:['label-reference']}];assert.equal(recommend(s,input).items.length,1);assert.match(recommend(s,input).items[0].reason,/Existing reviewed selection policy/);assert.doesNotMatch(recommend(s,input).items[0].reason,/No category-specific/);
});
