import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createSnapshot} from '../docs/model.js';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const clone=structuredClone;
const json=value=>JSON.stringify(value,null,2)+'\n';
const idPattern=/^[a-z][a-z0-9-]*$/;
const filePattern=/^[a-z][a-z0-9-]*\.json$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,target)=>{const relative=path.relative(path.resolve(root),path.resolve(target));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Artifact path escapes its root: '+target);return target;};
const readJson=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){throw Error(`Cannot read JSON ${file}: ${e.message}`);}};
const exists=async file=>{try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const order=(a,b)=>(a.order??Number.MAX_SAFE_INTEGER)-(b.order??Number.MAX_SAFE_INTEGER)||a.file.localeCompare(b.file)||a.index-b.index;
const entry=(value,field,file,index)=>{if(!plain(value)||!plain(value[field])||value.order!=null&&(!Number.isInteger(value.order)||value.order<0))throw Error(`Invalid ordered ${field} in ${file}`);return {value:clone(value[field]),order:value.order,file,index};};

export function artifactSlug(value,limit=72){
 let result=String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'item';
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(result))result='item-'+result;
 if(result.length>limit)result=result.slice(0,limit-9).replace(/-$/,'')+'-'+sha(String(value)).slice(0,8);
 return result;
}
async function filesBelow(directory,includeAll=false){
 const result=[];
 async function visit(current){
  const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw Error('Symlinks are not allowed in artifact sources: '+current);
  for(const item of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=inside(directory,path.join(current,item.name));if(item.isSymbolicLink())throw Error('Symlinks are not allowed in artifact sources: '+file);
   if(item.isDirectory())await visit(file);else if(item.isFile()&&(includeAll||item.name.endsWith('.json')))result.push(file);
  }
 }
 await visit(directory);return result;
}
export async function artifactRevision(root=projectRoot){
 const directory=path.join(root,'artifacts'),files=await filesBelow(directory,true),hash=createHash('sha256');
 for(const file of files){hash.update(path.relative(directory,file).replaceAll(path.sep,'/'));hash.update('\0');hash.update(await fs.readFile(file));hash.update('\0');}
 return hash.digest('hex');
}

export async function readLegacyDocuments(root=projectRoot){
 const directory=path.join(root,'docs/data'),documents={};
 for(const name of (await fs.readdir(directory)).filter(name=>name.endsWith('.json')).sort())documents[name]=await readJson(path.join(directory,name));
 return documents;
}
export function bundleFromDocuments(documents){
 const config=clone(documents['site.json']);if(!config)throw Error('Missing site configuration.');
 const categories=Object.fromEntries(config.categories.map(c=>{if(!documents[c.file])throw Error('Missing category data '+c.file);return [c.id,clone(documents[c.file])];}));
 const ledger=documents[config.observationsFile];if(!Array.isArray(ledger?.observations))throw Error('Missing price observation ledger.');
 return {config,categories,testing:config.testingFile?clone(documents[config.testingFile]):null,catalogResearch:config.catalogResearchFile?clone(documents[config.catalogResearchFile]):null,research:clone(documents['research.json']),recommender:clone(documents['recommender.json']),brands:clone(documents[config.brandsFile]),observations:clone(ledger.observations)};
}

