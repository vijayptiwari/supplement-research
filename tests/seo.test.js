import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildSite} from '../scripts/build_site.mjs';
import {contentMetadata,metadataForLocation} from '../docs/seo.js';
import {articleHref,guideHref,articleIdForLocation,guideIdForLocation,canonicalContentHref,legacyContentTarget} from '../docs/routes.js';

let destination,result,snapshot,files,html;
const decode=value=>String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ');
const normalized=value=>String(value).replace(/\s+/g,' ').trim();
const mainText=value=>normalized(decode((value.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0]||'').replace(/<[^>]+>/g,' ')));
const hrefs=value=>[...value.matchAll(/\bhref="([^"]+)"/g)].map(m=>decode(m[1]));
const canonical=value=>decode(value.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1]||'');
const robots=value=>value.match(/<meta\b[^>]*name="robots"[^>]*content="([^"]+)"/)?.[1]||'';
const graph=value=>{
 const blocks=[...value.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
 assert.equal(blocks.length,1,'A page must have one authoritative structured-data block.');
 const parsed=JSON.parse(blocks[0][1]);
 assert.equal(parsed['@context'],'https://schema.org');
 assert.ok(Array.isArray(parsed['@graph']));
 return parsed['@graph'];
};
const absolute=file=>new URL(file,snapshot.config.baseUrl).href;
const assertVisible=(page,text,label)=>{
 if(typeof text==='string'&&text.trim())assert.ok(mainText(page).includes(normalized(text)),label);
};

before(async()=>{
 destination=await fs.mkdtemp(path.join(os.tmpdir(),'supplement-seo-build-'));
 result=await buildSite(destination);
 snapshot=result.snapshot;
 files=new Set((await fs.readdir(destination)).filter(name=>name.endsWith('.html')));
 html=new Map(await Promise.all([...files].map(async name=>[name,await fs.readFile(path.join(destination,name),'utf8')])));
});
after(async()=>{if(destination)await fs.rm(destination,{recursive:true,force:true});});

test('the build publishes complete article and guide reading content before JavaScript runs',()=>{
 for(const a of snapshot.research.editorial.articles){
  const name=articleHref(a.id),page=html.get(name);
  assert.ok(page,`Missing article file ${name}`);
  assert.ok(page.includes(`data-article-id="${a.id}"`),name);
  for(const [key,value] of Object.entries({title:a.title,intro:a.intro}))assertVisible(page,value,`${name}: ${key}`);
  for(const section of a.sections||[])for(const paragraph of section.body.split(/\n\s*\n/))assertVisible(page,paragraph,`${name}: ${section.id} is only partially published`);
  for(const myth of a.myths||[]){assertVisible(page,myth.claim,`${name}: myth`);assertVisible(page,myth.explanation,`${name}: explanation`);}
  for(const form of a.forms||[])for(const key of ['name','description','metabolism','evidence','value'])assertVisible(page,form[key],`${name}: form ${key}`);
  for(const note of a.evidenceNotes||[])for(const key of ['finding','design','population','outcome','limits'])assertVisible(page,note[key],`${name}: evidence ${key}`);
  assert.ok(!mainText(page).includes('Loading articles from the published dataset'),name);
 }
 for(const a of snapshot.research.articles){
  const name=guideHref(a.category),page=html.get(name);
  assert.ok(page,`Missing guide file ${name}`);
  assert.ok(page.includes(`data-default-category="${a.category}"`),name);
  for(const key of ['title','summary','evidence','safety'])assertVisible(page,a[key],`${name}: ${key}`);
  for(const step of a.bodySteps||[])assertVisible(page,step,`${name}: body-process text`);
  if(a.pathway)assertVisible(page,a.pathway.title,`${name}: pathway`);
  for(const id of a.sourceIds){const source=snapshot.research.sources.find(s=>s.id===id);assert.ok(hrefs(page).includes(source.url),`${name}: missing source ${id}`);}
  assert.ok(page.includes('Published reading content and sources are available without JavaScript'),name);
 }
});

test('canonical reading URLs are absolute project-Pages URLs with unique metadata and real source citations',()=>{
 const sources=new Map(snapshot.research.sources.map(s=>[s.id,s]));
 for(const [entries,kind,route] of [[snapshot.research.editorial.articles,'article',a=>articleHref(a.id)],[snapshot.research.articles,'guide',a=>guideHref(a.category)]])for(const a of entries){
  const name=route(a),page=html.get(name),url=absolute(name),entities=graph(page),entity=entities.find(x=>x['@type']==='Article');
  assert.equal(canonical(page),url,name);
  assert.equal((page.match(/rel="canonical"/g)||[]).length,1,name);
  assert.ok(robots(page).startsWith('index,follow'),name);
  assert.ok(entity,`${name}: Article structured data`);
  assert.equal(entity.headline,a.title);
  assert.equal(entity.dateModified,a.reviewed);
  assert.equal(entity.datePublished,a.published,`${name}: do not invent a publication date from a review date`);
  assert.equal(entity.author['@type'],'Organization',`${name}: an editorial process is not a named clinician`);
  assert.equal(entity.author.name,a.author);
  assert.equal(entity.author.url,absolute('editorial-policy.html'));
  assert.equal(entity.url,url);
  assert.equal(entity.mainEntityOfPage['@id'],url);
  assert.equal(entity.publisher['@id'],snapshot.config.baseUrl+'#organization');
  assert.deepEqual(entity.citation,a.sourceIds.map(id=>sources.get(id).url),`${name}: citations must come from the registry`);
  assert.ok(!entity.reviewedBy,`${name}: do not imply independent medical review`);
  const breadcrumbs=entities.find(x=>x['@type']==='BreadcrumbList');
  assert.equal(breadcrumbs.itemListElement.at(-1).item,url);
  assert.ok(hrefs(page).includes('editorial-policy.html'),name);
  assert.equal(contentMetadata(snapshot,{kind,id:kind==='article'?a.id:a.category}).canonical,url);
 }
 const policy=mainText(html.get('editorial-policy.html'));
 for(const disclosure of ['AI-assisted research and drafting','not a claim of review by a named clinician','not establish independent clinical review','A recorded price is not a live checkout quote'])assert.ok(policy.includes(disclosure),disclosure);
});

test('ordinary HTML links make the entire reading library reachable without executing scripts',()=>{
 const directory=html.get('library.html'),directoryLinks=new Set(hrefs(directory));
 assert.ok(directory,'The topic directory must be built.');
 for(const a of snapshot.research.editorial.articles){assert.ok(directoryLinks.has(articleHref(a.id)),a.id);assertVisible(directory,a.title,a.id);}
 for(const a of snapshot.research.articles)assert.ok(directoryLinks.has(guideHref(a.category)),a.category);
 for(const name of ['index.html','articles.html','research.html'])assert.ok(hrefs(html.get(name)).includes('library.html'),`${name} must expose the full directory`);
 const visited=new Set(),queue=['index.html'];
 while(queue.length){
  const name=queue.shift();if(visited.has(name))continue;visited.add(name);
  for(const href of hrefs(html.get(name)||'')){
   const target=new URL(href,absolute(name));
   if(target.origin!==new URL(snapshot.config.baseUrl).origin||!target.pathname.startsWith(new URL(snapshot.config.baseUrl).pathname))continue;
   const local=target.pathname.slice(new URL(snapshot.config.baseUrl).pathname.length)||'index.html';
   if(files.has(local)&&!visited.has(local))queue.push(local);
  }
 }
 for(const a of snapshot.research.editorial.articles)assert.ok(visited.has(articleHref(a.id)),`Unreachable article ${a.id}`);
 for(const a of snapshot.research.articles)assert.ok(visited.has(guideHref(a.category)),`Unreachable guide ${a.category}`);
 assert.ok(visited.has('editorial-policy.html'));
});

test('sitemap lists unique canonical reading pages with their own review dates and excludes search variants',async()=>{
 const xml=await fs.readFile(path.join(destination,'sitemap.xml'),'utf8'),entries=[...xml.matchAll(/<url><loc>(.*?)<\/loc><lastmod>(.*?)<\/lastmod><\/url>/g)].map(m=>({url:decode(m[1]),date:m[2]})),byUrl=new Map(entries.map(e=>[e.url,e.date]));
 assert.equal(byUrl.size,entries.length,'Duplicate sitemap locations waste crawl targets.');
 for(const a of snapshot.research.editorial.articles)assert.equal(byUrl.get(absolute(articleHref(a.id))),a.reviewed,a.id);
 for(const a of snapshot.research.articles)assert.equal(byUrl.get(absolute(guideHref(a.category))),a.reviewed,a.category);
 for(const name of ['library.html','articles.html','research.html','editorial-policy.html'])assert.ok(byUrl.has(absolute(name)),name);
 for(const {url,date} of entries){const parsed=new URL(url);assert.equal(parsed.search,'',url);assert.equal(parsed.hash,'',url);assert.ok(!/\/(?:search|404)\.html$/.test(parsed.pathname),url);assert.match(date,/^\d{4}-\d{2}-\d{2}$/);}
 const robotsFile=await fs.readFile(path.join(destination,'robots.txt'),'utf8');
 assert.ok(robotsFile.includes(`Sitemap: ${absolute('sitemap.xml')}`));
 assert.ok(!/Disallow:\s*\/search/i.test(robotsFile),'Crawlers must be able to read the search page noindex instruction.');
});

test('search, unavailable pages and filtered variants use noindex while retaining a clean canonical',()=>{
 for(const name of ['search.html','404.html'])assert.equal(robots(html.get(name)),'noindex,follow',name);
 const category=snapshot.config.categories.find(c=>!c.educationOnly).id,article=snapshot.research.editorial.articles[0],guide=snapshot.research.articles[0];
 const variants=[
  {kind:'search',query:'?q=protein'},
  {kind:'articles',query:'?category=protein&series=myth-busters'},
  {kind:'research',query:'?q=claims'},
  {kind:category,query:'?brand=Example&view=flat'},
  {kind:'article',id:article.id,query:'?q=claims'},
  {kind:'guide',id:guide.category,query:'?q=claims&minValue=5'},
  {kind:'article',id:'not-an-article'},
  {kind:'guide',id:'not-a-category'}
 ];
 for(const variant of variants){const meta=contentMetadata(snapshot,variant);assert.equal(meta.robots,'noindex,follow',JSON.stringify(variant));assert.equal(new URL(meta.canonical).search,'');assert.equal(new URL(meta.canonical).hash,'');}
 assert.equal(contentMetadata(snapshot,{kind:category}).robots,'index,follow,max-image-preview:large');
 assert.equal(metadataForLocation(snapshot,{pathname:'/supplement-research/'+articleHref(article.id),search:''},{page:'articles'}).canonical,absolute(articleHref(article.id)));
});

test('reading pages use available fingerprinted assets and social images; the 404 works at any path depth',async()=>{
 const pages=['index.html','library.html','editorial-policy.html',articleHref(snapshot.research.editorial.articles[0].id),guideHref(snapshot.research.articles[0].category)];
 for(const name of pages){const page=html.get(name);for(const asset of ['site.js','marketplace.css']){assert.ok(page.includes(`${asset}?v=${result.assetVersion}`),`${name}: ${asset}`);assert.ok((await fs.stat(path.join(destination,asset))).size>0);}assert.ok(page.includes(absolute('assets/social-card.png')),name);assert.ok(page.includes('content="summary_large_image"'),name);assert.ok(page.includes('href="assets/favicon.svg"'),name);}
 const png=await fs.readFile(path.join(destination,'assets/social-card.png'));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
 assert.ok((await fs.readFile(path.join(destination,'assets/favicon.svg'),'utf8')).includes('<svg'));
 const missing=html.get('404.html');
 assert.equal(canonical(missing),absolute('404.html'));
 for(const m of missing.matchAll(/\b(?:href|src|action)="([^"]+)"/g)){const value=decode(m[1]);if(value.startsWith('#'))continue;assert.match(value,/^https?:\/\//,`404 relative reference would break below a missing nested URL: ${value}`);}
 const site=await fs.readFile(path.join(destination,'site.js'),'utf8');
 assert.ok(site.includes(`./seo.js?v=${result.assetVersion}`));assert.ok(site.includes(`./routes.js?v=${result.assetVersion}`));
});

test('legacy reading URLs preserve fragments and extra controls without redirecting ordinary catalogs or unknown entries',()=>{
 const article=snapshot.research.editorial.articles[0],guide=snapshot.research.articles[0],fragment='#evidence-source',articleOld=`articles.html?article=${article.id}&q=meal&category=${article.category}${fragment}`,guideOld=`research.html?category=${guide.category}&q=meal&minValue=3${fragment}`;
 assert.equal(canonicalContentHref(articleOld,snapshot),`${articleHref(article.id)}?q=meal&category=${article.category}${fragment}`);
 assert.equal(canonicalContentHref(guideOld,snapshot),`${guideHref(guide.category)}?q=meal&minValue=3${fragment}`);
 const location=value=>{const url=new URL(value,snapshot.config.baseUrl);return {pathname:url.pathname,search:url.search,hash:url.hash};};
 assert.equal(legacyContentTarget(snapshot,location(articleOld)),canonicalContentHref(articleOld,snapshot));
 assert.equal(legacyContentTarget(snapshot,location(guideOld)),canonicalContentHref(guideOld,snapshot));
 assert.equal(legacyContentTarget(snapshot,location(articleHref(article.id)+fragment)),null);
 for(const value of ['articles.html?article=unknown#part','research.html?category=unknown#part','protein.html?brand=Example&view=flat#packs','https://another.example/articles.html?article='+article.id,'#sources'])assert.equal(canonicalContentHref(value,snapshot),value);
 const education=snapshot.config.categories.find(c=>c.educationOnly);
 if(education)assert.equal(legacyContentTarget(snapshot,location(education.page+'?q=tendon'+fragment)),guideHref(education.id)+'?q=tendon'+fragment);
 assert.equal(articleIdForLocation(location(articleHref(article.id)+'?article=wrong'),'fallback'),article.id);
 assert.equal(guideIdForLocation(location(guideHref(guide.category)+'?category=wrong'),'fallback'),guide.category);
 assert.equal(articleIdForLocation(location('articles.html?article='+article.id)),article.id);
 assert.equal(guideIdForLocation(location('research.html?category='+guide.category)),guide.category);
});

test('metadata follows the current guide URL after changing or clearing the initial selection',()=>{
 const body={page:'research',defaultCategory:'creatine'};
 assert.equal(metadataForLocation(snapshot,{pathname:'/supplement-research/research.html',search:''},body).canonical,absolute('research.html'));
 assert.equal(metadataForLocation(snapshot,{pathname:'/supplement-research/guide-collagen.html',search:''},body).canonical,absolute('guide-collagen.html'));
 const catalog=html.get('ashwagandha.html');assert.ok(catalog.includes('% of extract'));assert.ok(!catalog.includes('% / label serving'));assert.ok(catalog.includes('Label serving:'));
});
