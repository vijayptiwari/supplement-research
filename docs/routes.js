// Published reading URLs stay at the site root, including on GitHub project Pages.
export const articleHref=id=>'article-'+encodeURIComponent(id)+'.html';
export const guideHref=id=>'guide-'+encodeURIComponent(id)+'.html';
const pathId=(pathname,prefix)=>String(pathname||'').split('/').pop()?.match(new RegExp('^'+prefix+'-([a-z0-9]+(?:-[a-z0-9]+)*)\\.html$'))?.[1]||'';
export const articleIdForLocation=(location,fallback='')=>pathId(location.pathname,'article')||fallback||new URLSearchParams(location.search).get('article')||'';
export const guideIdForLocation=(location,fallback='')=>pathId(location.pathname,'guide')||new URLSearchParams(location.search).get('category')||fallback||'';
export function canonicalContentHref(value,snapshot){
 if(typeof value!=='string'||value.startsWith('#'))return value;
 let url;try{url=new URL(value,snapshot.config.baseUrl);}catch{return value;}
 if(url.origin!==new URL(snapshot.config.baseUrl).origin)return value;
 const name=url.pathname.split('/').pop(),params=url.searchParams;
 if(name==='articles.html'&&snapshot.research.editorial?.articles.some(a=>a.id===params.get('article'))){const path=articleHref(params.get('article'));params.delete('article');return path+(params.size?'?'+params:'')+url.hash;}
 if(name==='research.html'&&snapshot.categories[params.get('category')]){const path=guideHref(params.get('category'));params.delete('category');return path+(params.size?'?'+params:'')+url.hash;}
 const category=Object.values(snapshot.categories).find(c=>c.educationOnly&&c.page===name);
 return category?guideHref(category.id)+url.search+url.hash:value;
}
export function legacyContentTarget(snapshot,location){
 const name=String(location.pathname).split('/').pop();
 if(!['articles.html','research.html',...Object.values(snapshot.categories).filter(c=>c.educationOnly).map(c=>c.page)].includes(name))return null;
 const old=name+(location.search||'')+(location.hash||''),next=canonicalContentHref(old,snapshot);
 return next!==old?next:null;
}
