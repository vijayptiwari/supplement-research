import {pageMetadata} from './model.js';
import {editorialNarrativeWords} from './editorial-model.js';
import {articleHref,guideHref,articleIdForLocation,guideIdForLocation} from './routes.js';

const absolute=(snapshot,path='')=>new URL(path,snapshot.config.baseUrl).href;
const excerpt=(text,length=170)=>{const value=String(text||'').trim();return value.length<=length?value:value.slice(0,length-1).replace(/\s+\S*$/,'')+'…';};
export function contentMetadata(snapshot,{kind='',id='',query=''}={}){
 const base=snapshot.config.baseUrl,name=snapshot.config.name,params=new URLSearchParams(query),article=kind==='article'&&snapshot.research.editorial?.articles.find(a=>a.id===id),guide=kind==='guide'&&snapshot.research.articles.find(a=>a.category===id);
 let metadata=pageMetadata(snapshot,['article','directory','policy','not-found'].includes(kind)?'articles':kind==='guide'?'research':kind),path=kind&&snapshot.categories[kind]?.page||({research:'research.html',articles:'articles.html',directory:'library.html',policy:'editorial-policy.html',search:'search.html',recommender:'recommender.html',audit:'audit.html','not-found':'404.html'}[kind]||'');
 let type='website',robots=kind==='search'||kind==='not-found'?'noindex,follow':'index,follow,max-image-preview:large';
 const organization={'@type':'Organization','@id':base+'#organization',name,url:base};
 const breadcrumbs=[{name:'Home',url:base}];
 if(article){
  path=articleHref(article.id);type='article';metadata={title:article.title+' · '+name,description:excerpt(article.summary),structured:{'@type':'Article',headline:article.title,description:article.summary,dateModified:article.reviewed,author:{'@type':'Organization',name:article.author,url:absolute(snapshot,'editorial-policy.html')},publisher:{'@id':organization['@id']},inLanguage:'en-IN',articleSection:snapshot.research.editorial.series.find(s=>s.id===article.series)?.label,wordCount:editorialNarrativeWords(article),citation:article.sourceIds.map(id=>snapshot.research.sources.find(s=>s.id===id)?.url).filter(Boolean)}};
  if(article.published)metadata.structured.datePublished=article.published;
  breadcrumbs.push({name:'Articles',url:absolute(snapshot,'articles.html')},{name:article.title,url:absolute(snapshot,path)});
 }else if(guide){
  path=guideHref(guide.category);type='article';metadata={title:snapshot.categories[guide.category].label+': benefits, evidence & buying guide · '+name,description:excerpt(guide.summary),structured:{'@type':'Article',headline:guide.title,description:guide.summary,dateModified:guide.reviewed,author:{'@type':'Organization',name:guide.author,url:absolute(snapshot,'editorial-policy.html')},publisher:{'@id':organization['@id']},inLanguage:'en-IN',citation:guide.sourceIds.map(id=>snapshot.research.sources.find(s=>s.id===id)?.url).filter(Boolean)}};
  breadcrumbs.push({name:'Supplement guides',url:absolute(snapshot,'research.html')},{name:snapshot.categories[guide.category].label,url:absolute(snapshot,path)});
 }else if(kind==='directory')metadata={title:'All supplement articles by topic · '+name,description:`Browse ${snapshot.research.editorial.articles.length} cited articles across ${snapshot.config.categories.length} supplement categories: forms, evidence, comparisons and practical decisions.`,structured:{'@type':'CollectionPage',name:'All supplement articles by topic',mainEntity:{'@type':'ItemList',numberOfItems:snapshot.research.editorial.articles.length,itemListElement:snapshot.research.editorial.articles.map((a,i)=>({'@type':'ListItem',position:i+1,url:absolute(snapshot,articleHref(a.id)),name:a.title}))}}};
 else if(kind==='not-found')metadata={title:'Page not found · '+name,description:'Find current supplement evidence guides, cited articles and product data in the complete reading index.',structured:{'@type':'WebPage',name:'Page not found'}};
 else if(kind==='policy')metadata={title:'Editorial policy, sources & corrections · '+name,description:'How Supplement Research compiles public evidence, discloses limitations, checks product data and handles corrections.',structured:{'@type':'AboutPage',name:'Editorial policy, sources and corrections'}};
 else if(!kind)metadata={...metadata,structured:{'@type':'WebSite','@id':base+'#website',name,url:base,description:metadata.description,inLanguage:'en-IN',publisher:{'@id':organization['@id']}}};
 else if(kind==='articles'||kind==='research')metadata={...metadata,structured:{...metadata.structured,'@type':'CollectionPage'}};
 if((['articles','research','article','guide'].includes(kind)&&params.size)||(['article','guide'].includes(kind)&&(!article&&!guide)))robots='noindex,follow';
 // Product filters retain the base catalog canonical; search/filter variants are not index targets.
 if(snapshot.categories[kind]&&params.size)robots='noindex,follow';
 const canonical=absolute(snapshot,path),structured={...metadata.structured,'@context':'https://schema.org','@id':metadata.structured['@id']||canonical+'#page',url:canonical};
 if(type==='article')structured.mainEntityOfPage={'@type':'WebPage','@id':canonical};
 const graph=[organization,structured];
 if(breadcrumbs.length>1)graph.push({'@type':'BreadcrumbList',itemListElement:breadcrumbs.map((b,i)=>({'@type':'ListItem',position:i+1,name:b.name,item:b.url}))});
 return {...metadata,description:excerpt(metadata.description),canonical,robots,type,image:absolute(snapshot,'assets/social-card.png'),structured:{'@context':'https://schema.org','@graph':graph}};
}

export function metadataForLocation(snapshot,location,body={}){
 const page=body.page||'',articleId=page==='articles'&&articleIdForLocation(location),category=page==='research'&&guideIdForLocation(location);
 return contentMetadata(snapshot,{kind:articleId?'article':category?'guide':page||body.category||'',id:articleId||category||'',query:location.search});
}

export function applyContentMetadata(metadata){
 document.title=metadata.title;
 const setMeta=(attribute,key,value)=>{let element=document.head.querySelector(`meta[${attribute}="${key}"]`);if(!element){element=document.createElement('meta');element.setAttribute(attribute,key);document.head.append(element);}element.content=value;};
 for(const [key,value] of Object.entries({description:metadata.description,robots:metadata.robots,'twitter:card':'summary_large_image','twitter:title':metadata.title,'twitter:description':metadata.description,'twitter:image':metadata.image,'twitter:image:alt':'Supplement Research: evidence, ingredients and informed choices'}))setMeta('name',key,value);
 for(const [key,value] of Object.entries({'og:title':metadata.title,'og:description':metadata.description,'og:url':metadata.canonical,'og:type':metadata.type,'og:image':metadata.image,'og:image:width':'1200','og:image:height':'630','og:image:alt':'Supplement Research: evidence, ingredients and informed choices'}))setMeta('property',key,value);
 let canonical=document.head.querySelector('link[rel="canonical"]');if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';document.head.append(canonical);}canonical.href=metadata.canonical;
 let structured=document.head.querySelector('script[type="application/ld+json"]');if(!structured){structured=document.createElement('script');structured.type='application/ld+json';document.head.append(structured);}structured.textContent=JSON.stringify(metadata.structured);
}
