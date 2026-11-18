import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {guideMarkup,placeResearchToolbar} from '../docs/research.js';

// A minimal tree lets this regression exercise the actual toolbar relocation without a browser.
class Node {
 constructor(selector){this.selector=selector;this.children=[];this.parentElement=null;}
 append(node){if(node.parentElement)node.parentElement.children.splice(node.parentElement.children.indexOf(node),1);this.children.push(node);node.parentElement=this;}
 querySelector(selector){for(const child of this.children){if(child.selector===selector)return child;const match=child.querySelector(selector);if(match)return match;}return null;}
 count(selector){return this.children.reduce((n,child)=>n+Number(child.selector===selector)+child.count(selector),0);}
}

test('guide changes and refreshes retain one live selector and return filters to the library',()=>{
 const root=new Node('root'),home=new Node('#research-toolbar-home'),toolbar=new Node('.library-toolbar'),select=new Node('#research-category'),query=new Node('#research-query'),guides=new Node('#research-guides');
 root.append(home);root.append(guides);home.append(toolbar);toolbar.append(select);toolbar.append(query);select.value='biotin';query.value='hair';
 let slot=new Node('.guide-selector-slot');guides.append(slot);
 placeResearchToolbar(root,true);
 assert.equal(toolbar.parentElement,slot);
 for(const category of ['creatine','magnesium','biotin']){
  select.value=category;
  // renderResearch must park the original controls before replacing the article tree.
  placeResearchToolbar(root);
  guides.children=[];
  slot=new Node('.guide-selector-slot');guides.append(slot);
  placeResearchToolbar(root,true);
  assert.equal(root.querySelector('#research-category'),select);
  assert.equal(root.querySelector('#research-query'),query);
  assert.equal(select.value,category);assert.equal(query.value,'hair');
  assert.equal(root.count('#research-category'),1);
  assert.equal(toolbar.parentElement,slot);
 }
 placeResearchToolbar(root);
 assert.equal(toolbar.parentElement,home);
 guides.children=[];
 placeResearchToolbar(root,true); // A filtered guide with no matches still exposes the filters.
 assert.equal(toolbar.parentElement,home);
 assert.equal(root.count('#research-category'),1);
});

test('each article reserves one shared navigation rail without duplicating the live selector',async()=>{
 const s=createSnapshot(await loadBundle()),refs=new Map(s.research.sources.map(r=>[r.id,r]));
 for(const article of s.research.articles){
  const html=guideMarkup(article,s.categories[article.category],refs);
  assert.equal(html.split('class="guide-sidebar"').length-1,1,article.category);
  assert.equal(html.split('class="guide-selector-slot"').length-1,1,article.category);
  assert.equal(html.split('class="article-toc"').length-1,1,article.category);
  assert.ok(html.indexOf('class="guide-selector-slot"')<html.indexOf('class="article-toc"'));
  assert.ok(!html.includes('id="research-category"'));
 }
});
