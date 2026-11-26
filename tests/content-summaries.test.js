import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorialCardMarkup,editorialMarkup,editorialReadingMinutes,selectEditorial,renderArticles} from '../docs/articles.js';
import {guideMarkup,researchIndexMarkup,selectResearch} from '../docs/research.js';
import {directoryMarkup,editorialPolicyMarkup} from '../docs/public-pages.js';

function fixture(){
 const category={id:'protein',label:'Protein',page:'protein.html'};
 const article={_contentLoaded:false,id:'protein-labels',category:'protein',title:'Understand protein labels',summary:'Read the declared amount and serving basis.',author:'Editorial synthesis',reviewed:'2026-11-20',wordCount:850,sourceCount:7};
 const guide={_contentLoaded:false,id:'protein-guide',category:'protein',title:'Protein basics',summary:'Understand dietary protein needs.',sourceCount:9,sourceIds:['diet-reference'],buyingGuide:{value:{routineScore:2,targetedScore:4,targetedUse:'A documented dietary gap',scope:'Adults with the stated need'}}};
 return {config:{categories:[category],historyQuarters:12,maxPriceAgeDays:30},categories:{protein:category},research:{reviewed:'2026-11-20',scope:'Published evidence with explicit limits.',sourceCount:254,sources:[{id:'diet-reference',title:'Dietary guidance',kind:'Guidance',summary:'A dietary reference',limitations:'Population matters.'}],articles:[guide],editorial:{series:[],articles:[article]},valuePolicy:{baseline:'Assess dietary needs first.',scale:[{score:2,label:'Usually low priority'},{score:4,label:'Useful for a stated need'}]}}};
}

test('article list summaries keep filtering, source counts and reading times without loading bodies',()=>{
 const snapshot=fixture(),editorial=snapshot.research.editorial,article=editorial.articles[0];
 assert.equal(selectEditorial(editorial,{category:'protein',q:'declared basis'})[0],article);
 assert.equal(editorialReadingMinutes(article),5);
 assert.match(editorialCardMarkup(article,snapshot),/5 min read/);
 assert.match(directoryMarkup(snapshot),/7 cited references/);
 assert.match(editorialPolicyMarkup(snapshot),/254 entries/);
 assert.doesNotMatch(editorialCardMarkup(article,snapshot),/undefined|null/);
});

test('guide summaries filter by purchase context and render cards using published metadata',()=>{
 const snapshot=fixture(),data=snapshot.research;
 assert.equal(selectResearch(data,{category:'protein',q:'dietary'}).articles.length,1);
 assert.equal(selectResearch(data,{priority:4,priorityContext:'routine'}).articles.length,0);
 assert.equal(selectResearch(data,{priority:4,priorityContext:'targeted'}).articles.length,1);
 const html=researchIndexMarkup(snapshot);
 assert.match(html,/9 sources/);
 assert.match(html,/A documented dietary gap/);
 assert.match(html,/guide-protein\.html/);
 assert.doesNotMatch(html,/undefined|null/);
});

test('summary-only readers never manufacture an incomplete evidence article or guide',()=>{
 const snapshot=fixture(),article=editorialMarkup(snapshot.research.editorial.articles[0],snapshot),guide=guideMarkup(snapshot.research.articles[0],snapshot.categories.protein,new Map());
 for(const html of [article,guide])assert.match(html,/aria-busy="true"/);
 assert.doesNotMatch(article,/Sources and further reading|What the evidence says/);
 assert.doesNotMatch(guide,/What the evidence supports|What it can and cannot treat/);
});

test('a summary refresh keeps the complete server-rendered article on screen',()=>{
 const documentBefore=globalThis.document,locationBefore=globalThis.location;
 const root={innerHTML:'<article>The complete cited article is readable.</article>',attributes:new Map(),setAttribute(key,value){this.attributes.set(key,value);}};
 try{
  globalThis.document={querySelector:()=>root,body:{dataset:{articleId:'protein-labels'},classList:{toggle(){}}}};
  globalThis.location={pathname:'/article-protein-labels.html',search:''};
  renderArticles(fixture());
  assert.equal(root.innerHTML,'<article>The complete cited article is readable.</article>');
  assert.equal(root.attributes.get('aria-busy'),'true');
 }finally{
  if(documentBefore===undefined)delete globalThis.document;else globalThis.document=documentBefore;
  if(locationBefore===undefined)delete globalThis.location;else globalThis.location=locationBefore;
 }
});