/** Discover content from the filesystem. No hand-maintained product/article list. */
export async function loadArtifactSources(root=projectRoot){
 const directory=path.join(root,'artifacts');
 if(await exists(path.join(root,'.artifacts-write-lock')))throw Error('Artifact sources are being updated; retry after the writer completes.');
 if(!await exists(directory)){if(await exists(path.join(root,'.artifacts-write-lock')))throw Error('Artifact sources are being updated; retry after the writer completes.');const legacyDocuments=await readLegacyDocuments(root);return {bundle:bundleFromDocuments(legacyDocuments),additionalSources:clone(legacyDocuments['additional-sources.json']),legacyDocuments,revision:null,source:'legacy'};}
 const initialRevision=await artifactRevision(root);
 const manifest=await readJson(path.join(directory,'manifest.json'));
 if(manifest.schemaVersion!==1||manifest.layoutVersion!==1||!Array.isArray(manifest.metadataFiles)||new Set(manifest.metadataFiles).size!==manifest.metadataFiles.length||manifest.metadataFiles.some(name=>!filePattern.test(name)))throw Error('Unsupported artifact manifest.');
 const metadata={};for(const name of manifest.metadataFiles)metadata[name]=await readJson(inside(directory,path.join(directory,name)));
 for(const name of await fs.readdir(directory))if(name.endsWith('.json')&&name!=='manifest.json'&&!manifest.metadataFiles.includes(name))throw Error('Unregistered root metadata file: '+name);
 const site=metadata['site.json'],policy=metadata['research-policy.json'],references=metadata['references.json'];
 if(!plain(site)||site.categories!==undefined||!plain(policy)||policy.articles!==undefined||policy.sources!==undefined||policy.editorial?.articles!==undefined||policy.editorial?.series!==undefined||!Array.isArray(references?.sources))throw Error('Artifact metadata must not duplicate file-owned categories, guides, articles or references.');
 const wikiFiles=await filesBelow(path.join(directory,'wiki')),wiki=[];
 for(const file of wikiFiles){const value=await readJson(file),relative=path.relative(path.join(directory,'wiki'),file);
  if(value.schemaVersion!==1||!plain(value.category)||!idPattern.test(value.category.id)||relative!==value.category.id+'.json'||!plain(value.catalog)||value.catalog.offers!==undefined||!plain(value.guide)||value.guide.category!==value.category.id)throw Error('Wiki filename, category, guide and catalog metadata must agree: '+file);
  wiki.push({...entry({order:value.order,value},'value',file,0),id:value.category.id});
 }
 wiki.sort(order);if(!wiki.length||new Set(wiki.map(w=>w.id)).size!==wiki.length)throw Error('Wiki categories must be present and unique.');
 for(const w of wiki){const c=w.value.category;c.file??=c.id+'.json';c.page??=c.id+'.html';if(!filePattern.test(c.file)||!/^([a-z][a-z0-9-]*)\.html$/.test(c.page))throw Error('Category export filenames and pages must be local flat filenames.');}
 if(new Set(wiki.map(w=>w.value.category.file)).size!==wiki.length||new Set(wiki.map(w=>w.value.category.page)).size!==wiki.length)throw Error('Category filenames and pages must be unique.');
 const config={...clone(site),categories:wiki.map(w=>clone(w.value.category))},categoryById=new Map(config.categories.map(c=>[c.id,c]));
 for(const key of ['observationsFile','brandsFile','testingFile','catalogResearchFile'])if(config[key]!=null&&!filePattern.test(config[key]))throw Error('Configured metadata exports need safe flat JSON filenames.');
 const reservedFiles=new Set([...manifest.metadataFiles,'manifest.json','research.json',config.observationsFile,'additional-sources.json','price-audit.json','price-history.json','quality-report.json','version.json','published-pages.json']),reservedPages=new Set(['index.html','research.html','articles.html','library.html','editorial-policy.html','audit.html','recommender.html','search.html','404.html']);
 for(const c of config.categories)if(reservedFiles.has(c.file)||reservedPages.has(c.page)||/^(article|guide)-/.test(c.page))throw Error('Category filenames must not collide with shared metadata or generated reading pages.');
 const productMeta=await readJson(path.join(directory,'products/_meta.json'));
 if(productMeta.schemaVersion!==1||!plain(productMeta.observations)||productMeta.observations.observations!==undefined||!plain(productMeta.refreshSources)||productMeta.refreshSources.products!==undefined)throw Error('Products need history/refresh metadata without duplicate file-owned arrays.');
 const variants=[],observations=[],profiles=[],productPaths=new Set();
 for(const file of await filesBelow(path.join(directory,'products'))){
  const relative=path.relative(path.join(directory,'products'),file);if(relative==='_meta.json')continue;
  const parts=relative.split(path.sep),value=await readJson(file);
  if(value.schemaVersion!==1||parts.length!==3||parts[0]!==value.category||!categoryById.has(value.category)||typeof value.brand!=='string'||!value.brand.trim()||typeof value.product!=='string'||!value.product.trim()||parts[1]!==artifactSlug(value.brand,48)||parts[2]!==artifactSlug(value.product)+'.json'||!Array.isArray(value.variants)||!value.variants.length||!Array.isArray(value.priceHistory)||!Array.isArray(value.refreshSources))throw Error('Product path, identity, variants and history must agree: '+file);
  const key=JSON.stringify([value.category,value.brand,value.product]);if(productPaths.has(key))throw Error('Duplicate product artifact: '+file);productPaths.add(key);
  for(const [index,v] of value.variants.entries()){const row=entry(v,'offer',file,index);if(row.value.brand!==value.brand||row.value.product!==value.product)throw Error('Variant identity differs from its product file: '+file);variants.push({...row,category:value.category});}
  for(const [index,v] of value.priceHistory.entries()){const row=entry(v,'observation',file,index);if(row.value.category!==value.category||!value.variants.some(v=>String(v.offer?.id)===String(row.value.offerId)))throw Error('Price history belongs to a different product: '+file);observations.push(row);}
  for(const [index,v] of value.refreshSources.entries()){const row=entry(v,'profile',file,index);if(row.value.category!==value.category||row.value.brand!==value.brand||row.value.id!=null&&!value.variants.some(v=>String(v.offer?.id)===String(row.value.id)))throw Error('Refresh source belongs to another product, brand or category: '+file);profiles.push(row);}
 }
 for(const [index,v] of (productMeta.unassignedObservations||[]).entries())observations.push(entry(v,'observation','products/_meta.json',index));
 for(const [index,v] of (productMeta.unassignedRefreshSources||[]).entries())profiles.push(entry(v,'profile','products/_meta.json',index));
 const series=[],articles=[];
 for(const file of await filesBelow(path.join(directory,'articles'))){
  const parts=path.relative(path.join(directory,'articles'),file).split(path.sep),value=await readJson(file);
  if(value.schemaVersion!==1)throw Error('Unsupported article artifact: '+file);
  if(parts.length===3&&parts[0]==='series'&&parts[2]==='_series.json'){
   const row=entry(value,'series',file,0);if(!idPattern.test(row.value.id)||row.value.id==='standalone'||row.value.id!==parts[1])throw Error('Series directory and identity must agree: '+file);series.push(row);continue;
  }
  const row=entry(value,'article',file,0),a=row.value;
  if(!idPattern.test(a.id)||parts.at(-1)!==a.id+'.json'||!categoryById.has(a.category))throw Error('Article path, ID or category is invalid: '+file);
  if(parts.length===1){if(a.series!=null)throw Error('Standalone articles cannot declare a named series: '+file);}
  else if(parts.length===3&&parts[0]==='series'){if(a.series!=null&&a.series!==parts[1])throw Error('Article series differs from its directory: '+file);a.series=parts[1];}
  else throw Error('Articles belong directly in articles/ or articles/series/<series>/: '+file);
  articles.push(row);
 }
 series.sort(order);articles.sort(order);
 if(new Set(series.map(r=>r.value.id)).size!==series.length||new Set(articles.map(r=>r.value.id)).size!==articles.length)throw Error('Duplicate article or series ID.');
 if(articles.some(r=>r.value.series!=null&&!series.some(s=>s.value.id===r.value.series)))throw Error('An article refers to a missing series descriptor.');
 const research={...clone(policy),articles:wiki.map(w=>clone(w.value.guide)),sources:clone(references.sources),editorial:{...clone(policy.editorial),series:series.map(r=>r.value),articles:articles.map(r=>r.value)}};
 variants.sort(order);observations.sort(order);profiles.sort(order);
 const legacyDocuments=Object.fromEntries(Object.entries(metadata).filter(([name])=>!['site.json','research-policy.json','references.json'].includes(name)).map(([name,v])=>[name,clone(v)]));
 legacyDocuments['site.json']=config;legacyDocuments['research.json']=research;
 for(const w of wiki)legacyDocuments[w.value.category.file]={...clone(w.value.catalog),offers:variants.filter(r=>r.category===w.id).map(r=>r.value)};
 legacyDocuments[config.observationsFile]={...clone(productMeta.observations),observations:observations.map(r=>r.value)};
 legacyDocuments['additional-sources.json']={...clone(productMeta.refreshSources),products:profiles.map(r=>r.value)};
 const revision=await artifactRevision(root);if(revision!==initialRevision)throw Error('Artifact sources changed while loading; retry from a stable source revision.');
 return {bundle:bundleFromDocuments(legacyDocuments),additionalSources:clone(legacyDocuments['additional-sources.json']),legacyDocuments,revision,source:'artifacts'};
}

