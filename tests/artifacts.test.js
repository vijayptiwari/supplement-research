import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadArtifactSources,artifactRevision,exportLegacy,importLegacy,writeArtifactDocuments,artifactSlug} from '../scripts/artifact_store.mjs';
import {migrateToArtifacts} from '../scripts/migrate_to_artifacts.mjs';
import {buildSite} from '../scripts/build_site.mjs';
import {createSnapshot} from '../docs/model.js';
import {mergeCatalogResearch} from '../scripts/merge_catalog_research.mjs';
import {importTrustifiedReports} from '../scripts/import_trustified_reports.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),baseline=await loadArtifactSources();
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');};
async function workspace(run,{legacy=false,templates=false}={}){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'artifacts-tests-'));
 try{
  if(legacy){for(const [name,value] of Object.entries(baseline.legacyDocuments))await write(path.join(temp,'docs/data',name),value);}
  else await fs.cp(path.join(root,'artifacts'),path.join(temp,'artifacts'),{recursive:true});
  if(templates)await fs.cp(path.join(root,'docs'),path.join(temp,'docs'),{recursive:true});
  return await run(temp);
 }finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('artifacts-tests-'));await fs.rm(temp,{recursive:true,force:true});}
}
const productPath=temp=>path.join(temp,'artifacts/products/creatine/one-science-nutrition/100-micronized-creatine.json');

