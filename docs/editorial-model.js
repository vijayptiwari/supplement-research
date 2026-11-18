// Data-only editorial helpers shared by publication validation and the reader.
const rows=value=>Array.isArray(value)?value:[];
export const editorialCategories=article=>[...new Set([article?.category,...rows(article?.relatedCategories)].filter(id=>typeof id==='string'))];
export function editorialNarrativeText(article){
 return [article?.intro,...rows(article?.sections).flatMap(s=>[s?.title,s?.body]),...rows(article?.myths).flatMap(m=>[m?.claim,m?.verdict,m?.explanation]),...rows(article?.forms).flatMap(f=>[f?.name,f?.description,f?.metabolism,f?.evidence,f?.value])].filter(v=>typeof v==='string').join(' ');
}
export const editorialNarrativeWords=article=>editorialNarrativeText(article).trim().split(/\s+/).filter(Boolean).length;
export function editorialCoverage(editorial,categories){
 return categories.map(c=>{const primary=rows(editorial?.articles).filter(a=>a?.category===c.id).length,total=rows(editorial?.articles).filter(a=>editorialCategories(a).includes(c.id)).length;return {id:c.id,label:c.label,primary,related:total-primary,total};});
}
