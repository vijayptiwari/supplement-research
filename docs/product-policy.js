// One declarative policy drives both candidate filtering and its public explanation.
const text=v=>typeof v==='string'&&v.trim().length>0;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const operators=new Set(['eq','neq','positive','startsWithCI','containsAnyCI','inputMaximum']);
const pathOK=path=>text(path)&&path.split('.').every(k=>/^[a-zA-Z][a-zA-Z0-9]*$/.test(k)&&!['constructor','prototype','__proto__'].includes(k));
const read=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
function evaluate(check,offer,input){
 const value=read(check.source==='input'?input:offer,check.field);
 switch(check.op){
  case 'eq':return value===check.value;
  case 'neq':return value!==check.value;
  case 'positive':return finite(value)&&value>0;
  case 'startsWithCI':return typeof value==='string'&&value.toLowerCase().startsWith(check.value.toLowerCase());
  case 'containsAnyCI':return typeof value==='string'&&check.value.some(term=>value.toLowerCase().includes(term.toLowerCase()));
  case 'inputMaximum':{
   const raw=input[check.value];if(raw==null||raw==='')return true;
   const maximum=Number(raw);return Number.isFinite(maximum)&&maximum>=0&&finite(value)&&value<=maximum;
  }
  default:return false;
 }
}
export function productChecksFor(policy,category){return policy?[...policy.common,...(policy.categories[category]||[])]:[];}
export function productCheckText(check,field){const value=Array.isArray(check.value)?check.value.join(', '):String(check.value??'');return String(check[field]||'').replaceAll('{value}',value);}
export function inspectProductChecks(policy,category,offer,input={}){
 return productChecksFor(policy,category).map(check=>({...check,applies:!check.when||evaluate(check.when,offer,input),passed:(!check.when||evaluate(check.when,offer,input))?evaluate(check,offer,input):null}));
}
export function offerMatchesProductPolicy(policy,category,offer,input={}){
 // An educational category cannot acquire product suggestions through an empty check list.
 if(!policy?.categories?.[category]?.length)return false;
 return inspectProductChecks(policy,category,offer,input).every(c=>!c.applies||c.passed);
}
export function validateProductPolicy(recommender,categories,invalid){
 const p=recommender.productPolicy;if(!p){if(recommender.schemaVersion>=2)invalid('Product recommendations need their shared public selection policy.');return;}
 const scalar=v=>['string','number','boolean'].includes(typeof v)&&(typeof v!=='number'||finite(v));
 const valid=(c,nested=false)=>c&&['offer','input'].includes(c.source)&&pathOK(c.field)&&operators.has(c.op)&&(c.op==='positive'||(c.op==='containsAnyCI'?Array.isArray(c.value)&&c.value.length>0&&c.value.every(text):['startsWithCI','inputMaximum'].includes(c.op)?text(c.value):scalar(c.value)))&&(nested?!c.when:text(c.id)&&text(c.label)&&text(c.detail)&&(!c.when||valid(c.when,true)));
 if(!text(p.summary)||!text(p.limitations)||!text(p.orderNote)||!Array.isArray(p.common)||!p.common.length||!p.categories||typeof p.categories!=='object'||Array.isArray(p.categories)){invalid('Invalid shared product selection policy.');return;}
 const checks=[...p.common];
 for(const [category,rows] of Object.entries(p.categories)){if(!categories[category]||!Array.isArray(rows)||!rows.length){invalid('Product checks need a valid category and at least one criterion.');continue;}checks.push(...rows);}
 if(checks.some(c=>!valid(c))||new Set(checks.map(c=>c?.id)).size!==checks.length)invalid('Product selection checks need unique IDs, safe fields, supported operators and clear public explanations.');
 for(const rule of Array.isArray(recommender.rules)?recommender.rules:[])if(!rule.review&&!p.categories[rule.category]?.length)invalid('An automatic shortlist category needs explicit shared selection checks.');
}