/** Convert a complete assembled input dataset to the documented editable tree. */
export function artifactFilesFromDocuments(documents){
 const bundle=bundleFromDocuments(documents),{config,research}=bundle,files=new Map(),put=(name,value)=>{if(files.has(name))throw Error('Artifact filename collision: '+name);files.set(name,value);};
 if(!research)throw Error('Research metadata is required for migration.');
 const categoryFiles=new Set(config.categories.map(c=>c.file)),partitioned=new Set([...categoryFiles,'site.json','research.json',config.observationsFile,'additional-sources.json','price-audit.json','price-history.json','quality-report.json','version.json',...Object.keys(documents).filter(name=>name.startsWith('snapshot.'))]);
 const metadataFiles=Object.keys(documents).filter(name=>!partitioned.has(name)).sort();
 const site=clone(config);delete site.categories;put('site.json',site);metadataFiles.push('site.json','research-policy.json','references.json');
 for(const name of Object.keys(documents).filter(name=>!partitioned.has(name)).sort())put(name,clone(documents[name]));
 const policy=clone(research);delete policy.articles;delete policy.sources;delete policy.editorial.articles;delete policy.editorial.series;put('research-policy.json',policy);put('references.json',{sources:clone(research.sources)});
 const groups=new Map(),offerGroup=new Map();
 for(const [categoryIndex,c] of config.categories.entries()){
  const input=documents[c.file],catalog=clone(input);delete catalog.offers;
  const guide=research.articles.find(a=>a.category===c.id);if(!guide)throw Error('Missing wiki guide for '+c.id);
  put(`wiki/${c.id}.json`,{schemaVersion:1,order:categoryIndex,category:clone(c),catalog,guide:clone(guide)});
  for(const [index,r] of input.offers.entries()){
   const key=JSON.stringify([c.id,r.brand,r.product]);if(!groups.has(key))groups.set(key,{schemaVersion:1,category:c.id,brand:r.brand,product:r.product,variants:[],priceHistory:[],refreshSources:[]});
   const g=groups.get(key),offerKey=JSON.stringify([c.id,String(r.id)]);if(offerGroup.has(offerKey))throw Error('Duplicate offer ID during artifact partition: '+offerKey);offerGroup.set(offerKey,g);g.variants.push({order:index,offer:clone(r)});
  }
 }
 const unassignedObservations=[],unassignedRefreshSources=[];
 for(const [index,o] of bundle.observations.entries()){const wrapper={order:index,observation:clone(o)},group=offerGroup.get(JSON.stringify([o.category,String(o.offerId)]));(group?group.priceHistory:unassignedObservations).push(wrapper);}
 const additional=clone(documents['additional-sources.json']||{products:[]});
 for(const [index,p] of additional.products.entries()){
  let matches=p.id!=null?[offerGroup.get(JSON.stringify([p.category,String(p.id)]))].filter(Boolean):[...groups.values()].filter(g=>g.category===p.category&&g.brand===p.brand&&g.product===p.product);
  if(!matches.length&&p.variantIds?.length){const ids=new Set(p.variantIds.map(String));matches=[...groups.values()].filter(g=>g.category===p.category&&g.brand===p.brand&&g.variants.some(({offer:r})=>{try{return ids.has(new URL(r.url).searchParams.get('variant'))||ids.has(String(r.sourceVariantId));}catch{return false;}}));}
  const wrapper={order:index,profile:clone(p)};(matches.length===1?matches[0].refreshSources:unassignedRefreshSources).push(wrapper);
 }
 for(const g of groups.values())put(`products/${g.category}/${artifactSlug(g.brand,48)}/${artifactSlug(g.product)}.json`,g);
 const observations=clone(documents[config.observationsFile]);delete observations.observations;delete additional.products;
 put('products/_meta.json',{schemaVersion:1,observations,refreshSources:additional,unassignedObservations,unassignedRefreshSources});
 for(const [index,s] of research.editorial.series.entries())put(`articles/series/${s.id}/_series.json`,{schemaVersion:1,order:index,series:clone(s)});
 for(const [index,a] of research.editorial.articles.entries())put(a.series==null?`articles/${a.id}.json`:`articles/series/${a.series}/${a.id}.json`,{schemaVersion:1,order:index,article:clone(a)});
 put('manifest.json',{schemaVersion:1,layoutVersion:1,metadataFiles:metadataFiles.sort()});return files;
}

