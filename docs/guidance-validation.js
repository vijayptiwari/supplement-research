// Dataset validation is independent of rendering and runs before a snapshot is accepted.
export function validateClinicalGuidance(research,invalid){
 const text=v=>typeof v==='string'&&v.trim().length>0,num=v=>typeof v==='number'&&Number.isFinite(v),date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,refs=new Set(research.sources.map(s=>s.id));
 const units=new Set(['g','mg','µg','IU','µg DFE','mg NE','ng']);
 const policy=research.intakePolicy,medical=research.medicalPolicy;
 if(research.articles.some(a=>a.intakeGuide!=null)&&!policy)invalid('Intake guides require an explicit adult reference policy.');
 if(research.articles.some(a=>a.medicalGuide!=null)&&!medical)invalid('Medical guides require an explicit evidence policy.');
 if(!policy&&!medical)return;
 const ids=new Set(Array.isArray(policy?.profiles)?policy.profiles.map(p=>p?.id):[]);
 if(policy&&(!date(policy.reviewed)||!ids.size||ids.size!==policy.profiles.length||policy.profiles.some(p=>!text(p?.id)||!text(p?.label)||!text(p?.description))||!Array.isArray(policy.ageBands)||!policy.ageBands.length||policy.ageBands.some(b=>!Number.isInteger(b?.value)||b.value<19||!text(b.label))||['baseline','loadNote','experienceNote','foodNote','aggregateNote'].some(k=>!text(policy[k]))||!Array.isArray(policy.sourceIds)||!policy.sourceIds.length||policy.sourceIds.some(id=>!refs.has(id))))invalid('Intake guidance needs valid adult profiles, ages, policy context and citations.');
 if(medical&&(!date(medical.reviewed)||!text(medical.summary)||['established','conditional','mixed','insufficient'].some(k=>!text(medical.levels?.[k]))))invalid('Medical evidence needs an explicit condition-specific evidence scale.');
 for(const a of research.articles){
  const validRefs=v=>Array.isArray(v)&&v.length>0&&Array.isArray(a.sourceIds)&&v.every(id=>refs.has(id)&&a.sourceIds.includes(id));
  if(policy){
   const g=a.intakeGuide;
   const validRow=(t,isLimit=false)=>t&&text(t.key)&&text(t.label)&&units.has(t.unit)&&Number.isInteger(t.minAge)&&t.minAge>=19&&(t.maxAge==null||(Number.isInteger(t.maxAge)&&t.maxAge>=t.minAge))&&typeof t.notes==='string'&&validRefs(t.sourceIds)&&(isLimit?num(t.max)&&t.max>0&&['total-daily','supplement-daily','synthetic-folic-acid'].includes(t.basis):num(t.min)&&t.min>0&&(t.max==null||num(t.max)&&t.max>=t.min)&&typeof t.perKg==='boolean'&&['total-daily','supplement-daily','study-regimen','per-session'].includes(t.basis)&&['any','male','female'].includes(t.sex)&&['RDA','AI','sports-range','studied-protocol'].includes(t.referenceType)&&Array.isArray(t.profileIds)&&t.profileIds.length>0&&t.profileIds.every(id=>ids.has(id)));
   if(!g||!date(g.reviewed)||!text(g.summary)||!['daily-target','optional-performance','clinician-directed','no-established-target'].includes(g.kind)||!validRefs(g.sourceIds)||!Array.isArray(g.notes)||g.notes.some(n=>!text(n))||!Array.isArray(g.targets)||g.targets.some(t=>!validRow(t))||!Array.isArray(g.limits)||g.limits.some(t=>!validRow(t,true)))invalid(`Guide ${a.category} has invalid intake amounts, basis, adult context or citations.`);
   for(const f of a.buyingGuide?.foods||[]){
    if(!f||!['quantified','not-quantified','not-applicable'].includes(f.quantityStatus)||!text(f.quantityNote)||!Array.isArray(f.amounts)||(f.quantityStatus==='quantified'?f.amounts.length===0:f.amounts.length!==0)||f.amounts?.some(m=>!m||!text(m.nutrient)||!num(m.min)||m.min<0||(m.max!=null&&(!num(m.max)||m.max<m.min))||!units.has(m.unit)||!num(m.per?.amount)||m.per.amount<=0||!text(m.per?.label)||!text(m.per?.unit)||!validRefs(m.sourceIds)))invalid(`Guide ${a.category} needs a verified amount and serving basis, or an explicit food quantity gap.`);
   }
  }
  if(medical){const g=a.medicalGuide;if(!g||!date(g.reviewed)||!text(g.summary)||!Array.isArray(g.conditions)||!g.conditions.length||g.conditions.some(e=>!e||!text(e.condition)||!text(e.findings)||!text(e.limits)||!Object.hasOwn(medical.levels||{},e.level)||!validRefs(e.sourceIds)))invalid(`Guide ${a.category} needs sourced, condition-specific medical evidence.`);}
 }
}
