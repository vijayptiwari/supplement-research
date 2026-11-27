import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildSite,loadBundle} from '../scripts/build_site.mjs';
import {guideMarkup} from '../docs/research.js';
test('reader preserves clinical content, section navigation and source links',async()=>{const {research,config}=await loadBundle(),refs=new Map(research.sources.map(s=>[s.id,s]));for(const a of research.articles){const c=config.categories.find(c=>c.id===a.category),html=guideMarkup(a,c,refs);for(const key of ['process','benefits','treatment','who','routine','limits','labels','safety','sources']){assert.ok(html.includes(`href="#${a.id}-${key}"`));assert.ok(html.includes(`id="${a.id}-${key}"`));}assert.ok(html.includes(a.treatment.replaceAll('&','&amp;')));for(const id of a.sourceIds)assert.ok(html.includes(refs.get(id).url.replaceAll('&','&amp;')));}});
test('all published pages include the shared design shell with accessible mobile navigation',async()=>{
 const destination=await fs.mkdtemp(path.join(os.tmpdir(),'supplement-design-'));
 try{
  const {snapshot:{config}}=await buildSite(destination);
  for(const name of ['index.html','research.html','audit.html','recommender.html','search.html',...config.categories.map(c=>c.page)]){
   const html=await fs.readFile(path.join(destination,name),'utf8');
   assert.ok(html.includes('marketplace.css'),name);assert.ok(html.includes('aria-controls="navigation"'),name);assert.ok(html.includes('aria-label="Use system theme"'),name);
  }
  for(const c of config.categories){const html=await fs.readFile(path.join(destination,c.page),'utf8');assert.ok(html.includes(c.educationOnly?'data-default-category="'+c.id+'"':'aria-controls="catalog-filters"'));}
 }finally{await fs.rm(destination,{recursive:true,force:true});}
});
