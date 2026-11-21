import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateTestingEvidence} from '../docs/testing-evidence.js';

const unique=values=>[...new Set(values.filter(v=>v!=null&&v!==''))];
const uniqueObjects=values=>[...new Map(values.map(v=>[JSON.stringify(v),v])).values()];
const normalizedBatch=value=>String(value||'').replace(/\s+/g,'').toUpperCase();
const metadataPattern=/\b(Mf[gd]\.?\s*Date|Manufactur(?:ed|ing)\s*(?:Date)?|Exp(?:iry)?\.?\s*Date|Best\s*(?:Before|betore)|Date\s*Tested)\b\s*[-–:]*\s*/gi;

// Older pages put adjacent labels inside a single text node. They are metadata,
// not part of a batch number (and a test date is not a publication date).
function splitMetadata(value){
 const raw=typeof value==='string'?value:'',matches=[...raw.matchAll(metadataPattern)],fields={};
 for(let i=0;i<matches.length;i++){
  const label=matches[i][1].toLowerCase(),key=label.startsWith('date')?'testedDateTexts':label.startsWith('mf')||label.startsWith('manufactur')?'manufacturedTexts':'expiresTexts';
  const field=raw.slice(matches[i].index+matches[i][0].length,matches[i+1]?.index??raw.length).trim();
  if(field)(fields[key]??=[]).push(field);
 }
 return {value:raw.slice(0,matches[0]?.index??raw.length).trim(),fields};
}
export const cleanBatchNumber=value=>splitMetadata(value).value||null;

function normalizeRecord(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Every source report must be an object.');
 if(raw.batch!=null&&typeof raw.batch!=='string')throw Error('Source batch values must be text or null.');
 for(const key of ['catalogMatchEligible','reportPageAvailable'])if(raw[key]!=null&&typeof raw[key]!=='boolean')throw Error('Source '+key+' must be a boolean.');
 if(raw.normalizationVersion===1)return structuredClone(raw);
 const batch=splitMetadata(raw.batch),manufactured=splitMetadata(raw.manufacturedText),expires=splitMetadata(raw.expiresText);
 const fields=Object.fromEntries(['testedDateTexts','manufacturedTexts','expiresTexts'].map(key=>[key,unique([...(raw[key]||[]),...batch.fields[key]||[],...manufactured.fields[key]||[],...expires.fields[key]||[],...(key==='manufacturedTexts'&&manufactured.value?[manufactured.value]:[]),...(key==='expiresTexts'&&expires.value?[expires.value]:[])]) ]));
 const record={...raw,batch:batch.value||null,batchText:raw.batchText??raw.batch??null,statusText:raw.statusText||'Not stated in public text',...fields};
 record.manufacturedText=fields.manufacturedTexts[0]||'';record.expiresText=fields.expiresTexts[0]||'';
 if(raw.linkedDetailIdentity)record.linkedDetailIdentity={...raw.linkedDetailIdentity,batch:cleanBatchNumber(raw.linkedDetailIdentity.batch),batchText:raw.linkedDetailIdentity.batchText??raw.linkedDetailIdentity.batch??null};
 const changed=batch.value!==(raw.batch||'')||manufactured.value!==(raw.manufacturedText||'')||expires.value!==(raw.expiresText||'');
 if(changed&&!raw.sourceObservations?.length)record.sourceObservations=[structuredClone(raw)];
 return record;
}

