import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSnapshot,isoDate,retailerQuoteIssues} from '../docs/model.js';
import {loadBundle} from './build_site.mjs';

const unique=(rows,key=JSON.stringify)=>[...new Map(rows.map(r=>[key(r),r])).values()];
const offerKey=r=>r.category+'/'+r.offerId;
const sourceKey=p=>p.category+'/'+p.id;
const quoteKey=q=>JSON.stringify([q.retailer,q.sourceUrl,q.checked]);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;

// Pure merge so partial follow-ups can be verified without writing public data.
export function applyCatalogResearch(bundle,sources,prior,fragments,{asOf}={}){
 if(!isoDate(asOf)||prior?.checked>asOf)throw Error('Research date must not precede the existing audit.');
 const priorNew=new Set((prior?.additions||[]).map(r=>r.category+'/'+r.offerId));
 const before=Object.fromEntries(Object.entries(bundle.categories).map(([id,c])=>[id,c.offers.length]));
 if(prior)for(const c of prior.coverage)before[c.category]=c.beforeOffers;
 const audit={...structuredClone(prior||{}),checked:asOf,reviewStart:prior?.reviewStart||prior?.checked||asOf,scope:prior?.scope||'Exact public retail offers available in India; selected new product labels checked individually. A current price check does not reverify the nutritional label or establish independent laboratory testing.',categoriesCovered:[...prior?.categoriesCovered||[]],updates:[...prior?.updates||[]],additions:(prior?.additions||[]).map(r=>({...r,checked:r.checked||prior.checked})),research:[...prior?.research||[]],exclusions:[...prior?.exclusions||[]],retailerQuotes:[...prior?.retailerQuotes||[]]};
 // Retain provenance as well as the price fact. A later review can describe
 // the same dated quote differently without erasing the original record.
 const observationKey=o=>JSON.stringify(stable(o));
 const observations=new Map(bundle.observations.map(o=>[observationKey(o),o]));
 const seenUrls=new Map(Object.entries(bundle.categories).map(([id,c])=>[id,new Set(c.offers.map(r=>r.url))]));
 const derived=['cost','powderCost','doseCost','trend','priceAudit','proteinPerScoop','score','rankingEligible','referenceCost','activeUnitCost','unitCost','servingCost'];
 const touched=new Set();
 const saveProfile=(profile,category,id)=>{if(!profile)return;const p={...structuredClone(profile),id};if(p.category!==category)throw Error('Source profile category mismatch.');const index=sources.products.findIndex(old=>sourceKey(old)===sourceKey(p));if(index>=0)sources.products[index]=p;else sources.products.push(p);};
 for(const f of fragments){const checked=f.checked||asOf;if(!isoDate(checked)||checked>asOf)throw Error('Invalid fragment review date.');
  for(const replacement of f.sourceProfileReplacements||[]){const {match,profiles}=replacement;
   if(!match||!Object.keys(match).length||Object.keys(match).some(k=>!['category','brand','handle','id'].includes(k))||!Array.isArray(profiles)||!profiles.length)throw Error('Source profile replacements need an explicit identity and replacement profiles.');
   const matches=p=>Object.entries(match).every(([k,v])=>p[k]===v),old=sources.products.filter(matches);
   if(old.length===profiles.length&&profiles.every(p=>old.some(existing=>JSON.stringify(existing)===JSON.stringify(p))))continue;
   if(old.length!==1||profiles.some(p=>p.category!==match.category||p.brand!==match.brand||p.handle!==match.handle))throw Error('Source profile replacement must identify one family and retain its identity.');
   sources.products=sources.products.flatMap(p=>p===old[0]?structuredClone(profiles):[p]);
  }
  for(const id of f.categoriesCovered||[])if(!bundle.categories[id])throw Error('Unknown researched category '+id);else if(!audit.categoriesCovered.includes(id))audit.categoriesCovered.push(id);
  for(const u of f.updates||[]){const c=bundle.categories[u.category],row=c?.offers.find(r=>String(r.id)===String(u.offerId));if(!row)throw Error('Update refers to missing offer '+u.category+'/'+u.offerId);
   if(!u.evidence?.sourceUrl||!isoDate(u.evidence.checked)||u.evidence.checked>asOf||!u.evidence.matchBasis)throw Error('Update lacks dated exact-match evidence: '+u.offerId);
   if(Object.keys(u.patch).some(k=>derived.includes(k))||u.patch.id!=null&&String(u.patch.id)!==String(row.id))throw Error('A research patch must contain source inputs and retain the stable offer ID.');
   const priceReview=Object.hasOwn(u.patch,'price')&&u.reviewType!=='label';Object.assign(row,u.patch);row[priceReview?'lastPriceReview':'lastLabelReview']={checked:u.evidence.checked,sourceUrl:u.evidence.sourceUrl,evidenceUrl:u.evidence.evidenceUrl,matchBasis:u.evidence.matchBasis};touched.add(u.category);saveProfile(u.profile,u.category,row.id);
   audit.updates.push({category:u.category,offerId:row.id,fields:Object.keys(u.patch),evidence:u.evidence,reviewType:priceReview?'price':'label'});
  }
  for(const a of f.additions||[]){const c=bundle.categories[a.category],row=a.offer;if(!c||!row||!row.id)throw Error('Invalid new offer.');
   const old=c.offers.find(r=>String(r.id)===String(row.id));if(old){if(old.url!==row.url)throw Error('New ID conflicts with an existing exact pack.');if(priorNew.has(a.category+'/'+row.id))saveProfile(a.profile,a.category,row.id);continue;}
   if(seenUrls.get(a.category).has(row.url))throw Error('Product variant already listed: '+row.url);
   if(!isoDate(row.labelChecked)||row.labelChecked>asOf)throw Error('New profile needs a deliberately checked label date: '+row.id);
   c.offers.push(row);seenUrls.get(a.category).add(row.url);touched.add(a.category);audit.additions.push({category:a.category,offerId:row.id,brand:row.brand,product:row.product,url:row.url,checked:row.labelChecked});saveProfile(a.profile,a.category,row.id);
  }
  for(const item of f.retailerQuotes||[]){const c=bundle.categories[item.category],row=c?.offers.find(r=>String(r.id)===String(item.offerId));if(!row)throw Error('Retailer quote refers to missing offer '+item.category+'/'+item.offerId);const {category,offerId,quote:wrapped,...fields}=item,quote=wrapped||fields;
   const issues=retailerQuoteIssues([quote],asOf);if(issues.length)throw Error('Invalid retailer quote: '+issues[0].message);const old=(row.retailerQuotes||[]).find(q=>quoteKey(q)===quoteKey(quote));if(old&&old.price!==quote.price)throw Error('Conflicting same-date retailer quote: '+offerId);
   row.retailerQuotes=unique([...(row.retailerQuotes||[]),quote],quoteKey);touched.add(category);audit.retailerQuotes.push({category,offerId,...quote});
  }
  for(const o of f.observations||[])observations.set(observationKey(o),o);
  Object.assign(bundle.brands,f.brands||{});audit.research.push(...f.research||[]);audit.exclusions.push(...f.exclusions||[]);
 }
 audit.updates=unique(audit.updates,r=>JSON.stringify([offerKey(r),r.evidence.checked,r.evidence.sourceUrl,r.reviewType||'price']));audit.additions=unique(audit.additions,offerKey);audit.research=unique(audit.research);audit.exclusions=unique(audit.exclusions);audit.retailerQuotes=unique(audit.retailerQuotes,q=>offerKey(q)+'/'+quoteKey(q));
 bundle.observations=[...observations.values()];
 for(const id of touched){const c=bundle.categories[id];c.checked=asOf;for(const row of c.offers)for(const key of derived)delete row[key];}
 const snapshot=createSnapshot(bundle);if(snapshot.quality.errors.length)throw Error('Research merge validation failed:\n'+JSON.stringify(snapshot.quality.errors,null,2));
 const added=new Set(audit.additions.map(r=>r.category+'/'+r.offerId)),updated=new Set(audit.updates.filter(r=>r.reviewType!=='label'&&!added.has(offerKey(r))).map(r=>r.category+'/'+r.offerId));
 audit.coverage=Object.values(snapshot.categories).map(c=>({category:c.id,label:c.label,beforeOffers:before[c.id],offers:c.offers.length,brands:c.stats.brands,priceChecks: c.offers.filter(r=>updated.has(c.id+'/'+r.id)).length,newOffers:c.offers.filter(r=>added.has(c.id+'/'+r.id)).length,verifiedPrices:c.stats.verifiedPrices,priceCheckedOnAuditDate:c.offers.filter(r=>r.priceAudit.checked===asOf&&r.priceAudit.status==='verified').length,knownLabelServing:c.offers.filter(r=>r.isUnitOffer?r.packServings!=null:r.serving!=null).length,labelsCheckedOnAuditDate:c.offers.filter(r=>r.labelChecked===asOf).length,labelsReviewedDuringPeriod:c.offers.filter(r=>r.labelChecked>=audit.reviewStart&&r.labelChecked<=asOf).length,knownActiveCost:c.stats.knownCost,retailerQuotes:c.offers.reduce((sum,r)=>sum+(r.retailerQuotes?.length||0),0)}));
 audit.summary={offers:snapshot.stats.offers,brands:snapshot.stats.brands,newOffers:audit.additions.length,existingOffersPriceChecked:updated.size,priceCheckedOnAuditDate:audit.coverage.reduce((sum,c)=>sum+c.priceCheckedOnAuditDate,0),labelsCheckedOnAuditDate:audit.coverage.reduce((sum,c)=>sum+c.labelsCheckedOnAuditDate,0),labelsReviewedDuringPeriod:audit.coverage.reduce((sum,c)=>sum+c.labelsReviewedDuringPeriod,0),verifiedPrices:snapshot.stats.verifiedPrices,categories:audit.categoriesCovered.length,exclusions:audit.exclusions.length,retailerQuotes:audit.retailerQuotes.length};
 return {audit,bundle,sources,touched:[...touched]};
}

