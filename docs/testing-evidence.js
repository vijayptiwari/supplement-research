// Published laboratory evidence is scoped to a reported sample, never a whole brand.
// This module has no model imports so validation and rendering use the same rules.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=s=>typeof s==='string'&&Boolean(s.trim());
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const https=s=>{try{return new URL(s).protocol==='https:';}catch{return false;}};
const trustified=s=>https(s)&&['trustified.in','www.trustified.in'].includes(new URL(s).hostname);
export const testingStatusLabels={passed:'Passed sample reported',failed:'Failed sample reported',expired:'Expired listing',unknown:'Status not established'};
const link=(url,label)=>https(url)?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';
const sameBatch=(a,b)=>String(a||'').replace(/\s+/g,'').toLowerCase()===String(b||'').replace(/\s+/g,'').toLowerCase();
const detailHasOtherBatch=r=>Boolean(r.batch&&r.linkedDetailIdentity?.batch&&!sameBatch(r.batch,r.linkedDetailIdentity.batch));
const reportSource=r=>{
 if(trustified(r.sourceIndexUrl)&&r.reportPageAvailable===false)return link(r.sourceIndexUrl,'Published index (report page unavailable)');
 if(trustified(r.sourceIndexUrl)&&detailHasOtherBatch(r))return link(r.sourceIndexUrl,'Published index for this sample')+'<small>'+link(r.sourceUrl,'Current detail page (different sample)')+'</small>';
 return link(r.sourceUrl,'Trustified source');
};

export function validateTestingEvidence(ledger,categories,asOf,invalid){
 if(ledger==null)return;
 if(ledger.schemaVersion!==1||!date(ledger.checked)||ledger.checked>asOf||!text(ledger.scope)||!Array.isArray(ledger.reports)||!Array.isArray(ledger.matches)){invalid('Testing evidence needs schema version 1, a non-future check date, scope, reports and curated matches.');return;}
 const ids=new Set();
 for(const r of ledger.reports){
  if(!text(r?.id)||ids.has(r.id)||!text(r.brand)||!text(r.product)||!Object.hasOwn(testingStatusLabels,r.reportedStatus)||!trustified(r.sourceUrl)||!text(r.statusText)||!Array.isArray(r.reportUrls)||r.reportUrls.some(u=>!https(u))||r.publishedDate!=null&&(!date(r.publishedDate)||r.publishedDate>ledger.checked)||r.batch!=null&&!text(r.batch))invalid('Each testing record needs a unique ID, source product and brand, reported status, Trustified source, valid report links and a valid date/batch when known.');
  ids.add(r?.id);
  if(r?.catalogMatchEligible!==undefined&&typeof r.catalogMatchEligible!=='boolean'||r?.catalogMatchEligible===false&&!text(r.catalogMatchIneligibleReason)||r?.reportPageAvailable!==undefined&&typeof r.reportPageAvailable!=='boolean')invalid('Testing eligibility and page availability flags must be booleans; blocked catalog matches require a reason.');
 }
 const matchIds=new Set(),pairs=new Set(),byId=new Map(ledger.reports.filter(Boolean).map(r=>[r.id,r]));
 for(const m of ledger.matches){
  const offers=categories[m?.category]?.offers||[],products=m?.products;
  if(!text(m?.id)||matchIds.has(m.id)||!text(m.brand)||!Array.isArray(products)||!products.length||new Set(products).size!==products.length||products.some(p=>!text(p)||!offers.some(r=>r.brand===m.brand&&r.product===p))||m.relation!=='product-line'||!text(m.matchBasis)||!Array.isArray(m.reportIds)||!m.reportIds.length||new Set(m.reportIds).size!==m.reportIds.length||m.reportIds.some(id=>!ids.has(id))){invalid('Test matches require existing exact category/brand/product names, unique report references, product-line scope and an explicit match basis.');continue;}
  // Bind report IDs to explicitly reviewed source identities. A new report ID
  // cannot silently transfer a verdict from an unrelated source product.
  const identityMatches=(s,r)=>s?.brand===r?.brand&&s?.product===r?.product&&(!s.sourceUrls||Array.isArray(s.sourceUrls)&&s.sourceUrls.includes(r.sourceUrl));
  if(!Array.isArray(m.sourceIdentities)||!m.sourceIdentities.length||m.sourceIdentities.some(s=>!text(s?.brand)||!text(s.product)||s.sourceUrls!==undefined&&(!Array.isArray(s.sourceUrls)||!s.sourceUrls.length||s.sourceUrls.some(u=>!trustified(u))))||m.reportIds.some(id=>{const r=byId.get(id);return !r||r.catalogMatchEligible===false||r.category&&r.category!==m.category||!m.sourceIdentities.some(s=>identityMatches(s,r));})||m.sourceIdentities.some(s=>!m.reportIds.some(id=>identityMatches(s,byId.get(id)))))invalid('Each curated match must bind every report ID to its reviewed exact source brand/product identity in the same category.');
  for(const p of products){const key=JSON.stringify([m.category,m.brand,p]);if(pairs.has(key))invalid('A product line can have only one curated testing match; retain all reports in that match.');pairs.add(key);}
  matchIds.add(m?.id);
 }
}