function validateDocuments(documents){const snapshot=createSnapshot(bundleFromDocuments(documents));if(snapshot.quality.errors.length)throw Error('Artifact publication validation failed:\n'+snapshot.quality.errors.map(e=>`${e.category}/${e.id} ${e.field}: ${e.message}`).join('\n'));return snapshot;}
async function writeTree(directory,files){for(const [relative,value] of files){const target=inside(directory,path.join(directory,...relative.split('/')));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,json(value));}}
export async function writeArtifactDocuments(documents,{root=projectRoot,expectedRevision=null}={}){
 validateDocuments(documents);const files=artifactFilesFromDocuments(documents),target=path.join(root,'artifacts'),lock=inside(root,path.join(root,'.artifacts-write-lock')),token=randomUUID(),stage=inside(root,path.join(root,'.artifacts-stage-'+token)),backup=inside(root,path.join(root,'.artifacts-backup-'+token));
 await fs.mkdir(lock).catch(e=>{if(e.code==='EEXIST')throw Error('Another artifact update is in progress.');throw e;});
 let moved=false,installed=false;
 try{
  if(expectedRevision===null&&await exists(target))throw Error('Replacing existing artifacts requires the exported source revision.');
  if(expectedRevision!==null&&await artifactRevision(root)!==expectedRevision)throw Error('Artifact sources changed after export; refresh the staged data before importing.');
  await fs.mkdir(stage);
  // Keep human documentation/media; JSON content is completely regenerated so
  // deleted or renamed product files cannot survive as stale duplicate inputs.
  if(await exists(target))await fs.cp(target,stage,{recursive:true,filter:async source=>{const stat=await fs.lstat(source);if(stat.isSymbolicLink())throw Error('Symlinks are not allowed in artifact sources.');return stat.isDirectory()||!source.endsWith('.json');}});
  await writeTree(stage,files);
  // Read the staged layout using the same loader before touching the live tree.
  const stagingRoot=inside(root,path.join(root,'.artifacts-verify-'+token));await fs.mkdir(stagingRoot);
  try{await fs.rename(stage,path.join(stagingRoot,'artifacts'));const rebuilt=await loadArtifactSources(stagingRoot);validateDocuments(rebuilt.legacyDocuments);await fs.rename(path.join(stagingRoot,'artifacts'),stage);}finally{await fs.rm(inside(root,stagingRoot),{recursive:true,force:true});}
  if(expectedRevision!==null&&await artifactRevision(root)!==expectedRevision)throw Error('Artifact sources changed during staging; the edited sources were retained.');
  if(await exists(target)){await fs.rename(target,backup);moved=true;}await fs.rename(stage,target);installed=true;
  if(moved)await fs.rm(inside(root,backup),{recursive:true,force:true}).catch(error=>console.warn('Artifact update installed; old backup could not be removed: '+error.message));
 }catch(error){if(moved&&!installed)await fs.rename(backup,target);throw error;}
 finally{if(await exists(stage))await fs.rm(inside(root,stage),{recursive:true,force:true});await fs.rmdir(lock);}
 return loadArtifactSources(root);
}