// Fetchers never directly replace a category, and a partial follow-up never
// discards the preceding whole-catalog review or its historical observations.
export async function mergeCatalogResearch(files,{asOf=new Date().toISOString().slice(0,10),root=fileURLToPath(new URL('../',import.meta.url))}={}){
 const bundle=await loadBundle(),sources=JSON.parse(await fs.readFile(path.join(root,'docs/data/additional-sources.json'),'utf8'));
 let prior=null;try{prior=JSON.parse(await fs.readFile(path.join(root,'docs/data/catalog-research.json'),'utf8'));}catch{}
 const fragments=await Promise.all(files.map(file=>fs.readFile(file,'utf8').then(JSON.parse)));
 const {audit,touched}=applyCatalogResearch(bundle,sources,prior,fragments,{asOf});
 const data=path.join(root,'docs/data'),write=(name,value)=>fs.writeFile(path.join(data,name),JSON.stringify(value,null,2)+'\n');
 for(const id of touched)await write(bundle.config.categories.find(c=>c.id===id).file,bundle.categories[id]);
 await write('brands.json',bundle.brands);await write('additional-sources.json',sources);
 const ledger=JSON.parse(await fs.readFile(path.join(data,bundle.config.observationsFile),'utf8'));ledger.checked=asOf;ledger.observations=bundle.observations;await write(bundle.config.observationsFile,ledger);
 await write('catalog-research.json',audit);await write('catalog-research-summary.json',{checked:asOf,reviewStart:audit.reviewStart,scope:audit.scope,summary:audit.summary,coverage:audit.coverage,reportFile:'catalog-research.json',requirementsFile:'catalog-data-requirements.json'});
 console.log(JSON.stringify(audit.summary));return audit;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),flag=args.indexOf('--as-of'),asOf=flag<0?new Date().toISOString().slice(0,10):args.splice(flag,2)[1];if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('Use --as-of YYYY-MM-DD.');await mergeCatalogResearch(args,{asOf});}