export function testingForOffer(ledger,r){
 const matches=(Array.isArray(ledger?.matches)?ledger.matches:[]).filter(m=>m?.category===r.category&&m.brand===r.brand&&Array.isArray(m.products)&&m.products.includes(r.product));
 const ids=new Set(matches.flatMap(m=>m.reportIds||[])),reports=(Array.isArray(ledger?.reports)?ledger.reports:[]).filter(t=>t&&ids.has(t.id));
 return {reports,matches,currentBatchVerified:false,reviewRequired:reports.some(t=>t.reportedStatus==='failed')};
}
export function testingFilterMatches(r,status){
 const reports=r.testing?.reports||[];
 if(!status)return true;
 if(status==='unlinked')return !reports.length;
 if(status==='linked')return Boolean(reports.length);
 return reports.some(t=>t.reportedStatus===status);
}
export function testingBadge(r){
 const reports=r.testing?.reports||[];if(!reports.length)return '';
 const status=reports.some(t=>t.reportedStatus==='failed')?'failed':reports.some(t=>t.reportedStatus==='passed')?'passed':reports.some(t=>t.reportedStatus==='expired')?'expired':'unknown';
 return `<div class="testing-badge testing-${status}"><strong>${esc(testingStatusLabels[status])}</strong><small>Trustified · current retail batch unverified</small></div>`;
}
function reportFacts(r){
 return `<dl class="testing-report-facts">${[['Tested batch',r.batch||'Not stated'],['Published',r.publishedDate||r.publishedDateText||'Not stated'],['Laboratory named',r.testedBy||'Not stated'],['Source listing status',r.statusText],...(r.testedDateTexts?.length?[['Source test date (not publication)',r.testedDateTexts.join(' / ')]]:[]),...(r.certifiedDateText?[['Source certification date',r.certifiedDateText]]:[]),['Manufacture / expiry as reported',[r.manufacturedText,r.expiresText].filter(Boolean).join(' / ')||'Not stated']].map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
export function testingDetailsMarkup(r){
 const evidence=r.testing;if(!evidence?.reports.length)return '';
 return `<section class="method-card testing-detail"><span class="section-kicker">INDEPENDENT TEST EVIDENCE</span><h3>What was actually tested?</h3><p>These reports relate to the linked product line. The offered flavour, formula and retail batch have not been verified against the tested sample. A passed sample is not certification of this pack or every product from the brand.</p>${evidence.matches.map(m=>`<p class="hint">Match basis: ${esc(m.matchBasis)}</p>`).join('')}${evidence.reports.map(t=>`<article class="testing-report"><h4>${esc(t.brand)} · ${esc(t.product)}</h4><p class="testing-status testing-${esc(t.reportedStatus)}">${esc(testingStatusLabels[t.reportedStatus])}</p>${reportFacts(t)}<p>${reportSource(t)}${t.reportUrls.map((u,i)=>' · '+link(u,`Report / evidence ${i+1}`)).join('')}</p>${t.notes?`<p class="hint">${esc(t.notes)}</p>`:''}</article>`).join('')}<p>“Expired” describes the source listing status; it does not by itself establish that an offered pack has expired. Reports are attributed to the source; we have not independently retested these products.</p><a href="audit.html#independent-testing">Search all published test records →</a></section>`;
}

export function filterTestingReports(reports,{q='',brand='',status='',category=''}={}){
 const term=q.trim().toLowerCase();
 return reports.filter(r=>(!brand||r.brand===brand)&&(!status||r.reportedStatus===status)&&(!category||r.category===category)&&(!term||[r.brand,r.product,r.batch,r.testedBy,r.statusText,r.publishedDateText].join(' ').toLowerCase().includes(term)));
}
function reportTable(reports,snapshot){
 const matches=snapshot.testing?.matches||[];
 return `<div class="table-wrap testing-table"><table><caption>Trustified’s reported results and tested batches</caption><thead><tr><th scope="col">Product tested</th><th scope="col">Reported result</th><th scope="col">Batch &amp; publication</th><th scope="col">Evidence &amp; catalog</th></tr></thead><tbody>${reports.map(r=>{
  const mapped=matches.filter(m=>m.reportIds.includes(r.id));
  const targets=[...new Map(mapped.flatMap(m=>m.products.map(product=>{const c=snapshot.categories[m.category],p=new URLSearchParams({brand:m.brand,product});return [m.category+product,{href:c.page+'?'+p,label:m.brand+' · '+product}];}))).values()];
  return `<tr><th scope="row"><strong>${esc(r.brand)}</strong><div>${esc(r.product)}</div><small>${esc(snapshot.categories[r.category]?.label||r.category||'Other supplement')}</small></th><td><span class="testing-status testing-${esc(r.reportedStatus)}">${esc(testingStatusLabels[r.reportedStatus])}</span><small>${esc(r.statusText)}</small></td><td><strong>${esc(r.batch||'Batch not stated')}</strong><div>${esc(r.publishedDate||r.publishedDateText||'Publication date not stated')}</div><small>${esc(r.testedBy||'Laboratory not stated')}</small></td><td>${reportSource(r)}${r.reportUrls.length?'<div>'+r.reportUrls.map((u,i)=>link(u,`Report / evidence ${i+1}`)).join(' · ')+'</div>':''}${targets.length?`<details><summary>${targets.length} linked catalog ${targets.length===1?'line':'lines'}</summary>${targets.map(t=>`<p><a href="${esc(t.href)}">${esc(t.label)} →</a></p>`).join('')}<small>Product-line link; retail batch unverified.</small></details>`:'<small>No curated catalog match</small>'}${r.notes?`<details><summary>Scope notes</summary><p>${esc(r.notes)}</p></details>`:''}</td></tr>`;
 }).join('')}</tbody></table></div>`;
}
export function testingAuditMarkup(snapshot){
 const ledger=snapshot.testing;if(!ledger)return '';
 const reports=ledger.reports,brands=[...new Set(reports.map(r=>r.brand))].sort(),linked=Object.values(snapshot.categories).flatMap(c=>c.offers).filter(r=>r.testing?.reports.length).length;
 const counts=Object.entries(testingStatusLabels).map(([status,label])=>[reports.filter(r=>r.reportedStatus===status).length,label]);
 const option=(value,label)=>`<option value="${esc(value)}">${esc(label)}</option>`;
 return `<section id="independent-testing" class="method-card testing-audit"><header><span class="section-kicker">TRUSTIFIED · PUBLIC TEST RECORDS</span><h2>Check the sample. Then judge the product.</h2><p>${esc(ledger.scope)}</p><p>Reviewed ${esc(ledger.checked)} · ${reports.length} records · ${brands.length} source brand names · ${linked} catalog pack entries linked at product-line level.</p><p class="hint">Counts describe source records. Retests, certification pages and aliases can refer to the same sample; these are not counts of distinct laboratory tests.</p></header><div class="testing-counts">${counts.map(([n,label])=>`<div><strong>${n}</strong><span>${esc(label)}</span></div>`).join('')}</div><div class="testing-scope"><strong>Results belong to tested samples.</strong><p>A passing result does not verify today’s retail batch or other products from the brand. Failed-sample records remain visible alongside retests; linked product lines require review before an automatic stack suggestion. “Expired” is the source’s listing status. It is not a verdict on current retail stock.</p></div><form class="testing-filters" data-testing-filters role="search" aria-label="Filter published testing evidence"><label>Search products or batch<input name="q" type="search" placeholder="Product, brand or batch number"></label><label>Brand<select name="brand"><option value="">All source brands</option>${brands.map(b=>option(b,b)).join('')}</select></label><label>Reported status<select name="status"><option value="">All results</option>${Object.entries(testingStatusLabels).map(([s,l])=>option(s,l)).join('')}</select></label><label>Supplement<select name="category"><option value="">All categories</option>${[...new Set(reports.map(r=>r.category).filter(Boolean))].sort().map(id=>option(id,snapshot.categories[id]?.label||id)).join('')}</select></label><button type="reset" class="btn-sm">Reset</button></form><p data-testing-count role="status">${reports.length} published records</p><div data-testing-results>${reportTable(reports,snapshot)}</div><div class="testing-pagination" data-testing-pagination></div><p class="hint">Brand names and result labels are reproduced from Trustified’s listings. Listing / index snapshots can differ from a later report page; scope notes retain those differences. No missing report values have been inferred.</p><p><a href="data/${esc(snapshot.config.testingFile)}" download>Download the dated testing ledger →</a> · ${link('https://www.trustified.in/passandfail','Trustified product directory')}</p></section>`;
}
export function activateTestingAudit(snapshot,root,previous={}){
 const form=root?.querySelector('[data-testing-filters]');if(!form)return;
 for(const [key,value] of Object.entries(previous))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value;
 let page=1;const pageSize=30;
 const render=()=>{
  const state=Object.fromEntries(new FormData(form)),reports=filterTestingReports(snapshot.testing.reports,state),pages=Math.max(1,Math.ceil(reports.length/pageSize));page=Math.min(page,pages);
  root.querySelector('[data-testing-count]').textContent=`${reports.length} matching records · page ${page} of ${pages}`;
  root.querySelector('[data-testing-results]').innerHTML=reports.length?reportTable(reports.slice((page-1)*pageSize,page*pageSize),snapshot):'<p>No published records match these filters.</p>';
  const nav=root.querySelector('[data-testing-pagination]');nav.innerHTML=`<button type="button" class="btn-sm" data-test-prev ${page===1?'disabled':''}>Previous</button><span>Page ${page} of ${pages}</span><button type="button" class="btn-sm" data-test-next ${page===pages?'disabled':''}>Next</button>`;
  nav.querySelector('[data-test-prev]').onclick=()=>{page--;render();};nav.querySelector('[data-test-next]').onclick=()=>{page++;render();};
 };
 form.onsubmit=e=>{e.preventDefault();page=1;render();};form.oninput=()=>{page=1;render();};form.onreset=()=>queueMicrotask(()=>{page=1;render();});render();
}
