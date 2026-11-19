import {guideHref} from './routes.js';
import {escapeHtml as esc,formatDate} from './model.js';
import {productChecksFor,productCheckText} from './product-policy.js';

export const buyingGuideFor=(snapshot,category)=>snapshot.research?.articles?.find(a=>a.category===category)?.buyingGuide;
export function buyingGuideSearchText(g){
 if(!g)return '';
 return [...g.whoCanConsider,...g.whoShouldReview,g.foodSummary,...g.foods.flatMap(f=>[f.name,f.detail,f.quantityNote,JSON.stringify(f.amounts||[])]),g.value.targetedUse,g.value.reason,g.value.scope,...g.value.worthWhen,...g.value.skipWhen,...[...(g.practices?.dos||[]),...(g.practices?.donts||[])].flatMap(i=>[i.title,i.detail])].join(' ');
}
export const sourceLinks=(ids,refs)=>ids.map(id=>{const s=refs.get(id);return s?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`:'';}).filter(Boolean).join(' · ');
const list=items=>`<ul>${items.map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`;
const scoreLabel=(policy,score)=>policy?.scale?.find(s=>s.score===score)?.label||'Assessment unavailable';
function scoreMarkup(score,title,policy){
 if(!Number.isInteger(score)||score<1||score>5)return '';
 return `<div class="priority-rating" data-score="${score}"><span class="priority-context">${esc(title)}</span><div class="priority-number"><strong>${score}<small>/5</small></strong><span>${esc(scoreLabel(policy,score))}</span></div><span class="priority-steps" role="img" aria-label="${score} out of 5 editorial purchase priority">${Array.from({length:5},(_,i)=>`<i${i<score?' class="is-filled"':''}></i>`).join('')}</span></div>`;
}
export function buyingPriority(g,policy,{compact=false}={}){
 if(!g||!policy)return '';
 return `<div class="buying-priority${compact?' is-compact':''}"><div class="priority-pair">${scoreMarkup(g.value.routineScore,'Routine purchase',policy)}${scoreMarkup(g.value.targetedScore,'For the stated need',policy)}</div><p class="priority-need"><strong>Stated need:</strong> ${esc(g.value.targetedUse)}</p><p class="priority-scope"><strong>Scope:</strong> ${esc(g.value.scope)}</p>${compact?'':`<p class="priority-baseline">${esc(policy.baseline)}</p><p>${esc(g.value.reason)}</p>`}</div>`;
}
export function buyingAudience(g,refs){
 if(!g)return '';
 return `<div class="audience-guidance"><div><h4>Who can consider it</h4>${list(g.whoCanConsider)}</div><div><h4>Who should review it first</h4>${list(g.whoShouldReview)}</div></div><p class="source-line">Sources: ${sourceLinks(g.value.sourceIds,refs)}</p>`;
}
export function foodAmounts(f,refs){
 const n=v=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:4}).format(v);
 return f.quantityStatus==='quantified'?`<dl class="food-amounts">${f.amounts.map(m=>`<div><dt>${esc(m.nutrient)}</dt><dd><strong>${n(m.min)}${m.max!=null?'–'+n(m.max):''} ${esc(m.unit)}</strong><small>per ${esc(m.per.label)}</small></dd></div>`).join('')}</dl><p class="food-quantity-note">${esc(f.quantityNote)}</p><p class="source-line">${sourceLinks([...new Set(f.amounts.flatMap(m=>m.sourceIds))],refs)}</p>`:f.quantityStatus?`<p class="food-quantity-note"><strong>Amount not established.</strong> ${esc(f.quantityNote)}</p>`:'';
}
export function buyingFoods(g,refs){
 if(!g)return '';
 const labels={direct:'Food source',precursor:'Provides building blocks','different-form':'Different form or component'};
 return `<p>${esc(g.foodSummary)}</p>${g.foods.length?`<div class="food-source-grid">${g.foods.map(f=>`<div class="food-source-card"><span>${esc(labels[f.relationship])}</span><h4>${esc(f.name)}</h4><p>${esc(f.detail)}</p>${foodAmounts(f,refs)}</div>`).join('')}</div>`:''}<p class="source-line">Sources: ${sourceLinks(g.foodSourceIds,refs)}</p>`;
}
export function buyingValue(g,policy,refs){
 if(!g||!policy)return '';
 return `${buyingPriority(g,policy)}<div class="value-reasons"><div><h4>Worth considering when</h4>${list(g.value.worthWhen)}</div><div><h4>Usually skip when</h4>${list(g.value.skipWhen)}</div></div><p class="value-evidence">Evidence assessment: <strong>${esc(policy.evidenceLabels[g.value.evidence])}</strong> · Editorial review ${formatDate(g.reviewed)}</p><details class="rating-method"><summary>How these ratings work</summary><p>${esc(policy.method)}</p><ol>${policy.scale.map(s=>`<li value="${s.score}"><strong>${esc(s.label)}:</strong> ${esc(s.description)}</li>`).join('')}</ol></details><p class="source-line">Sources: ${sourceLinks(g.value.sourceIds,refs)}</p>`;
}
export function buyingPractices(g,refs){
 const p=g?.practices;if(!p)return '';
 const column=(items,label,kind)=>`<div class="practice-column ${kind}"><h4>${label}</h4><ul>${items.map(i=>`<li><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p></li>`).join('')}</ul></div>`;
 return `<div class="practice-grid">${column(p.dos,'Do','practice-do')}${column(p.donts,'Don’t','practice-dont')}</div><p class="source-line">Sources: ${sourceLinks(p.sourceIds,refs)}</p>`;
}
export function buyingQuality(policy,refs){
 if(!policy?.qualityNote)return '';
 return `<aside class="buying-quality-note"><h4>${esc(policy.qualityTitle)}</h4><p>${esc(policy.qualityNote)}</p><p class="source-line">Sources: ${sourceLinks(policy.qualitySourceIds,refs)}</p></aside>`;
}
export function valueComparisonBasis(c){
 if(c.educationOnly)return `<div class="value-calculation"><span class="section-kicker">CHECK THE FORM BEFORE THE PRICE</span><h4>Compare the intended ingredient and evidence</h4><p>${esc(c.comparisonNote||'Compare matching forms and complete label servings. Ingredient weight is not a clinical potency score.')}</p><small>This category currently publishes education. Product offers and price comparisons have not been audited.</small></div>`;
 const ingredient=c.compoundLabel||'ingredient',labelled=/^labelled\s/i.test(ingredient)?ingredient:'labelled '+ingredient;
 if(c.measurement!=='units')return `<div class="value-calculation"><span class="section-kicker">COMPARE THE ACTIVE AMOUNT</span><h4>Cost per gram of ${esc(labelled)}</h4><p>Total ${esc(labelled)} in pack = net grams × concentration (%) ÷ 100.</p><p>Cost per gram = pack price ÷ total ${esc(labelled)} grams.</p><small>Compare the same ingredient and chemical form. Keep pack size, upfront spend and flavour differences visible.</small></div>`;
 const multi=c.mainNutrient==='multi';
 return `<div class="value-calculation"><span class="section-kicker">COMPARE THE LABEL SERVING</span><h4>${multi?'Serving cost and each ingredient separately':'Cost per verified '+esc(c.compoundLabel||'ingredient')+' amount'}</h4><p>Pack servings = individual unit count ÷ units per label serving. For weighed powders, use net grams ÷ grams per label serving.</p>${multi?'<p>Compare the pack price per label serving, then assess each nutrient and form separately. Different nutrients do not form a combined potency score.</p>':'<p>Total comparable ingredient amount = pack servings × declared amount per serving. Divide the pack price by that amount, using consistent units and the same form.</p>'}<small>${esc(c.comparisonNote||'Unknown serving or active amounts prevent a reliable active-content cost comparison.')}</small></div>`;
}
export function productSelectionMarkup(c,policy,rule=null){
 if(!policy)return '';
 const shortlist=!!policy.categories[c.id]?.length&&!rule?.review,checks=shortlist?productChecksFor(policy,c.id):policy.common;
 return `${valueComparisonBasis(c)}<div class="selection-explainer"><h4>${shortlist?'Checks used in your stack review':'Price and label checks to make before comparing'}</h4><p>${esc(shortlist?policy.summary:'This category stays in educational review. These checks help you assess a listing; passing them does not make it a product recommendation.')}</p>${rule?`<p class="selection-need"><strong>Start with the need:</strong> ${esc(rule.reason)}</p>`:''}<ol class="selection-checks">${checks.map(check=>`<li data-selection-check="${esc(check.id)}"><strong>${esc(productCheckText(check,'label'))}</strong><p>${esc(productCheckText(check,'detail'))}</p></li>`).join('')}</ol><p class="selection-limit">${esc(policy.limitations)}</p><p class="hint">${esc(policy.orderNote)}</p></div>`;
}
export function buyingOffer(snapshot,c){
 const g=buyingGuideFor(snapshot,c.id),policy=snapshot.research?.valuePolicy;if(!g||!policy)return '';
 const foods=g.foods.slice(0,3).map(f=>f.name).join(' · ');
 return `<details class="offer-buying-guide"><summary>Who it suits, food sources &amp; supplement value</summary><p class="guidance-overline">CATEGORY BUYING GUIDE · ${esc(c.label)}</p>${buyingPriority(g,policy,{compact:true})}<p><strong>Who can consider it:</strong> ${esc(g.whoCanConsider[0])}</p><p><strong>Food context:</strong> ${esc(g.foodSummary)}</p>${foods?`<p class="food-examples">${esc(foods)}</p>`:''}<a href="${esc(guideHref(c.id))}">Start with the basics, food sources &amp; buying checks →</a></details>`;
}
