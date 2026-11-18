import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {pathwayMarkup,pathwaySearchText,pathwayIconNames} from '../docs/pathways.js';
import {guideMarkup,selectResearch} from '../docs/research.js';

test('every category publishes a sourced illustrated route with readable text and accessible diagrams',async()=>{
 const bundle=await loadBundle(),snapshot=createSnapshot(bundle),refs=new Map(bundle.research.sources.map(s=>[s.id,s]));
 assert.deepEqual(snapshot.quality.errors,[]);
 for(const c of bundle.config.categories){
  const a=bundle.research.articles.find(a=>a.category===c.id),p=a.pathway;
  assert.ok(p,c.id);assert.ok(p.sourceIds.every(id=>a.sourceIds.includes(id)&&refs.has(id)));
  assert.ok(p.tracks.length<=3&&p.tracks.length>0);
  for(const t of p.tracks){assert.ok(t.steps.length>=3&&t.steps.length<=4);for(const s of t.steps){assert.ok(pathwayIconNames.includes(s.icon));assert.ok(s.detail.split(/\s+/).length<=25);}}
  const html=pathwayMarkup(p,refs,a.id,bundle.research.pathwayPolicy),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,c.id);assert.equal((html.match(/role="img"/g)||[]).length,p.tracks.length*2);
  for(const id of [...html.matchAll(/aria-labelledby="([^"]+)"/g)].flatMap(m=>m[1].split(' ')))assert.ok(ids.includes(id));
  assert.ok(pathwaySearchText(p).includes(p.tracks[0].steps[0].detail));
  const guide=guideMarkup(a,snapshot.categories[c.id],refs);assert.ok(guide.includes('ILLUSTRATED MECHANISM'));assert.ok(guide.includes('Read the mechanism in text'));assert.ok(guide.indexOf('ILLUSTRATED MECHANISM')<guide.indexOf(`id="${a.id}-products"`));
 }
 assert.ok(selectResearch(bundle.research,{q:'NADPH'}).articles.some(a=>a.category==='glutathione'));
});

test('combination products, unknown mechanisms and recycling are represented explicitly',async()=>{
 const {research}=await loadBundle(),get=id=>research.articles.find(a=>a.category===id).pathway;
 assert.equal(get('zmc').tracks.length,3);assert.equal(get('vitamin-b').tracks.length,3);
 assert.match(get('ashwagandha').caveat,/uncertainty|not a proven/i);
 assert.match(get('pre-workout').summary,/ingredient|mixture|formula/i);
 assert.ok(get('creatine').tracks.some(t=>t.returnLabel));assert.ok(get('glutathione').tracks.some(t=>t.returnLabel));
});

test('invalid pathway changes are rejected before they can replace a published dataset',async()=>{
 for(const mutate of [b=>delete b.research.articles[0].pathway,b=>b.research.articles[0].pathway.sourceIds=['missing'],b=>b.research.articles[0].pathway.tracks[0].steps[0].icon='unknown',b=>b.research.articles[0].pathway.tracks[0].steps=[]]){
  const b=await loadBundle();mutate(b);assert.ok(createSnapshot(b).quality.errors.some(e=>e.field==='research'&&e.message.includes('pathway')));
 }
});

test('pathway labels are escaped and rendering is safe for empty legacy content',()=>{
 assert.equal(pathwayMarkup(null,new Map(),'empty'),'');assert.equal(pathwaySearchText(null),'');
 const step={label:'<script>bad</script>',detail:'Safe & readable',compartment:'<img>',icon:'cell'},p={title:'<script>',summary:'One & two',caveat:'No <promise>',tracks:[{label:'<track>',steps:[step,step,step]}],sourceIds:[]},html=pathwayMarkup(p,new Map(),'safe"><script>');
 assert.ok(!html.includes('<script>')&&!html.includes('<img>'));assert.ok(html.includes('&lt;script&gt;')&&html.includes('Safe &amp; readable'));
});
