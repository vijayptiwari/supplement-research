import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cleanBatchNumber,normalizeTrustifiedReports,buildTestingLedger} from '../scripts/import_trustified_reports.mjs';

const source='https://www.trustified.in/passandfail/example';
const report=(patch={})=>({id:'raw',sourceUrl:source,sourceIndexUrl:'https://www.trustified.in/passandfail',sourceIndexUrls:['https://www.trustified.in/passandfail'],brand:'Example',product:'Whey',category:'protein',batch:'LOT-001',publishedDate:null,publishedDateText:'',manufacturedText:'',expiresText:'',testedBy:'Eurofins',reportedStatus:'failed',statusText:'FAILED',reportUrls:[],listingObservations:[],catalogMatchEligible:true,reportPageAvailable:true,notes:'',...patch});
test('adjacent test, manufacture and expiry text is separated from the actual batch',()=>{
 const raw=report({batch:'LOT-001 Mfd Date 01/2023 Best Before 07/2024 Date Tested 18 Feb 2023'}),[r]=normalizeTrustifiedReports([raw]);
 assert.equal(r.batch,'LOT-001');assert.equal(r.batchText,raw.batch);assert.equal(r.manufacturedText,'01/2023');assert.equal(r.expiresText,'07/2024');assert.deepEqual(r.testedDateTexts,['18 Feb 2023']);assert.equal(r.publishedDate,null);assert.equal(r.publishedDateText,'');
 assert.equal(r.id,'trustified-'+createHash('sha256').update(source+'|LOT-001').digest('hex').slice(0,16));assert.deepEqual(r.sourceObservations[0],raw);
 assert.equal(cleanBatchNumber(' LOT-001 Date Tested 3 march 2023 '),'LOT-001');assert.equal(cleanBatchNumber(null),null);
});
test('expiry text and linked-detail batch also lose neighboring test labels without losing their raw text',()=>{
 const raw=report({expiresText:'06/24 Date Tested 03 Feb 2023',linkedDetailIdentity:{product:'Whey',batch:'LOT-001 Date Tested 03 Feb 2023'}}),[r]=normalizeTrustifiedReports([raw]);
 assert.equal(r.expiresText,'06/24');assert.deepEqual(r.testedDateTexts,['03 Feb 2023']);assert.equal(r.linkedDetailIdentity.batch,'LOT-001');assert.equal(r.linkedDetailIdentity.batchText,'LOT-001 Date Tested 03 Feb 2023');assert.equal(r.sourceObservations[0].expiresText,raw.expiresText);
});
test('one URL and clean batch consolidate duplicate rows while preserving contradictory test dates and evidence',()=>{
 const detail=report({id:'detail',reportUrls:['https://static.wixstatic.com/report.jpg'],expiresText:'06/24 Date Tested 03 Feb 2023',linkedDetailIdentity:{product:'Whey',batch:'LOT-001'}}),first=report({id:'index1',batch:'LOT-001 Date Tested 03 Feb 2023',listingObservations:[{sourceIndexUrl:'https://www.trustified.in/passandfail',batch:'LOT-001 Date Tested 03 Feb 2023'}]}),second=report({id:'index2',batch:'LOT-001 Date Tested 3 march 2023',sourceIndexUrl:'https://www.trustified.in/proteinpowders',listingObservations:[{sourceIndexUrl:'https://www.trustified.in/proteinpowders',batch:'LOT-001 Date Tested 3 march 2023'}]});
 const result=normalizeTrustifiedReports([first,second,detail]);assert.equal(result.length,1);const [r]=result;
 assert.equal(r.batch,'LOT-001');assert.equal(r.reportedStatus,'failed');assert.equal(r.listingObservations.length,2);assert.equal(r.sourceObservations.length,3);assert.equal(r.reportUrls.length,1);assert.deepEqual(new Set(r.testedDateTexts),new Set(['03 Feb 2023','3 march 2023']));assert.equal(r.publishedDate,null);assert.match(r.notes,/test-date text differs/);
 assert.deepEqual(normalizeTrustifiedReports(result),result);
 assert.equal(normalizeTrustifiedReports([report({batch:'LOT-001'}),report({batch:'LOT-002'})]).length,2);
});
test('whitespace/case cleanup has stable IDs and never merges separate source URLs',()=>{
 const [a]=normalizeTrustifiedReports([report({batch:' Lot 001 '})]),[b]=normalizeTrustifiedReports([report({batch:'LOT001'})]);assert.equal(a.id,b.id);
 assert.equal(normalizeTrustifiedReports([report(),report({sourceUrl:source+'-retest'})]).length,2);
});
test('source identity disagreements block catalog matching and explicit ineligibility survives consolidation',()=>{
 const [conflict]=normalizeTrustifiedReports([report(),report({id:'other',product:'Isolate',batch:'LOT-001 Date Tested 03 Feb 2023'})]);assert.equal(conflict.catalogMatchEligible,false);assert.match(conflict.catalogMatchIneligibleReason,/disagree/);assert.ok(conflict.metadataConflicts.some(c=>c.field==='product'));
 const [blocked]=normalizeTrustifiedReports([report(),report({catalogMatchEligible:false,catalogMatchIneligibleReason:'Contradictory source heading.'})]);assert.equal(blocked.catalogMatchEligible,false);assert.match(blocked.catalogMatchIneligibleReason,/Contradictory/);
});
test('contradictory statuses are retained and a published failure cannot turn into a clean pass',()=>{
 const [r]=normalizeTrustifiedReports([report({reportedStatus:'passed',statusText:'Passed'}),report()]);assert.equal(r.reportedStatus,'failed');assert.deepEqual(new Set(r.reportedStatuses),new Set(['passed','failed']));assert.match(r.statusText,/Conflicting/);assert.ok(r.metadataConflicts.some(c=>c.field==='reportedStatus'));
 const [uncertain]=normalizeTrustifiedReports([report({reportedStatus:'passed',statusText:'Passed'}),report({reportedStatus:'expired',statusText:'Expired'})]);assert.equal(uncertain.reportedStatus,'unknown');
});
test('source URL allowlists distinguish same-named lines from one brand',()=>{
 const one=source+'-one',atom=source+'-atom',harvest={checked:'2026-11-20',reports:[report({sourceUrl:one}),report({sourceUrl:atom})]},categories={protein:{offers:[{brand:'Example',product:'ATOM Whey'}]}},rules={matches:[{id:'atom',category:'protein',brand:'Example',products:['ATOM Whey'],sourceIdentities:[{brand:'Example',product:'Whey',sourceUrls:[atom]}],matchBasis:'Named ATOM source URL only.'}]};
 const ledger=buildTestingLedger(harvest,rules,categories);assert.equal(ledger.matches[0].reportIds.length,1);assert.equal(ledger.reports.find(r=>r.id===ledger.matches[0].reportIds[0]).sourceUrl,atom);
});
test('normalization cannot erase malformed batch or ambiguity-control values',()=>{
 for(const patch of [{batch:123},{catalogMatchEligible:'false'},{reportPageAvailable:'false'}])assert.throws(()=>normalizeTrustifiedReports([report(patch)]));
});