test('migration preserves every assembled value, stable ID, dated observation and refresh profile, then becomes idempotent',async()=>workspace(async temp=>{
 const migrated=await migrateToArtifacts({root:temp});assert.deepEqual(migrated.bundle,baseline.bundle);assert.deepEqual(migrated.additionalSources,baseline.additionalSources);
 assert.equal(migrated.bundle.observations.length,baseline.bundle.observations.length);assert.equal(migrated.additionalSources.products.length,baseline.additionalSources.products.length);
 await assert.rejects(fs.access(path.join(temp,'docs/data/catalog.json')),{code:'ENOENT'});
 const before=await artifactRevision(temp);await migrateToArtifacts({root:temp});assert.equal(await artifactRevision(temp),before);
 assert.deepEqual((await fs.readdir(path.join(temp,'artifacts'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort(),['articles','products','wiki']);
},{legacy:true}));

test('a product-file edit recalculates costs and an added/removed brand file changes discovery without editing a manifest',async()=>workspace(async temp=>{
 const file=productPath(temp),product=await read(file),r=product.variants[0].offer,oldPrice=r.price;
 r.price=oldPrice+100;for(const o of product.priceHistory)if(String(o.observation.offerId)===String(r.id)&&o.observation.kind==='official-live'&&o.observation.date==='2026-11-20')o.observation.price=r.price;
 await write(file,product);let source=await loadArtifactSources(temp),snapshot=createSnapshot(source.bundle),changed=snapshot.categories.creatine.offers.find(o=>o.id===r.id);assert.deepEqual(snapshot.quality.errors,[]);assert.equal(changed.price,oldPrice+100);assert.equal(changed.cost,(oldPrice+100)/(r.grams*r.creatine/100));
 const next=structuredClone(product);next.brand='Fixture Brand';next.product='Fixture Creatine';const offer={...r,id:'fixture-new-pack',brand:next.brand,product:next.product,url:'https://example.org/creatine?variant=fixture',price:500};next.variants=[{offer}];next.refreshSources=[];next.priceHistory=[{observation:{category:'creatine',offerId:offer.id,date:'2026-11-20',price:500,currency:'INR',sourceUrl:offer.url,evidenceUrl:offer.url,kind:'official-live',qualityStatus:'verified'}}];
 const added=path.join(temp,'artifacts/products/creatine/fixture-brand/fixture-creatine.json');await write(added,next);snapshot=createSnapshot((await loadArtifactSources(temp)).bundle);assert.equal(snapshot.stats.offers,createSnapshot(baseline.bundle).stats.offers+1);assert.ok(snapshot.categories.creatine.offers.some(o=>o.id===offer.id));
 await fs.unlink(added);assert.equal(createSnapshot((await loadArtifactSources(temp)).bundle).stats.offers,createSnapshot(baseline.bundle).stats.offers);
}));

test('standalone and series articles are discovered from directories, with source paths controlling series membership',async()=>workspace(async temp=>{
 const original=baseline.bundle.research.editorial.articles.find(a=>a.series==='evidence-in-context');
 const loose={...structuredClone(original),id:'fixture-independent',title:'Fixture independent article',series:null};await write(path.join(temp,'artifacts/articles/fixture-independent.json'),{schemaVersion:1,article:loose});
 const article={...structuredClone(original),id:'fixture-series-article',title:'Fixture series article'};delete article.series;
 await write(path.join(temp,'artifacts/articles/series/fixture-series/_series.json'),{schemaVersion:1,series:{id:'fixture-series',label:'Fixture series',description:'A new file-defined series.'}});
 await write(path.join(temp,'artifacts/articles/series/fixture-series/fixture-series-article.json'),{schemaVersion:1,article});
 const snapshot=createSnapshot((await loadArtifactSources(temp)).bundle);assert.deepEqual(snapshot.quality.errors,[]);assert.equal(snapshot.research.editorial.articles.length,baseline.bundle.research.editorial.articles.length+2);assert.equal(snapshot.research.editorial.articles.find(a=>a.id===article.id).series,'fixture-series');assert.equal(snapshot.research.editorial.articles.find(a=>a.id===loose.id).series,null);
}));

test('new wiki categories generate catalog/guide HTML without a new handwritten page template',async()=>workspace(async temp=>{
 const wiki=await read(path.join(temp,'artifacts/wiki/biotin.json'));wiki.category={...wiki.category,id:'fixture-nutrient',label:'Fixture nutrient'};delete wiki.category.page;delete wiki.category.file;wiki.guide={...wiki.guide,id:'fixture-nutrient-guide',category:'fixture-nutrient',title:'Fixture nutrient education'};wiki.catalog={checked:'2026-11-20',category:'fixture-nutrient'};delete wiki.order;
 await write(path.join(temp,'artifacts/wiki/fixture-nutrient.json'),wiki);
 const destination=path.join(temp,'built'),{snapshot}=await buildSite(destination,{sourceRoot:temp});assert.equal(snapshot.config.categories.length,baseline.bundle.config.categories.length+1);assert.equal(snapshot.categories['fixture-nutrient'].offers.length,0);
 const html=await fs.readFile(path.join(destination,'fixture-nutrient.html'),'utf8');assert.match(html,/data-category="fixture-nutrient"/);assert.match(html,/Fixture nutrient/);assert.match(await fs.readFile(path.join(destination,'guide-fixture-nutrient.html'),'utf8'),/Fixture nutrient education/);
 await fs.unlink(path.join(temp,'artifacts/wiki/fixture-nutrient.json'));await buildSite(destination,{sourceRoot:temp});await assert.rejects(fs.access(path.join(destination,'fixture-nutrient.html')),{code:'ENOENT'});
},{templates:true}));

test('public legacy JSON is generated output and cannot override the authoritative product tree',async()=>workspace(async temp=>{
 await write(path.join(temp,'docs/data/catalog.json'),{checked:'2099-01-01',offers:[]});const sources=await loadArtifactSources(temp);assert.equal(sources.source,'artifacts');assert.deepEqual(sources.bundle.categories.protein,baseline.bundle.categories.protein);
}));

test('staged research imports keep unrelated content and reject stale source revisions',async()=>workspace(async temp=>{
 const work=path.join(temp,'refresh');await exportLegacy(work,{root:temp});
 const file=productPath(temp),product=await read(file);product.variants[0].offer.notes='User edited after export.';await write(file,product);
 await assert.rejects(importLegacy(work,{root:temp}),/changed after export/);assert.equal((await read(file)).variants[0].offer.notes,'User edited after export.');
 await exportLegacy(work,{root:temp});const legacyFile=path.join(work,'docs/data/creatine.json'),legacy=await read(legacyFile),id=product.variants[0].offer.id;legacy.offers.find(o=>o.id===id).notes='Accepted reviewed update.';await write(legacyFile,legacy);
 const untouched=await fs.readFile(path.join(temp,'artifacts/wiki/protein.json'),'utf8');await fs.writeFile(path.join(temp,'artifacts/local-notes.md'),'Keep this user documentation.');
 await assert.rejects(importLegacy(work,{root:temp}),/changed after export/);await exportLegacy(work,{root:temp});const fresh=await read(legacyFile);fresh.offers.find(o=>o.id===id).notes='Accepted reviewed update.';await write(legacyFile,fresh);
 await importLegacy(work,{root:temp});assert.equal((await read(file)).variants[0].offer.notes,'Accepted reviewed update.');assert.equal(await fs.readFile(path.join(temp,'artifacts/wiki/protein.json'),'utf8'),untouched);assert.equal(await fs.readFile(path.join(temp,'artifacts/local-notes.md'),'utf8'),'Keep this user documentation.');
}));

test('source edits during a read cannot be paired with a newer revision',async t=>workspace(async temp=>{
 const file=productPath(temp),originalRead=fs.readFile.bind(fs),originalWrite=fs.writeFile.bind(fs);let reads=0;
 t.mock.method(fs,'readFile',async function(target,...args){const bytes=await originalRead(target,...args);if(String(target)===file&&++reads===2){const value=JSON.parse(String(bytes));value.variants[0].offer.notes='Concurrent source edit.';await originalWrite(file,JSON.stringify(value));}return bytes;});
 await assert.rejects(loadArtifactSources(temp),/changed while loading/);t.mock.restoreAll();assert.equal((await read(file)).variants[0].offer.notes,'Concurrent source edit.');
}));

test('source edits during staging survive and reject the pending replacement',async t=>workspace(async temp=>{
 const sources=await loadArtifactSources(temp),file=productPath(temp),originalWrite=fs.writeFile.bind(fs);let edited=false;
 t.mock.method(fs,'writeFile',async function(target,...args){await originalWrite(target,...args);if(!edited&&String(target).includes('.artifacts-stage-')&&String(target).endsWith('.json')){edited=true;const product=await read(file);product.variants[0].offer.notes='Concurrent manual edit kept.';await originalWrite(file,JSON.stringify(product));}});
 await assert.rejects(writeArtifactDocuments(sources.legacyDocuments,{root:temp,expectedRevision:sources.revision}),/changed during staging/);t.mock.restoreAll();assert.equal((await read(file)).variants[0].offer.notes,'Concurrent manual edit kept.');assert.ok(!(await fs.readdir(temp)).some(n=>n.startsWith('.artifacts-')));
}));

test('duplicate source arrays, reserved output paths and unknown product categories fail closed',async()=>{
 const cases=[
  ['artifacts/wiki/biotin.json',v=>{v.catalog.offers=[];},/Wiki filename/],
  ['artifacts/products/_meta.json',v=>{v.observations.observations=[];},/duplicate file-owned/],
  ['artifacts/products/_meta.json',v=>{v.refreshSources.products=[];},/duplicate file-owned/],
  ['artifacts/wiki/biotin.json',v=>{v.category.page='index.html';},/collide/],
  ['artifacts/wiki/biotin.json',v=>{v.category.file='research.json';},/collide/],
  ['artifacts/wiki/biotin.json',v=>{v.category.file='../../escape.json';},/flat filenames/],
  ['artifacts/products/creatine/one-science-nutrition/100-micronized-creatine.json',v=>{v.category='missing-wiki';},/Product path/]
 ];
 for(const [relative,edit,error] of cases)await workspace(async temp=>{const file=path.join(temp,relative),value=await read(file);edit(value);await write(file,value);await assert.rejects(loadArtifactSources(temp),error);});
});

test('exports cannot write into authoritative sources and reads reject active writer locks',async()=>workspace(async temp=>{
 await assert.rejects(exportLegacy(path.join(temp,'artifacts/products/staging'),{root:temp}),/outside the authoritative/);
 await fs.mkdir(path.join(temp,'.artifacts-write-lock'));await assert.rejects(loadArtifactSources(temp),/being updated/);await fs.rmdir(path.join(temp,'.artifacts-write-lock'));
 assert.equal(artifactSlug('CON'),'item-con');assert.ok(artifactSlug('Very long product '.repeat(20)).length<=72);
}));

test('the maintained research merger writes product artifacts and retains all unrelated evidence',async()=>workspace(async temp=>{
 const before=await loadArtifactSources(temp),product=await read(productPath(temp)),r=product.variants[0].offer,fragment=path.join(temp,'review.json');
 await write(fragment,{checked:'2026-11-20',categoriesCovered:['creatine'],updates:[{category:'creatine',offerId:r.id,reviewType:'label',patch:{notes:'Reviewed fixture label note.'},evidence:{checked:'2026-11-20',sourceUrl:r.url,matchBasis:'Exact fixture product identity and label check.'}}]});
 await mergeCatalogResearch([fragment],{root:temp,asOf:before.legacyDocuments['catalog-research.json'].checked});const after=await loadArtifactSources(temp);
 assert.equal((await read(productPath(temp))).variants[0].offer.notes,'Reviewed fixture label note.');assert.deepEqual(after.bundle.observations,before.bundle.observations);assert.deepEqual(after.bundle.categories.protein,before.bundle.categories.protein);assert.deepEqual(after.additionalSources,before.additionalSources);await assert.rejects(fs.access(path.join(temp,'docs/data/creatine.json')),{code:'ENOENT'});
}));

test('the maintained testing importer updates the shared artifact ledger without changing products or prices',async()=>workspace(async temp=>{
 const before=await loadArtifactSources(temp),input=path.join(temp,'testing-harvest.json'),harvest=structuredClone(before.bundle.testing);harvest.reports[0].notes='Fixture source scope note.';await write(input,harvest);
 await importTrustifiedReports(input,{root:temp});const after=await loadArtifactSources(temp);assert.equal(after.bundle.testing.reports[0].notes,'Fixture source scope note.');assert.deepEqual(after.bundle.categories,before.bundle.categories);assert.deepEqual(after.bundle.observations,before.bundle.observations);await assert.rejects(fs.access(path.join(temp,'docs/data/trustified-reports.json')),{code:'ENOENT'});
}));
