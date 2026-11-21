import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSnapshot,rankedOffers} from '../docs/model.js';
import {filterOffers} from '../docs/core.js';
import {offerMatchesProductPolicy} from '../docs/product-policy.js';
import {testingForOffer,testingDetailsMarkup,testingAuditMarkup,filterTestingReports,validateTestingEvidence} from '../docs/testing-evidence.js';
import {loadBundle,buildSite} from '../scripts/build_site.mjs';

function fixture(){
 const offer={id:'sample',brand:'Example',product:'Whey',flavour:'Vanilla',type:'Whey',subclass:'Concentrate',kg:1,price:1000,protein:80,scoop:30,energy:400,stock:'In stock',url:'https://example.org/whey'};
 const report={id:'example-batch',brand:'Example',product:'Whey concentrate',batch:'OLD-001',sourceUrl:'https://www.trustified.in/passandfail/example',reportedStatus:'passed',statusText:'Passed',publishedDate:'2025-11-01',reportUrls:['https://static.wixstatic.com/report.jpg'],category:'protein'};
 return {config:{schemaVersion:1,name:'Test',baseUrl:'https://example.org/',quickPicks:[],locale:'en-IN',currency:'INR',rankingLimit:10,refreshIntervalMs:60000,maxPriceAgeDays:100,pageSizes:{flat:40,grouped:15},categories:[{id:'protein',label:'Protein',page:'protein.html',concentrationField:'protein',compoundLabel:'protein',referenceGrams:24}]},categories:{protein:{checked:'2026-11-20',offers:[offer,{...offer,id:'other',product:'Other formula'}]}},brands:{},observations:[{category:'protein',offerId:'sample',date:'2026-11-20',price:1000,currency:'INR',sourceUrl:offer.url,evidenceUrl:offer.url,kind:'official-live',qualityStatus:'verified'}],testing:{schemaVersion:1,checked:'2026-11-20',scope:'Public reported sample evidence.',reports:[report],matches:[{id:'example-whey',category:'protein',brand:'Example',products:['Whey'],reportIds:[report.id],sourceIdentities:[{brand:report.brand,product:report.product}],relation:'product-line',matchBasis:'Named product line only. Flavour, formula and current batch not established.'}]}};
}
test('curated testing links are exact product-line links, never brand-wide certification',()=>{
 const s=createSnapshot(fixture()),[whey,other]=s.categories.protein.offers;
 assert.equal(s.quality.errors.length,0);assert.equal(whey.testing.reports.length,1);assert.equal(whey.testing.currentBatchVerified,false);assert.equal(other.testing.reports.length,0);
 assert.equal(testingForOffer(s.testing,{...whey,brand:'Example Extra'}).reports.length,0);
 assert.equal(testingForOffer(s.testing,{...whey,category:'creatine'}).reports.length,0);
 const html=testingDetailsMarkup(whey);assert.match(html,/OLD-001/);assert.match(html,/retail batch have not been verified/);assert.match(html,/https:\/\/www.trustified.in/);
});
test('a failed sample triggers review and excludes ranking and automatic suggestions while retaining price and retests',()=>{
 const b=fixture();b.testing.reports[0].reportedStatus='failed';b.testing.reports[0].statusText='FAILED';b.testing.reports.push({...b.testing.reports[0],id:'retest',batch:'NEW-002',reportedStatus:'passed',statusText:'Passed',sourceUrl:'https://www.trustified.in/retestproducts/example'});b.testing.matches[0].reportIds.push('retest');
 const s=createSnapshot(b),r=s.categories.protein.offers[0];assert.equal(r.requiresProductReview,true);assert.equal(r.rankingEligible,false);assert.equal(r.price,1000);assert.equal(r.cost,1.25);assert.equal(r.testing.reports.length,2);assert.equal(rankedOffers(s.categories.protein).length,0);
 const policy={common:[{source:'offer',field:'requiresProductReview',op:'neq',value:true}],categories:{protein:[{source:'offer',field:'protein',op:'positive'}]}};
 assert.equal(offerMatchesProductPolicy(policy,'protein',r),false);
 assert.match(r.productReviewReason,/Current flavour, formula and retail batch/);
});
test('a passed sample never clears a separate formulation review flag or supplies unmeasured label amounts',()=>{
 const b=fixture();Object.assign(b.categories.protein.offers[0],{requiresProductReview:true,productReviewReason:'Added nutrients need overlap review.',protein:null});
 const r=createSnapshot(b).categories.protein.offers[0];assert.equal(r.requiresProductReview,true);assert.equal(r.productReviewReason,'Added nutrients need overlap review.');assert.equal(r.protein,null);assert.equal(r.cost,null);
});
test('a testing-ledger-only update refreshes the snapshot without redating prices or category labels',()=>{
 const b=fixture();b.testing.checked='2026-11-21';const s=createSnapshot(b);
 assert.deepEqual(s.quality.errors,[]);assert.equal(s.asOf,'2026-11-21');assert.equal(s.categories.protein.asOf,'2026-11-20');assert.equal(s.categories.protein.offers[0].priceAudit.checked,'2026-11-20');
});
test('data-only changes flow into report counts, catalog filters, source links and escaped HTML',()=>{
 const b=fixture(),s=createSnapshot(b);assert.equal(filterOffers(s.categories.protein.offers,{testing:'passed'}).length,1);assert.equal(filterOffers(s.categories.protein.offers,{testing:'unlinked'}).length,1);
 b.testing.reports[0].reportedStatus='expired';b.testing.reports[0].statusText='Expired';b.testing.reports[0].batch='<script>bad</script>';
 const next=createSnapshot(b);assert.equal(filterOffers(next.categories.protein.offers,{testing:'passed'}).length,0);assert.equal(filterOffers(next.categories.protein.offers,{testing:'expired'}).length,1);assert.equal(next.categories.protein.offers[0].testing.reviewRequired,false);
 assert.equal(filterTestingReports(next.testing.reports,{q:'concentrate',status:'expired'}).length,1);
 const html=testingAuditMarkup(next);assert.match(html,/&lt;script&gt;bad/);assert.doesNotMatch(html,/<script>bad/);assert.match(html,/brand=Example&amp;product=Whey/);assert.match(html,/Expired listing/);
});
test('bad provenance, future dates, unresolved products and invented raw test badges fail closed',()=>{
 for(const mutate of [b=>b.testing.reports[0].sourceUrl='https://unrelated.example/report',b=>b.testing.reports[0].publishedDate='2027-01-01',b=>b.testing.matches[0].products=['Unknown formula'],b=>b.testing.matches[0].reportIds=['missing'],b=>b.testing.matches[0].products={},b=>b.testing.matches[0].sourceIdentities=[{brand:'Unrelated',product:'Other'}],b=>b.testing.reports.push({...b.testing.reports[0]}),b=>b.testing.reports[0].catalogMatchEligible='false',b=>b.testing.reports[0].catalogMatchEligible=false,b=>b.testing.reports[0].reportPageAvailable='true',b=>b.testing.matches[0].sourceIdentities[0].sourceUrls=['https://www.trustified.in/passandfail/different-product']]){const b=fixture();mutate(b);assert.ok(createSnapshot(b).quality.errors.some(e=>e.field==='testing'));}
 const b=fixture();b.testing.matches=[];b.categories.protein.offers[0].testing={reports:[b.testing.reports[0]],currentBatchVerified:true};assert.equal(createSnapshot(b).categories.protein.offers[0].testing.reports.length,0);
});
test('published testing ledger resolves all curated product and report references',async()=>{
 const b=await loadBundle();if(!b.config.testingFile)return;assert.ok(b.testing?.reports.length);const s=createSnapshot(b);assert.deepEqual(s.quality.errors,[]);
 const errors=[];validateTestingEvidence(s.testing,s.categories,s.asOf,e=>errors.push(e));assert.deepEqual(errors,[]);
 assert.ok(s.testing.reports.some(r=>r.reportedStatus==='passed'));assert.ok(s.testing.reports.some(r=>r.reportedStatus==='failed'));assert.ok(s.testing.reports.some(r=>r.reportedStatus==='expired'));
 const offers=s.categories.protein.offers,osn=offers.filter(r=>r.brand==='One Science Nutrition');assert.ok(osn.length);assert.ok(osn.every(r=>!r.testing.reviewRequired));
 assert.ok(s.categories.magnesium.offers.filter(r=>r.brand==='HealthyHey').every(r=>!r.testing.reviewRequired));
 const one=s.categories.creatine.offers.find(r=>r.product==='AS-IT-IS ONE Creatine Monohydrate'),atom=s.categories.creatine.offers.find(r=>r.product==='AS-IT-IS ATOM Creatine Monohydrate');assert.ok(one.testing.reports.every(r=>r.sourceUrl.endsWith('/asitisonecreatine')));assert.ok(atom.testing.reports.every(r=>r.sourceUrl.endsWith('/asitis-atom-creatine')));
 const blend=offers.find(r=>r.product==='TrueBasics Clean Whey Protein Isolate + Concentrate'),isolate=offers.find(r=>r.product==='TrueBasics Clean Whey Protein Isolate');assert.ok(blend.testing.reports.every(r=>!r.sourceUrl.endsWith('/truebasiccleanisolate')));assert.ok(isolate.testing.reports.some(r=>r.sourceUrl.endsWith('/truebasiccleanisolate')));
});
test('historical index evidence links to the recorded sample when its detail URL now describes another batch',()=>{
 const b=fixture();Object.assign(b.testing.reports[0],{sourceIndexUrl:'https://www.trustified.in/proteinpowders',linkedDetailIdentity:{batch:'OTHER-002'}});
 const r=createSnapshot(b).categories.protein.offers[0],html=testingDetailsMarkup(r);assert.match(html,/Published index for this sample/);assert.match(html,/Current detail page \(different sample\)/);assert.match(html,/https:\/\/www.trustified.in\/proteinpowders/);
});
test('static publication exposes the full testing ledger, correct source hrefs, shared styles and compact pack references',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'supplement-testing-'));
 try{
  const {snapshot}=await buildSite(temp),html=await fs.readFile(path.join(temp,'audit.html'),'utf8');
  assert.match(html,/id="independent-testing"/);assert.match(html,/data-testing-filters/);assert.match(html,/doctor&#39;s-choice-eaa/);assert.doesNotMatch(html,/doctor&amp;#39;s-choice-eaa/);
  const stylesheet=html.match(/href="(marketplace\.css[^\"]*)"/)?.[1];assert.ok(stylesheet);const css=await fs.readFile(path.join(temp,stylesheet.split('?')[0]),'utf8');assert.match(css,/\.testing-counts\s*\{\s*display: grid/);
  const ledger=JSON.parse(await fs.readFile(path.join(temp,'data',snapshot.config.testingFile),'utf8'));assert.equal(ledger.reports.length,snapshot.testing.reports.length);
  const packs=JSON.parse(await fs.readFile(path.join(temp,'data/catalog.json'),'utf8')).offers;const linked=packs.find(r=>r.testing.reportIds.length);assert.ok(linked);assert.equal(linked.testing.reports,undefined);assert.equal(linked.testing.currentBatchVerified,false);
 }finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('supplement-testing-'));await fs.rm(temp,{recursive:true,force:true});}
});
