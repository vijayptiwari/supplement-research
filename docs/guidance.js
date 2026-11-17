import {escapeHtml as esc,formatDate} from './model.js';

export const buyingGuideFor=(snapshot,category)=>snapshot.research?.articles?.find(a=>a.category===category)?.buyingGuide;
export function buyingGuideSearchText(g){
 if(!g)return '';
 return [...g.whoCanConsider,...g.whoShouldReview,g.foodSummary,...g.foods.flatMap(f=>[f.name,f.detail]),g.value.targetedUse,g.value.reason,g.value.scope,...g.value.worthWhen,...g.value.skipWhen].join(' ');
}
const sourceLinks=(ids,refs)=>ids.map(id=>{const s=refs.get(id);return s?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`:'';}).filter(Boolean).join(' · ');
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
export function buyingFoods(g,refs){
 if(!g)return '';
 const labels={direct:'Food source',precursor:'Provides building blocks','different-form':'Different form or component'};
 return `<p>${esc(g.foodSummary)}</p>${g.foods.length?`<div class="food-source-grid">${g.foods.map(f=>`<div class="food-source-card"><span>${esc(labels[f.relationship])}</span><h4>${esc(f.name)}</h4><p>${esc(f.detail)}</p></div>`).join('')}</div>`:''}<p class="source-line">Sources: ${sourceLinks(g.foodSourceIds,refs)}</p>`;
}
export function buyingValue(g,policy,refs){
 if(!g||!policy)return '';
 return `${buyingPriority(g,policy)}<div class="value-reasons"><div><h4>Worth considering when</h4>${list(g.value.worthWhen)}</div><div><h4>Usually skip when</h4>${list(g.value.skipWhen)}</div></div><p class="value-evidence">Evidence assessment: <strong>${esc(policy.evidenceLabels[g.value.evidence])}</strong> · Editorial review ${formatDate(g.reviewed)}</p><details class="rating-method"><summary>How these ratings work</summary><p>${esc(policy.method)}</p><ol>${policy.scale.map(s=>`<li value="${s.score}"><strong>${esc(s.label)}:</strong> ${esc(s.description)}</li>`).join('')}</ol></details><p class="source-line">Sources: ${sourceLinks(g.value.sourceIds,refs)}</p>`;
}
export function buyingOffer(snapshot,c){
 const g=buyingGuideFor(snapshot,c.id),policy=snapshot.research?.valuePolicy;if(!g||!policy)return '';
 const foods=g.foods.slice(0,3).map(f=>f.name).join(' · ');
 return `<details class="offer-buying-guide"><summary>Who it suits, food sources &amp; supplement value</summary><p class="guidance-overline">CATEGORY BUYING GUIDE · ${esc(c.label)}</p>${buyingPriority(g,policy,{compact:true})}<p><strong>Who can consider it:</strong> ${esc(g.whoCanConsider[0])}</p><p><strong>Food context:</strong> ${esc(g.foodSummary)}</p>${foods?`<p class="food-examples">${esc(foods)}</p>`:''}<a href="research.html?category=${esc(c.id)}#${esc(c.id)}-guide-value">Read the full assessment, food sources &amp; references →</a></details>`;
}
