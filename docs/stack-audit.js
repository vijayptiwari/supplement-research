import {articleHref} from './routes.js';
import {escapeHtml as esc} from './model.js';
import {nutrientUnits} from './units.js';
import {buyingAudience,buyingFoods,buyingValue,buyingPractices,buyingQuality,productSelectionMarkup} from './guidance.js';
import {intakeMarkup,medicalMarkup,matchingReferences} from './intake.js';

const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=n=>finite(n)&&n>0;
const number=n=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(n);
export const dailyQuantityUnit=offer=>offer.isUnitOffer&&offer.form!=='Powder'?'units':'g';
export const stackPackLabel=r=>dailyQuantityUnit(r)==='g'?`${r.grams??'Unknown'} g`:`${r.packCount??'Unknown'} ${r.form}`;
export function stackCategoryMarkup(snapshot,category,context,{restricted=false}={}){
 const a=snapshot.research?.articles.find(a=>a.category===category);if(!a)return '';
 const refs=new Map(snapshot.research.sources.map(s=>[s.id,s])),related=(snapshot.research.editorial?.articles||[]).filter(a=>a.category===category||a.relatedCategories?.includes(category));
 return `<div class="stack-category-knowledge"><details><summary>Who it suits &amp; purchase priority</summary>${buyingAudience(a.buyingGuide,refs)}${buyingValue(a.buyingGuide,snapshot.research.valuePolicy,refs)}</details><details><summary>Food alternatives &amp; quantities</summary>${buyingFoods(a.buyingGuide,refs)}</details><details><summary>Intake references for your context</summary>${intakeMarkup(a.intakeGuide,context,refs,{restricted})}</details><details><summary>Medical conditions &amp; strength of evidence</summary>${medicalMarkup(a.medicalGuide,snapshot.research.medicalPolicy,refs)}</details><details><summary>Do’s, don’ts &amp; value-for-money checks</summary>${buyingPractices(a.buyingGuide,refs)}${productSelectionMarkup(snapshot.categories[category],snapshot.recommender?.productPolicy,snapshot.recommender?.rules.find(r=>r.category===category))}${buyingQuality(snapshot.research.educationPolicy,refs)}</details><details><summary>Safety, interactions &amp; ongoing use</summary><p>${esc(a.safety)}</p><p>${esc(a.routineUse)}</p></details>${related.length?`<details><summary>Comparisons and related articles</summary><ul>${related.map(item=>`<li><a href="${esc(articleHref(item.id))}">${esc(item.title)} →</a></li>`).join('')}</ul></details>`:''}</div>`;
}

