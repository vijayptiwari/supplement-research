import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const hash=text=>createHash('sha256').update(text).digest('hex');
const sum=values=>values.reduce((total,value)=>total+value,0);

function localPath(root,file){
 if(typeof file!=='string'||path.basename(file)!==file||!/^[a-z0-9.-]+\.json$/i.test(file))throw Error(`Invalid dataset filename: ${file}`);
 return path.join(root,'data',file);
}

// Count the files a cold page requests, without assuming HTTP compression or
// equating payload size with browser timing/Core Web Vitals.
export async function measureBrowserPayloads(directory=path.join(projectRoot,'dist')){
 const root=path.resolve(directory);
 const pointerRaw=await fs.readFile(path.join(root,'data/version.json'));
 const pointer=JSON.parse(pointerRaw);
 if(pointer.schemaVersion!==2)throw Error('Build the site with its schema 2 browser manifest before measuring payloads.');
 const manifestRaw=await fs.readFile(localPath(root,pointer.file));
 if(hash(manifestRaw)!==pointer.version)throw Error('Manifest hash differs from the published version pointer.');
 const manifest=JSON.parse(manifestRaw);
 if(manifest.schemaVersion!==2||!manifest.resources||!manifest.legacy)throw Error('Invalid browser manifest.');

 const measured=new Map();
 async function resource(descriptor){
  if(!descriptor?.file)throw Error('Missing browser resource descriptor.');
  if(!measured.has(descriptor.file)){
   const raw=await fs.readFile(localPath(root,descriptor.file));
   if(descriptor.bytes!==undefined&&raw.length!==descriptor.bytes)throw Error(`Byte count mismatch: ${descriptor.file}`);
   if(descriptor.sha256&&hash(raw)!==descriptor.sha256)throw Error(`Hash mismatch: ${descriptor.file}`);
   measured.set(descriptor.file,{file:descriptor.file,bytes:raw.length});
  }
  return measured.get(descriptor.file);
 }

 const legacy=await resource(manifest.legacy);
 const shared=[{file:'version.json',bytes:pointerRaw.length},{file:pointer.file,bytes:manifestRaw.length},await resource(manifest.resources.core)];
 const baseline=pointerRaw.length+legacy.bytes;
 async function page(kind,id,...descriptors){
  const files=[...shared,...await Promise.all(descriptors.filter(Boolean).map(resource))];
  const bytes=sum(files.map(file=>file.bytes));
  return {kind,...(id?{id}:{}),bytes,savedBytes:baseline-bytes,reductionPercent:Number((100*(baseline-bytes)/baseline).toFixed(2)),files};
 }
 const pages=[await page('home')];
 for(const [kind,key] of [['catalog','catalogs'],['guide','guides'],['article','articles']]){
  for(const [id,descriptor] of Object.entries(manifest.resources[key]||{}))pages.push(await page(kind,id,descriptor,kind==='catalog'?manifest.resources.guides[id]:null));
 }
 pages.push(await page('search','',manifest.resources.search));
 pages.push(await page('recommender','',manifest.resources.stack));
 pages.push(await page('reading-library','',manifest.resources.library));

 const pageSummary=Object.fromEntries([...new Set(pages.map(page=>page.kind))].map(kind=>{
  const group=pages.filter(page=>page.kind===kind),ordered=[...group].sort((a,b)=>a.bytes-b.bytes);
  return [kind,{pages:group.length,minBytes:ordered[0].bytes,maxBytes:ordered.at(-1).bytes,averageBytes:Math.round(sum(group.map(page=>page.bytes))/group.length),largestPage:ordered.at(-1).id||kind}];
 }));

 const modules=new Map();
 async function visit(relative){
  const file=relative.split(/[?#]/)[0],absolute=path.resolve(root,file);
  if(absolute!==root&&!absolute.startsWith(root+path.sep))throw Error(`Module leaves build directory: ${file}`);
  if(modules.has(file))return;
  const raw=await fs.readFile(absolute),source=raw.toString('utf8');
  modules.set(file,{file,bytes:raw.length});
  const imports=[...source.matchAll(/(?:^|[;\r\n])\s*(?:import\s+(?:[^;'"()]*?\s+from\s*)?|export\s+[^;'"()]*?\s+from\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
  for(const specifier of imports){
   if(!specifier.startsWith('./')&&!specifier.startsWith('../'))continue;
   const dependency=path.relative(root,path.resolve(path.dirname(absolute),specifier.split(/[?#]/)[0])).replaceAll(path.sep,'/');
   await visit(dependency);
  }
 }
 await visit('site.js');
 const moduleFiles=[...modules.values()].sort((a,b)=>a.file.localeCompare(b.file));

 return {
  schemaVersion:1,
  units:'Uncompressed on-disk UTF-8 bytes; HTTP compression, cache reuse, HTML, CSS and runtime timings are not measured.',
  datasetRevision:pointer.version,
  asOf:manifest.asOf,
  legacyBaseline:{file:legacy.file,bytes:legacy.bytes,initialBytesIncludingPointer:baseline},
  sharedOverhead:{bytes:sum(shared.map(file=>file.bytes)),files:shared},
  initialJsonByPageType:pageSummary,
  initialJsonPages:pages,
  staticJavaScript:{entry:'site.js',bytes:sum(moduleFiles.map(file=>file.bytes)),modules:moduleFiles.length,files:moduleFiles,note:'Static imports/re-exports only. Dynamic import() page renderers and later interactions are excluded.'}
 };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),outputIndex=args.indexOf('--output');
 const output=outputIndex>=0?args[outputIndex+1]:null;
 if(outputIndex>=0&&!output)throw Error('--output requires a filename.');
 const directory=args.find((value,index)=>!value.startsWith('--')&&!(outputIndex>=0&&index===outputIndex+1))||path.join(projectRoot,'dist');
 const report=await measureBrowserPayloads(directory),json=JSON.stringify(report,null,2)+'\n';
 if(output){await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await fs.writeFile(output,json);}
 console.log(JSON.stringify({legacyBaseline:report.legacyBaseline,initialJsonByPageType:report.initialJsonByPageType,staticJavaScript:report.staticJavaScript,...(output?{report:path.resolve(output)}:{})},null,2));
}
