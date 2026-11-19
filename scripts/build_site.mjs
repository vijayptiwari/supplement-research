import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createSnapshot,auditRows,historyRows} from '../docs/model.js';
import {publishReadableSite} from './publish_readable_site.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async file=>JSON.parse(await fs.readFile(path.join(root,'docs/data',file),'utf8'));
export async function loadBundle(){
 const config=await read('site.json'),categories={};
 for(const c of config.categories)categories[c.id]=await read(c.file);
 const ledger=await read(config.observationsFile);
 return {config,categories,catalogResearch:config.catalogResearchFile?await read(config.catalogResearchFile):null,research:await read('research.json'),recommender:await read('recommender.json'),brands:await read(config.brandsFile),observations:ledger.observations};
}
export async function buildSite(destination=path.join(root,'dist')){
 const bundle=await loadBundle(),snapshot=createSnapshot(bundle);
 if(snapshot.quality.errors.length)throw Error('Dataset validation failed:\n'+snapshot.quality.errors.map(e=>`${e.category}/${e.id} ${e.field}: ${e.message}`).join('\n'));
 await fs.mkdir(destination,{recursive:true});
 await fs.cp(path.join(root,'docs'),destination,{recursive:true});
 // Code and styles change independently of quarterly data. Fingerprint the whole
 // browser module graph so a new entry point cannot reuse an older dependency.
 const assetNames=(await fs.readdir(path.join(root,'docs'))).filter(name=>/\.(js|css)$/.test(name)).sort();
 const assetSources=await Promise.all(assetNames.map(name=>fs.readFile(path.join(root,'docs',name),'utf8')));
 const assetVersion=createHash('sha256').update(assetSources.join('\0')).digest('hex').slice(0,16);
 for(let i=0;i<assetNames.length;i++)if(assetNames[i].endsWith('.js'))await fs.writeFile(path.join(destination,assetNames[i]),assetSources[i].replace(/(from\s*['"])(\.\/[\w-]+\.js)(['"])/g,`$1$2?v=${assetVersion}$3`));
 // Only the build owns dist. Remove obsolete content-addressed bundles from previous builds.
 for(const name of await fs.readdir(path.join(destination,'data')))if(/^snapshot\.[a-f0-9]+\.json$/.test(name))await fs.unlink(path.join(destination,'data',name));
 const write=async(file,value)=>fs.writeFile(path.join(destination,file),typeof value==='string'?value:JSON.stringify(value));
 for(const c of Object.values(snapshot.categories))await write('data/'+c.file,{checked:c.asOf,category:c.id,...(c.educationOnly?{scope:c.scope}:{}),offers:c.offers});
 const rows=auditRows(snapshot),summary={offers:rows.length,current_verified:snapshot.stats.verifiedPrices,quarter_comparable:snapshot.stats.verifiedTrends,up:rows.filter(r=>r.direction==='up').length,down:rows.filter(r=>r.direction==='down').length,stable:rows.filter(r=>r.direction==='stable').length,historical_quotes_excluded:bundle.observations.filter(o=>o.qualityStatus==='excluded').length};
 await write('data/price-audit.json',{checked:snapshot.asOf,historyWindowQuarters:snapshot.config.historyQuarters,summary:{...summary,historicalSlots:snapshot.stats.historicalSlots,verifiedHistoricalSlots:snapshot.stats.historicalVerified,completeHistoryOffers:snapshot.stats.fullHistoryOffers},comparisonScope:'Change counts describe current versus the latest completed quarter. All requested quarters are in price-history.json and price-history.csv.',rows});
 const columns=Object.keys(rows[0]||{}),cell=x=>'"'+(typeof x==='string'?x.replace(/^[=+@-]/,"'$&"):String(x??'')).replaceAll('"','""')+'"';
 await write('data/price-audit.csv','\uFEFF'+[columns,...rows.map(r=>columns.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n'));
 const history=historyRows(snapshot),historyColumns=Object.keys(history[0]||{});
 await write('data/price-history.json',{asOf:snapshot.asOf,completedQuarters:snapshot.config.historyQuarters,summary:{historicalSlots:snapshot.stats.historicalSlots,verifiedSnapshots:snapshot.stats.historicalVerified,completeHistoryOffers:snapshot.stats.fullHistoryOffers},rows:history});
 await write('data/price-history.csv','\uFEFF'+[historyColumns,...history.map(r=>historyColumns.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n'));
 await write('data/quality-report.json',{checked:snapshot.asOf,stats:snapshot.stats,...snapshot.quality});
 bundle.assets={};
 for(const file of [...bundle.config.categories.map(c=>c.file),'price-audit.csv','price-history.csv','price-observations.json','quality-report.json'])bundle.assets[file]={bytes:(await fs.stat(path.join(destination,'data',file))).size};
 const bytes=JSON.stringify(bundle),hash=createHash('sha256').update(bytes).digest('hex'),file=`snapshot.${hash}.json`;
 await write('data/'+file,bytes);
 // Publish one small pointer last: clients never combine different dataset revisions.
 await write('data/version.json',{schemaVersion:1,version:hash,file,asOf:snapshot.asOf});
 await publishReadableSite({source:path.join(root,'docs'),destination,snapshot,assetVersion});
 console.log(`Built ${snapshot.stats.offers} offers; ${snapshot.stats.verifiedPrices} verified prices; ${snapshot.quality.warnings.length} field warnings. Revision ${hash.slice(0,12)}.`);
 return {snapshot,hash,assetVersion,destination};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildSite();