/** A declared-product inventory, never an inferred dose or a complete dietary intake. */
export function auditStack(snapshot,selections,context={}){
 const rows=new Map(),gaps=[],packs=[],limitAlerts=[],unknownKeys=new Set();
 const fieldsByKey=new Map(Object.values(snapshot.categories).flatMap(c=>c.nutrientFields||[]).map(f=>[f.key,f]));
 const principalKeys=(c,r)=>c.id==='protein'?['protein']:c.id==='creatine'?[r.type==='Monohydrate'?'creatineMonohydrateMg':'creatineOtherMg']:c.mainNutrient==='multi'?(c.id==='zmc'?['calciumMg','magnesiumMg','zincMg']:r.declaredNutrients||[]):[c.mainNutrient==='vitaminDIu'?'vitaminDMcg':c.mainNutrient];
 const canonical=key=>key==='vitaminDIu'?'vitaminDMcg':key;
 const declaredKeys=(c,r)=>[...new Set([...principalKeys(c,r),...(r.declaredNutrients||[])])].map(canonical);
 const markUnknown=(c,r)=>{for(const key of declaredKeys(c,r))unknownKeys.add(key);for(const f of fieldsByKey.values())if(finite(r[f.key]))unknownKeys.add(canonical(f.key));};
 const add=(key,label,unit,amount,product,partial=false)=>{
  if(!finite(amount)||amount<0)return;
  if(!rows.has(key))rows.set(key,{key,label,unit,amount:0,partial:false,products:[]});
  const row=rows.get(key);row.amount+=amount;row.partial ||= partial;row.products.push(product);
 };
 for(const selected of selections){
  const c=snapshot.categories[selected.category],r=c?.offers.find(r=>String(r.id)===String(selected.offerId));
  if(!r){gaps.push('An exact product could not be resolved in this dataset.');continue;}
  const name=r.brand+' · '+r.product,raw=selected.quantity,q=Number(raw),unit=dailyQuantityUnit(r),capacity=unit==='g'?r.grams:r.packCount;
  if(raw==null||String(raw).trim()===''||!Number.isFinite(q)||q<0){gaps.push(name+': daily quantity not entered or invalid; not counted as zero.');markUnknown(c,r);packs.push({name,quantity:null,unit,dailyCost:null,days:null});continue;}
  const priceKnown=r.priceAudit?.status==='verified'&&positive(r.price),dailyCost=positive(capacity)&&priceKnown?q*r.price/capacity:null;
  packs.push({name,quantity:q,unit,dailyCost,days:q>0&&positive(capacity)?capacity/q:null});
  if(q===0)continue;
  if(r.additionalIngredients?.length)gaps.push(name+': additional declared ingredients are recorded but are outside modeled nutrient totals: '+r.additionalIngredients.map(i=>i.name).join(', ')+'.');
  if(!r.isUnitOffer){
   if(c.id==='protein'&&positive(r.protein))add('protein','Protein','g',q*r.protein/100,name);
   else if(c.id==='creatine'&&positive(r.creatine)){
    const key=r.type==='Monohydrate'?'creatineMonohydrateMg':'creatineOtherMg';
    add(key,r.type==='Monohydrate'?'Creatine monohydrate (compound)':'Other declared creatine compound','mg',q*r.creatine/100*1000,name);
   }else {gaps.push(name+': concentration not established.');markUnknown(c,r);}
   continue;
  }
  const serving=unit==='g'?r.servingGrams:r.servingUnits;
  if(!positive(serving)){gaps.push(name+': label serving basis is unknown; ingredient totals cannot be calculated for '+declaredKeys(c,r).map(k=>fieldsByKey.get(k)?.label||k).join(', ')+'.');markUnknown(c,r);continue;}
  const multiplier=q/serving,fields=new Map([...fieldsByKey].filter(([key])=>finite(r[key])||(r.declaredNutrients||[]).includes(key)).concat((c.nutrientFields||[]).map(f=>[f.key,f])));
  // D in IU and µg describes the same amount. Canonicalize to µg once.
  if(finite(r.vitaminDMcg)||finite(r.vitaminDIu))add('vitaminDMcg','Vitamin D','µg',multiplier*(r.vitaminDMcg??r.vitaminDIu/40),name);
  for(const [key,f] of fields){
   if(['vitaminDIu','vitaminDMcg','caffeineAnhydrousMg','caffeineComponentMg'].includes(key)||nutrientUnits[key]==='%')continue;
   // Salt/derivative and mixed botanical material masses are product-specific.
   const productSpecific=/CompoundMg$/.test(key)||['ashwagandhaMg','standardizedExtractMg','collagenComplexMg','nativeTypeIIMg'].includes(key);
   if(finite(r[key]))add(productSpecific?key+':'+r.id:key,f.label,nutrientUnits[key]||f.unit,r[key]*multiplier,name);
  }
  if(c.id==='pre-workout'){
   if(!finite(r.caffeineMg)){
    const known=[r.caffeineAnhydrousMg,r.caffeineComponentMg].filter(finite);
    if(known.length)add('caffeineMg','Caffeine (known amount only)','mg',Math.max(...known)*multiplier,name,true);
    gaps.push(name+': total caffeine is not established; any known component is a lower bound, not a complete total.');
   }
   gaps.push(name+': undeclared or incompletely quantified blend ingredients cannot be ruled out.');
  }
  const main=declaredKeys(c,r);
  if(main.some(k=>!finite(r[k]))){const missing=main.filter(k=>!finite(r[k]));gaps.push(name+': declared label amounts are unknown for '+missing.map(k=>fieldsByKey.get(k)?.label||k).join(', ')+'.');for(const k of missing)unknownKeys.add(k);}
 }
 for(const row of rows.values())if(unknownKeys.has(row.key))row.partial=true;
 const limits=new Map();
 for(const a of snapshot.research?.articles||[])for(const l of matchingReferences(a.intakeGuide?.limits,context))limits.set(JSON.stringify([l.key,l.unit,l.basis]),l);
 for(const l of limits.values()){
  const row=rows.get(l.key);if(row&&row.unit===l.unit&&row.amount>l.max)limitAlerts.push({...l,knownAmount:row.amount});
 }
 return {rows:[...rows.values()],gaps:[...new Set(gaps)],packs,limitAlerts};
}
export function auditStackMarkup(snapshot,selections,context,{unresolvedCategories=[]}={}){
 const a=auditStack(snapshot,selections,context),money=n=>new Intl.NumberFormat(snapshot.config.locale||'en-IN',{style:'currency',currency:snapshot.config.currency||'INR'}).format(n);
 return `<section class="stack-daily-audit"><span class="section-kicker">YOUR ENTERED QUANTITIES</span><h3>Ingredient overlap &amp; daily cost</h3><p>${esc(snapshot.research.intakePolicy?.aggregateNote||'Only entered product quantities are counted; this is not a complete dietary total.')}</p>${unresolvedCategories.length?`<p class="intake-review-note">Existing categories without an exact product: ${esc(unresolvedCategories.join(', '))}. Their contribution is unknown.</p>`:''}${a.limitAlerts.map(l=>`<p class="stack-flow-notice"><strong>Known intake exceeds ${esc(l.label)}:</strong> ${number(l.knownAmount)} ${esc(l.unit)}/day versus ${number(l.max)} ${esc(l.unit)}. ${esc(l.notes)} Review this combination before use.</p>`).join('')}${a.rows.length?`<div class="stack-ingredient-list">${a.rows.map(row=>`<div class="stack-ingredient"><div><strong>${esc(row.label)}</strong><small>${esc(row.products.join(' + '))}</small></div><span>${row.partial?'At least ':''}${number(row.amount)} ${esc(row.unit)}/day${row.products.length>1?'<small class="ingredient-overlap">Multiple product contributions</small>':''}</span></div>`).join('')}</div><p class="hint">Each row is a separate label measure. EPA+DHA, EAA/BCAA and component rows overlap; never add these rows together. Compound, elemental, free-form and precursor amounts remain separate. Totals below a displayed limit do not establish safety or adequacy.</p>`:'<p>No quantified daily ingredient totals yet. Select exact products and enter the amount you actually plan to use.</p>'}${a.packs.length?`<details><summary>Pack duration &amp; cost at entered quantities</summary>${a.packs.map(p=>`<p><strong>${esc(p.name)}</strong><br>${p.quantity==null?'Daily quantity unknown':`${number(p.quantity)} ${p.unit}/day`}${p.dailyCost!=null?' · '+money(p.dailyCost)+'/day':' · Daily cost unknown'}${p.days!=null?' · '+number(p.days)+' days per pack':''}</p>`).join('')}<p class="hint">Cost uses dated pack prices, excludes shipping and assumes the entered amount every day. It is arithmetic, not an instruction to take a product daily.</p></details>`:''}${a.gaps.length?`<details open><summary>What is still unquantified</summary><ul>${a.gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul></details>`:''}</section>`;
}