/** One source URL and one clean batch form a record, regardless of text wrapping. */
export function normalizeTrustifiedReports(input){
 const groups=new Map();
 for(const raw of input){const r=normalizeRecord(raw),key=JSON.stringify([r.sourceUrl,normalizedBatch(r.batch)]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 return [...groups.values()].map(group=>{
  // Prefer a detail-backed record with the original clean batch and report links.
  const ordered=[...group].sort((a,b)=>(b.reportUrls?.length||0)-(a.reportUrls?.length||0)||Number(normalizedBatch(a.batchText)!==normalizedBatch(a.batch))-Number(normalizedBatch(b.batchText)!==normalizedBatch(b.batch))||String(a.id).localeCompare(String(b.id)));
  const base=ordered[0];if(group.length===1&&base.normalizationVersion===1)return structuredClone(base);
  const r={...base},conflicts=[...base.metadataConflicts||[]],hasReports=group.some(t=>t.reportUrls?.length);
  const notes=unique(group.map(t=>{
   let note=t.notes||'';
   if(t.linkedDetailIdentity?.batch&&normalizedBatch(t.linkedDetailIdentity.batch)===normalizedBatch(t.batch))note=note.replace(/Current linked detail page describes batch [^;]+; this historical index batch is preserved separately and current lab images are not attached\./g,'');
   if(hasReports)note=note.replace(/No directly exposed laboratory PDF\/report-gallery image URL was found for this record\./g,'');
   return note.trim();
  }));
  r.id='trustified-'+createHash('sha256').update(r.sourceUrl+'|'+normalizedBatch(r.batch)).digest('hex').slice(0,16);
  r.batchTexts=unique(group.flatMap(t=>t.batchTexts||[t.batchText]));
  r.sourceIndexUrls=unique(group.flatMap(t=>[t.sourceIndexUrl,...t.sourceIndexUrls||[]]));r.sourceIndexUrl=base.sourceIndexUrl||r.sourceIndexUrls[0]||null;
  r.listingObservations=uniqueObjects(group.flatMap(t=>t.listingObservations||[]));r.reportUrls=unique(group.flatMap(t=>t.reportUrls||[]));
  for(const field of ['testedDateTexts','manufacturedTexts','expiresTexts'])r[field]=unique(group.flatMap(t=>t[field]||[]));
  for(const [field,list] of [['manufacturedText','manufacturedTexts'],['expiresText','expiresTexts']]){
   if(r[list].length>1){r[field]='Conflicting source text: '+r[list].join(' / ');conflicts.push({field,values:r[list]});}
  }
  const identities=['brand','product','category'];
  for(const field of [...identities,'reportedStatus','publishedDate','publishedDateText','testedBy']){
   const values=unique(group.map(t=>t[field]));if(values.length>1)conflicts.push({field,values});
  }
  const statuses=unique(group.flatMap(t=>t.reportedStatuses||[t.reportedStatus])),known=statuses.filter(s=>s!=='unknown');r.reportedStatuses=statuses;
  if(known.length>1){
   // A published failure remains reviewable even if another source row disagrees.
   r.reportedStatus=known.includes('failed')?'failed':'unknown';r.statusText='Conflicting published statuses: '+known.join(' / ');notes.push('Source rows disagree on the reported status for this source URL and batch; original status observations are retained.');
  }else if(known.length===1){r.reportedStatus=known[0];r.statusText=group.find(t=>t.reportedStatus===known[0])?.statusText||r.statusText;}
  if(unique(group.map(t=>t.publishedDate)).length>1){r.publishedDate=null;r.publishedDateText=unique(group.map(t=>t.publishedDateText||t.publishedDate)).join(' / ');}
  if(r.testedDateTexts.length>1){conflicts.push({field:'testedDateTexts',values:r.testedDateTexts});notes.push('Source test-date text differs for the same batch: '+r.testedDateTexts.join(' / ')+'. These values are not publication dates and have not been resolved.');}
  const ineligible=group.filter(t=>t.catalogMatchEligible===false),identityConflict=conflicts.some(c=>identities.includes(c.field));
  if(ineligible.length||identityConflict){r.catalogMatchEligible=false;r.catalogMatchIneligibleReason=unique([...ineligible.map(t=>t.catalogMatchIneligibleReason),...(identityConflict?['Merged source observations disagree on brand, product or category; a retail product cannot be identified safely.']:[])]).join(' ');}
  if(group.some(t=>t.reportPageAvailable===true))r.reportPageAvailable=true;
  if(group.length>1){
   r.sourceObservations=uniqueObjects(group.flatMap(t=>t.sourceObservations?.length?t.sourceObservations:[structuredClone(t)]));
   notes.push('Duplicate source rows with adjacent date labels were consolidated under the clean batch number. Original source records and listing observations are retained.');
  }
  r.metadataConflicts=uniqueObjects(conflicts);r.notes=unique(notes).join(' ');r.normalizationVersion=1;
  return r;
 });
}

// Discovery rules contain reviewed source identities, not a brand-wide pass flag.
// New batches of a reviewed line join its history; a new formulation needs review.
export function buildTestingLedger(harvest,rules,categories){
 if(!Array.isArray(harvest?.reports)||!Array.isArray(rules?.matches))throw Error('Expected a public-source report harvest and curated product-line rules.');
 const reports=normalizeTrustifiedReports(harvest.reports);
 const matches=rules.matches.map(rule=>{
  const found=reports.filter(r=>r.catalogMatchEligible!==false&&r.category===rule.category&&rule.sourceIdentities.some(s=>s.brand===r.brand&&s.product===r.product&&(!s.sourceUrls||s.sourceUrls.includes(r.sourceUrl))));
  if(!found.length)throw Error('No source records resolve for '+rule.id);
  return {...rule,relation:'product-line',reportIds:found.map(r=>r.id)};
 });
 const ledger={schemaVersion:1,checked:harvest.checked,scope:'Public Trustified supplement test listings, individual report pages and retests, reviewed alongside current retail data. Results describe reported samples; current retail batches are not verified. Foods, bars and mass gainers outside this catalog are recorded as scope exclusions.',methodology:harvest.methodology,sources:harvest.sources,reports,matches,exclusions:harvest.exclusions||[]};
 const errors=[];validateTestingEvidence(ledger,categories,harvest.checked,e=>errors.push(e));if(errors.length)throw Error(errors.join('\n'));
 return ledger;
}

async function main(){
 const root=fileURLToPath(new URL('../',import.meta.url)),input=process.argv[2];
 if(!input)throw Error('Usage: node scripts/import_trustified_reports.mjs PUBLIC_HARVEST.json [CURATED_MATCH_RULES.json]');
 const read=async p=>JSON.parse(await fs.readFile(p,'utf8')),config=await read(path.join(root,'docs/data/site.json')),categories={};
 for(const c of config.categories)categories[c.id]=await read(path.join(root,'docs/data',c.file));
 const rules=await read(process.argv[3]||path.join(root,'docs/data/testing-product-matches.json')),harvest=await read(input),ledger=buildTestingLedger(harvest,rules,categories);
 await fs.writeFile(path.join(root,'docs/data/trustified-reports.json'),JSON.stringify(ledger,null,2)+'\n');
 console.log(JSON.stringify({reports:ledger.reports.length,sourceBrands:new Set(ledger.reports.map(r=>r.brand)).size,matchedLines:ledger.matches.reduce((n,m)=>n+m.products.length,0),statuses:Object.fromEntries(['passed','failed','expired','unknown'].map(s=>[s,ledger.reports.filter(r=>r.reportedStatus===s).length]))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