export async function exportLegacy(destination,{root=projectRoot}={}){
 if(path.resolve(destination)===path.resolve(root))throw Error('Export to a separate staging directory, not the source repository.');
 const relative=path.relative(path.join(root,'artifacts'),path.resolve(destination));if(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Export outside the authoritative artifacts directory.');
 const sources=await loadArtifactSources(root),directory=path.join(destination,'docs/data');await fs.mkdir(directory,{recursive:true});
 for(const [name,value] of Object.entries(sources.legacyDocuments))await fs.writeFile(inside(directory,path.join(directory,name)),json(value));
 await fs.writeFile(path.join(destination,'.artifact-revision.json'),json({schemaVersion:1,revision:sources.revision}));return sources;
}
export async function importLegacy(source,{root=projectRoot}={}){const state=await readJson(path.join(source,'.artifact-revision.json'));if(state.schemaVersion!==1||!state.revision)throw Error('A staged import needs its exported source revision.');return writeArtifactDocuments(await readLegacyDocuments(source),{root,expectedRevision:state.revision});}

async function main(){
 const args=process.argv.slice(2),flag=args.indexOf('--root');let root=projectRoot;if(flag>=0){root=path.resolve(args[flag+1]);args.splice(flag,2);}const [command,target]=args;
 if(command==='export-legacy'&&target)await exportLegacy(path.resolve(target),{root});
 else if(command==='import-legacy'&&target)await importLegacy(path.resolve(target),{root});
 else if(command==='validate'){const sources=await loadArtifactSources(root),snapshot=validateDocuments(sources.legacyDocuments);console.log(JSON.stringify({source:sources.source,revision:sources.revision,offers:snapshot.stats.offers,wiki:snapshot.research.articles.length,articles:snapshot.research.editorial.articles.length}));}
 else throw Error('Usage: node scripts/artifact_store.mjs export-legacy|import-legacy STAGING_ROOT [--root REPO_ROOT], or validate');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
