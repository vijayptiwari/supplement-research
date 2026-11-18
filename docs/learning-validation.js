import {editorialNarrativeWords,editorialCoverage} from './editorial-model.js';
// Publication rules for illustrated guides and the expandable editorial library.
export function validateLearningContent(research,categories,invalid){
 const text=v=>typeof v==='string'&&!!v.trim(),date=v=>text(v)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const sources=new Set(research.sources.map(s=>s.id)),validRefs=(ids,parent)=>Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>sources.has(id)&&(!parent||parent.includes(id)));
 const icons=new Set(['digest','blood','liver','kidney','muscle','cell','brain','energy','bone','molecule','signal','food']);
 if(research.articles.some(a=>a.pathway)&&!research.pathwayPolicy)invalid('Illustrated mechanisms require an explicit interpretation policy.');
 if(research.pathwayPolicy){
  if(!date(research.pathwayPolicy.reviewed)||!text(research.pathwayPolicy.summary))invalid('Pathway policy needs a review date and interpretation limits.');
  for(const a of research.articles){const p=a.pathway;
   if(!p||!text(p.title)||!text(p.summary)||!text(p.caveat)||!validRefs(p.sourceIds,a.sourceIds)||!Array.isArray(p.tracks)||p.tracks.length<1||p.tracks.length>3||p.tracks.some(t=>!text(t?.label)||(t.returnLabel!=null&&!text(t.returnLabel))||!Array.isArray(t.steps)||t.steps.length<3||t.steps.length>4||t.steps.some(s=>!text(s?.label)||!text(s.detail)||!text(s.compartment)||!icons.has(s.icon))))invalid(`Guide ${a.category} needs a sourced, readable illustrated pathway.`);
  }
 }
 const e=research.editorial;if(!e)return;
 const series=new Set(Array.isArray(e.series)?e.series.map(s=>s?.id):[]),ids=new Set();
 if(!date(e.reviewed)||!text(e.description)||!series.size||series.size!==e.series.length||e.series.some(s=>!text(s?.id)||!text(s.label)||!text(s.description))||!Array.isArray(e.articles)||!e.articles.length){invalid('Editorial library needs dated, described series and article data.');return;}
 for(const a of e.articles){
  const sourced=(row,keys)=>row&&keys.every(k=>text(row[k]))&&validRefs(row.sourceIds,a.sourceIds);
  if(!a||!text(a.id)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.id)||ids.has(a.id)||!categories[a.category]||!series.has(a.series)||!date(a.reviewed)||!['title','summary','author','intro'].every(k=>text(a[k]))||!validRefs(a.sourceIds)||!Array.isArray(a.sections)||!a.sections.length||new Set(a.sections.map(s=>s?.id)).size!==a.sections.length||a.sections.some(s=>!sourced(s,['id','title','body'])||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id)))invalid(`Invalid editorial article, series, section or citation: ${a?.id||'unknown'}.`);
  ids.add(a?.id);
  if(a?.relatedCategories!=null&&(!Array.isArray(a.relatedCategories)||new Set(a.relatedCategories).size!==a.relatedCategories.length||a.relatedCategories.some(id=>!categories[id]||id===a.category)))invalid(`Article ${a.id} needs unique, resolved related categories.`);
  if(a?.comparison!=null){const table=a.comparison,columns=table?.columns,rows=table?.rows;
   if(!text(table?.title)||!Array.isArray(columns)||columns.length<2||columns.length>6||new Set(columns.map(c=>c?.key)).size!==columns.length||columns.some(c=>!text(c?.label)||!text(c.key)||!/^[a-z][a-z0-9]*$/.test(c.key))||!Array.isArray(rows)||rows.length<2||rows.length>8||rows.some(row=>!text(row?.label)||!row.values||columns.some(c=>!text(row.values[c.key]))||!validRefs(row.sourceIds,a.sourceIds)))invalid(`Article ${a.id} needs a complete, sourced comparison overview.`);
  }
  if((a?.myths!=null||a?.series==='myth-busters')&&(!Array.isArray(a.myths)||(a.series==='myth-busters'&&a.myths.length!==10)||a.myths.some(m=>!sourced(m,['claim','verdict','explanation']))))invalid(`Myth article ${a.id} needs explained, individually cited claims and ten entries in the myth-busters series.`);
  if((a?.forms!=null||a?.series==='understanding-types')&&(!Array.isArray(a.forms)||(a.series==='understanding-types'&&!a.forms.length)||a.forms.some(f=>!sourced(f,['name','description','metabolism','evidence','value'])||!['ingredient','delivery'].includes(f.kind))))invalid(`Types article ${a.id} needs sourced ingredient and delivery comparisons.`);
 }
 if(e.coveragePolicy){const p=e.coveragePolicy;
  if(!text(p.summary)||!date(p.reviewed)||!Number.isInteger(p.minimumPrimaryArticles)||p.minimumPrimaryArticles<1||!Number.isInteger(p.maximumPrimaryArticles)||p.maximumPrimaryArticles<p.minimumPrimaryArticles||!Number.isInteger(p.minimumNarrativeWords)||p.minimumNarrativeWords<1)invalid('Editorial coverage policy needs dated context, article counts and a meaningful reading minimum.');
  else {
   for(const c of editorialCoverage(e,Object.values(categories)))if(c.primary<p.minimumPrimaryArticles||c.primary>p.maximumPrimaryArticles)invalid(`Editorial coverage for ${c.id} needs ${p.minimumPrimaryArticles}–${p.maximumPrimaryArticles} dedicated articles; related reading does not replace them.`);
   const titles=new Set();for(const a of e.articles){if(!a||!Array.isArray(a.sections))continue;const title=String(a.title).trim().toLowerCase();if(titles.has(title))invalid(`Editorial title is duplicated: ${a.id}.`);titles.add(title);if(editorialNarrativeWords(a)<p.minimumNarrativeWords)invalid(`Article ${a.id} is too brief for the editorial reading policy.`);}
  }
 }
}
