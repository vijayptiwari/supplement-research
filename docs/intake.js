import {escapeHtml as esc} from './model.js';

const finite=n=>typeof n==='number'&&Number.isFinite(n);
const num=n=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(n);
export const referenceDefaults=()=>({profile:'everyday',age:19,sex:'any',weight:'',sessions:'',minutes:''});
export function normalizeReferenceContext(policy,input={}){
 const c={...referenceDefaults(),...input};
 if(policy?.profiles?.length&&!policy.profiles.some(p=>p.id===c.profile))c.profile=policy.profiles[0].id;
 if(policy?.ageBands?.length&&!policy.ageBands.some(b=>String(b.value)===String(c.age)))c.age=policy.ageBands[0].value;
 return c;
}
export const referenceSources=(ids,refs)=>(ids||[]).map(id=>refs.get(id)).filter(Boolean).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join(' · ');
export function matchingReferences(rows,context={}){
 const c={...referenceDefaults(),...context},age=Number(c.age);
 if(!Number.isFinite(age)||age<19)return [];
 return (rows||[]).filter(t=>age>=t.minAge&&(t.maxAge==null||age<=t.maxAge)&&(!t.profileIds||t.profileIds.includes(c.profile))&&(!t.sex||t.sex==='any'||c.sex==='any'||t.sex===c.sex));
}
export function referenceAmount(target,weight=''){
 const kg=Number(weight),valid=weight!==''&&finite(kg)&&kg>0;
 return {min:target.min,max:target.max,unit:target.unit+(target.perKg?'/kg':''),daily:target.perKg&&valid?{min:target.min*kg,max:target.max==null?null:target.max*kg}:null};
}
export function intakeControls(policy,context=referenceDefaults(),prefix='reference'){
 if(!policy)return '';
 const c=normalizeReferenceContext(policy,context),options=(rows,value)=>rows.map(r=>`<option value="${esc(r.value??r.id)}"${String(r.value??r.id)===String(value)?' selected':''}>${esc(r.label)}</option>`).join('');
 const select=(key,label,rows)=>`<label for="${prefix}-${key}">${label}<select id="${prefix}-${key}" data-intake-key="${key}">${options(rows,c[key])}</select></label>`;
 const number=(key,label,attrs)=>`<label for="${prefix}-${key}">${label}<input id="${prefix}-${key}" data-intake-key="${key}" type="number" inputmode="decimal" value="${esc(c[key])}" ${attrs}></label>`;
 return `<div class="intake-controls" data-intake-controls>${select('profile','Training context',policy.profiles)}${select('age','Adult age reference',policy.ageBands)}${select('sex','Sex-based reference',[{value:'any',label:'Show both references'},{value:'female',label:'Female reference'},{value:'male',label:'Male reference'}])}${number('weight','Body mass (kg, optional)','min="1" step="any" placeholder="For g/kg conversion"')}${number('sessions','Sessions / week (optional)','min="0" max="21" step="1"')}${number('minutes','Minutes / session (optional)','min="0" step="1"')}</div>`;
}
export function readIntakeControls(root){
 const c=referenceDefaults();root?.querySelectorAll('[data-intake-key]').forEach(e=>c[e.dataset.intakeKey]=e.value);return c;
}
export function workloadMarkup(context,policy){
 const s=Number(context.sessions),m=Number(context.minutes),has=context.sessions!==''&&context.minutes!==''&&Number.isFinite(s)&&Number.isFinite(m)&&s>=0&&s<=21&&m>=0;
 return `<p class="intake-workload">${has?`Entered workload: <strong>${num(s*m)} minutes/week</strong>. `:''}${esc(policy?.loadNote||'Training frequency alone does not determine a dose.')}</p>`;
}
export function intakeMarkup(guide,context,refs,{restricted=false}={}){
 if(!guide)return '';
 const targets=matchingReferences(guide.targets,context),limits=matchingReferences(guide.limits,context);
 const basis={'total-daily':'Food + supplements / day','supplement-daily':'Supplement / day','study-regimen':'Studied regimen','per-session':'Per session','synthetic-folic-acid':'Supplements + fortified food / day'};
 const range=(min,max)=>num(min)+(max!=null&&max!==min?'–'+num(max):'');
 return `<p>${esc(guide.summary)}</p>${restricted?'<p class="intake-review-note">Personal quantity calculations are paused for your health context. These adult references are not an individual treatment plan.</p>':targets.length?`<div class="intake-reference-list">${targets.map(t=>{const a=referenceAmount(t,context?.weight);return `<div class="intake-reference"><div><strong>${esc(t.label)}</strong><span>${esc(t.referenceType)}${t.sex!=='any'?' · '+esc(t.sex)+' reference':''}</span></div><div class="intake-reference-amount">${range(a.min,a.max)} ${esc(a.unit)}<small>${esc(basis[t.basis]||t.basis)}</small>${a.daily?`<small>At entered mass: ${range(a.daily.min,a.daily.max)} ${esc(t.unit)}/day total${t.basis==='total-daily'?' intake':''}</small>`:''}</div><p>${esc(t.notes)}</p><p class="source-line">${referenceSources(t.sourceIds,refs)}</p></div>`;}).join('')}</div>`:'<p class="intake-review-note">No numeric routine target is assigned for this context. A missing target does not mean zero intake, unlimited safety or a requirement to buy a product.</p>'}${limits.length?`<details class="intake-limits"><summary>Upper limits and safety benchmarks · never targets</summary>${limits.map(l=>`<p><strong>${esc(l.label)}: ${num(l.max)} ${esc(l.unit)}/day</strong> · ${esc(basis[l.basis]||l.basis)}<br>${esc(l.notes)}</p><p class="source-line">${referenceSources(l.sourceIds,refs)}</p>`).join('')}</details>`:''}<ul class="intake-notes">${guide.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p class="source-line">Reference basis: ${referenceSources(guide.sourceIds,refs)}</p>`;
}
export function medicalMarkup(guide,policy,refs){
 if(!guide)return '';
 return `<p>${esc(guide.summary)}</p><div class="medical-evidence-list">${guide.conditions.map(e=>`<div class="medical-evidence" data-evidence-level="${esc(e.level)}"><span class="evidence-level">${esc(policy?.levels?.[e.level]||e.level)}</span><h4>${esc(e.condition)}</h4><p>${esc(e.findings)}</p><p class="source-line">${referenceSources(e.sourceIds,refs)}</p></div>`).join('')}</div><p class="medical-policy">${esc(policy?.summary||'Condition-specific evidence does not establish a personal treatment plan.')}</p>`;
}
export const clinicalSearchText=a=>[a.intakeGuide?.summary,...(a.intakeGuide?.notes||[]),...(a.intakeGuide?.targets||[]).flatMap(t=>[t.label,t.min,t.max,t.unit,t.notes,t.referenceType]),...(a.intakeGuide?.limits||[]).flatMap(t=>[t.label,t.max,t.unit,t.notes]),a.medicalGuide?.summary,...(a.medicalGuide?.conditions||[]).flatMap(e=>[e.condition,e.findings,e.limits])].join(' ');
