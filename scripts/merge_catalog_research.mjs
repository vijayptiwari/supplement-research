import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSnapshot} from '../docs/model.js';
import {loadBundle} from './build_site.mjs';

// Merge reviewed research fragments; fetchers never directly replace a category.
export async function mergeCatalogResearch(files,{asOf=new Date().toISOString().slice(0,10),root=fileURLToPath(new URL('../',import.meta.url))}={}){
 const bundle=await loadBundle(),sources=JSON.parse(await fs.readFile(path.join(root,'docs/data/additional-sources.json'),'utf8'));
 let prior=null;try{prior=JSON.parse(await fs.readFile(path.join(root,'docs/data/catalog-research.json'),'utf8'));if(prior.checked!==asOf)prior=null;}catch{}
 const priorNew=new Set((prior?.additions||[]).map(r=>r.category+'/'+r.offerId));
 const before=Object.fromEntries(Object.entries(bundle.categories).map(([id,c])=>[id,c.offers.length]));
 if(prior)for(const c of prior.coverage)before[c.category]=c.beforeOffers;
 const audit={checked:asOf,scope:'Exact public retail offers available in India; selected new product labels checked individually. A current price check does not reverify the nutritional label or establish independent laboratory testing.',categoriesCovered:[],updates:[],additions:[],research:[],exclusions:[]};
 const observationKey=o=>JSON.stringify([o.category,String(o.offerId),o.date,o.price,o.evidenceUrl,o.qualityStatus||'']);
 const observations=new Map(bundle.observations.map(o=>[observationKey(o),o]));
 const seenUrls=new Map(Object.entries(bundle.categories).map(([id,c])=>[id,new Set(c.offers.map(r=>r.url))]));
 const derived=['cost','powderCost','doseCost','trend','priceAudit','proteinPerScoop','score','rankingEligible','referenceCost','activeUnitCost','unitCost','servingCost'];
 for(const file of files){const f=JSON.parse(await fs.readFile(file,'utf8'));
  for(const id of f.categoriesCovered||[])if(!bundle.categories[id])throw Error('Unknown researched category '+id);else if(!audit.categoriesCovered.includes(id))audit.categoriesCovered.push(id);
  for(const u of f.updates||[]){const c=bundle.categories[u.category],row=c?.offers.find(r=>String(r.id)===String(u.offerId));if(!row)throw Error('Update refers to missing offer '+u.category+'/'+u.offerId);
   if(!u.evidence?.sourceUrl||u.evidence.checked!==asOf||!u.evidence.matchBasis)throw Error('Update lacks current exact-match evidence: '+u.offerId);
   if(Object.keys(u.patch).some(k=>derived.includes(k)||k==='id'))throw Error('A research patch must contain source inputs rather than calculated fields.');
   Object.assign(row,u.patch);row.lastPriceReview={checked:asOf,sourceUrl:u.evidence.sourceUrl,evidenceUrl:u.evidence.evidenceUrl,matchBasis:u.evidence.matchBasis};
   audit.updates.push({category:u.category,offerId:row.id,fields:Object.keys(u.patch),evidence:u.evidence});
  }
  for(const a of f.additions||[]){const c=bundle.categories[a.category],row=a.offer;if(!c||!row||!row.id)throw Error('Invalid new offer.');
   const old=c.offers.find(r=>String(r.id)===String(row.id));if(old){if(old.url!==row.url)throw Error('New ID conflicts with an existing exact pack.');if(priorNew.has(a.category+'/'+row.id))audit.additions.push({category:a.category,offerId:row.id,brand:row.brand,product:row.product,url:row.url});continue;}
   if(seenUrls.get(a.category).has(row.url))throw Error('Product variant already listed: '+row.url);
   if(row.labelChecked!==asOf)throw Error('New profile needs a deliberately checked label date: '+row.id);
   c.offers.push(row);seenUrls.get(a.category).add(row.url);audit.additions.push({category:a.category,offerId:row.id,brand:row.brand,product:row.product,url:row.url});
   if(a.profile){const profile={...structuredClone(a.profile),id:row.id};if(profile.category!==a.category)throw Error('Source profile category mismatch.');
    if(!sources.products.some(p=>p.category===profile.category&&p.brand===profile.brand&&p.handle===profile.handle&&JSON.stringify(p.variantIds)===JSON.stringify(profile.variantIds)&&p.variantId===profile.variantId&&p.variantSku===profile.variantSku&&JSON.stringify(p.variantTitles)===JSON.stringify(profile.variantTitles)))sources.products.push(profile);
   }
  }
  for(const o of f.observations||[])observations.set(observationKey(o),o);
  Object.assign(bundle.brands,f.brands||{});audit.research.push(...f.research||[]);audit.exclusions.push(...f.exclusions||[]);
 }
 bundle.observations=[...observations.values()];
 for(const id of audit.categoriesCovered){const c=bundle.categories[id];c.checked=asOf;for(const row of c.offers)for(const key of derived)delete row[key];}
 const snapshot=createSnapshot(bundle);if(snapshot.quality.errors.length)throw Error('Research merge validation failed:\n'+JSON.stringify(snapshot.quality.errors,null,2));
 const updated=new Set(audit.updates.map(r=>r.category+'/'+r.offerId)),added=new Set(audit.additions.map(r=>r.category+'/'+r.offerId));
 audit.coverage=Object.values(snapshot.categories).map(c=>({category:c.id,label:c.label,beforeOffers:before[c.id],offers:c.offers.length,brands:c.stats.brands,priceChecks: c.offers.filter(r=>updated.has(c.id+'/'+r.id)).length,newOffers:c.offers.filter(r=>added.has(c.id+'/'+r.id)).length,verifiedPrices:c.stats.verifiedPrices,priceCheckedOnAuditDate:c.offers.filter(r=>r.priceAudit.checked===asOf&&r.priceAudit.status==='verified').length,knownLabelServing:c.offers.filter(r=>r.isUnitOffer?r.packServings!=null:r.serving!=null).length,labelsCheckedOnAuditDate:c.offers.filter(r=>r.labelChecked===asOf).length,knownActiveCost:c.stats.knownCost}));
 audit.summary={offers:snapshot.stats.offers,brands:snapshot.stats.brands,newOffers:audit.additions.length,existingOffersPriceChecked:updated.size,priceCheckedOnAuditDate:audit.coverage.reduce((sum,c)=>sum+c.priceCheckedOnAuditDate,0),labelsCheckedOnAuditDate:audit.coverage.reduce((sum,c)=>sum+c.labelsCheckedOnAuditDate,0),verifiedPrices:snapshot.stats.verifiedPrices,categories:audit.categoriesCovered.length,exclusions:audit.exclusions.length};
 const data=path.join(root,'docs/data'),write=(name,value)=>fs.writeFile(path.join(data,name),JSON.stringify(value,null,2)+'\n');
 for(const id of audit.categoriesCovered)await write(bundle.config.categories.find(c=>c.id===id).file,bundle.categories[id]);
 await write('brands.json',bundle.brands);await write('additional-sources.json',sources);
 const ledger=JSON.parse(await fs.readFile(path.join(data,bundle.config.observationsFile),'utf8'));ledger.checked=asOf;ledger.observations=bundle.observations;await write(bundle.config.observationsFile,ledger);
 await write('catalog-research.json',audit);await write('catalog-research-summary.json',{checked:asOf,scope:audit.scope,summary:audit.summary,coverage:audit.coverage,reportFile:'catalog-research.json',requirementsFile:'catalog-data-requirements.json'});
 console.log(JSON.stringify(audit.summary));return audit;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),flag=args.indexOf('--as-of'),asOf=flag<0?new Date().toISOString().slice(0,10):args.splice(flag,2)[1];if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('Use --as-of YYYY-MM-DD.');await mergeCatalogResearch(args,{asOf});}
