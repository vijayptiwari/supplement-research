// Label-serving inputs for counted packs and explicitly weighed powder packs.
const numeric=n=>typeof n==='number'&&Number.isFinite(n);
const positive=n=>numeric(n)&&n>0;
export const nutrientUnits={ashwagandhaMg:'mg',standardizedExtractMg:'mg',withanolidesPct:'%',withanolidesMg:'mg',fishOilMg:'mg',epaMg:'mg',dhaMg:'mg',epaDhaMg:'mg',vitaminDIu:'IU',vitaminDMcg:'µg',vitaminK2Mcg:'µg',magnesiumMg:'mg',calciumMg:'mg',zincMg:'mg',magnesiumCompoundMg:'mg',calciumCompoundMg:'mg',zincCompoundMg:'mg',glutathioneMg:'mg',melatoninMg:'mg',biotinMcg:'µg',vitaminCMg:'mg',vitaminB1Mg:'mg',vitaminB2Mg:'mg',vitaminB3Mg:'mg',vitaminB5Mg:'mg',vitaminB6Mg:'mg',vitaminB12Mcg:'µg',folicAcidMcg:'µg',folateMcgDfe:'µg DFE',methylfolateMcg:'µg',energyPerServing:'kcal'};
export const nutrientCostFields=c=>(c.nutrientFields||[]).filter(f=>positive(f.costQuantity));
export const nutrientCostKey=f=>'costPer_'+f.key;
Object.assign(nutrientUnits,{arginineMg:'mg',carnitineMg:'mg',carnitineCompoundMg:'mg',bcaaMg:'mg',eaaMg:'mg',leucineMg:'mg',isoleucineMg:'mg',valineMg:'mg',caffeineMg:'mg',caffeineAnhydrousMg:'mg',citrullineMg:'mg',citrullineMalateMg:'mg',betaAlanineMg:'mg',creatineMg:'mg',taurineMg:'mg'});
Object.assign(nutrientUnits,{caffeineComponentMg:'mg',arginineCompoundMg:'mg'});
Object.assign(nutrientUnits,{betaineMg:'mg',betaineHclMg:'mg',hmbMg:'mg',calciumHmbMg:'mg',hmbFreeAcidMg:'mg'});
export function completeUnitLabel(r,c){
 if(r.packServings==null)return false;
 if(c.mainNutrient!=='multi')return r[c.mainNutrient]!=null;
 const keys=c.id==='zmc'?['calciumMg','magnesiumMg','zincMg']:r.declaredNutrients;
 return Array.isArray(keys)&&keys.length>0&&keys.every(key=>r[key]!=null);
}
export function normalizeUnitInputs(raw,definition){
 const r={...raw,isUnitOffer:true,grams:null,kg:null,scoop:null,energy:null,proteinPerScoop:null,powderCost:null,score:0,rankingEligible:false},issues=[];
 const issue=(field,message,severity='error')=>issues.push({severity,field,message});
 r.price=positive(raw.price)?raw.price:null;if(r.price==null)issue('price','A positive INR pack price is required.');
 const powder=raw.form==='Powder';
 r.packCount=null;r.servingUnits=null;r.servingGrams=null;
 if(powder){
  if(!definition.supportsPowder)issue('form','This category does not support powder packs.');
  r.grams=positive(raw.grams)?raw.grams:null;
  if(r.grams==null)issue('grams','A verified positive net powder weight in grams is required.');
  r.kg=r.grams==null?null:r.grams/1000;
  if(raw.servingGrams!=null){if(!positive(raw.servingGrams)||raw.servingGrams>r.grams)issue('servingGrams','Label serving must be a positive gram weight within the pack.');else r.servingGrams=raw.servingGrams;}
  if(raw.packCount!=null||raw.servingUnits!=null)issue('packCount','Powder packs use grams and servingGrams; do not substitute a marketed serving count.');
  r.powderCost=r.price!=null&&r.grams!=null?r.price/r.grams:null;
 }else{
  r.packCount=Number.isInteger(raw.packCount)&&raw.packCount>0?raw.packCount:null;if(r.packCount==null)issue('packCount','A verified positive whole-number pack count is required.');
  if(raw.servingUnits!=null){if(!Number.isInteger(raw.servingUnits)||raw.servingUnits<=0||raw.servingUnits>r.packCount)issue('servingUnits','Label serving must contain a positive whole number of units within the pack.');else r.servingUnits=raw.servingUnits;}
  if(!['Tablet','Capsule','Softgel','Gummy','Oral strip'].includes(raw.form))issue('form','Use a supported oral dosage form.');
 }
 for(const key of Object.keys(nutrientUnits)){
  const value=raw[key];r[key]=value??null;
  if(value!=null&&(!numeric(value)||value<0||(key==='withanolidesPct'&&value>100))){r[key]=null;issue(key,'Use a non-negative numeric label amount, or null for unknown.');}
 }
 // Source: NIH ODS Vitamin D fact sheet. This is a unit conversion, not intake advice.
 if(powder&&r.servingGrams!=null){
  r.energy=r.energyPerServing==null?null:r.energyPerServing/r.servingGrams*100;
  if(r.energy!=null&&r.energy>900)issue('energyPerServing','Calculated powder energy exceeds 900 kcal per 100 g. Check kcal versus kJ and the serving basis.');
  for(const key of Object.keys(nutrientUnits).filter(k=>k.endsWith('Mg')))if(r[key]!=null&&r[key]>r.servingGrams*1000+.1)issue(key,'An individual ingredient amount exceeds the powder label serving mass. Check units and serving basis.');
 }
 if(r.bcaaMg!=null&&r.eaaMg!=null&&r.bcaaMg>r.eaaMg+.1)issue('bcaaMg','BCAAs are a subset of EAAs and cannot exceed the EAA total on the same label serving.');
 const knownBcaa=['leucineMg','isoleucineMg','valineMg'].reduce((total,key)=>total+(r[key]??0),0);
 for(const key of ['bcaaMg','eaaMg'])if(r[key]!=null&&knownBcaa>r[key]+.1)issue(key,'Known BCAA components exceed the declared amino-acid total on the same serving basis.');
 if(r.bcaaMg!=null&&['leucineMg','isoleucineMg','valineMg'].every(k=>r[k]!=null)&&Math.abs(r.bcaaMg-r.leucineMg-r.isoleucineMg-r.valineMg)>.1)issue('bcaaMg','BCAA total disagrees with the three stated components.');
 if(r.vitaminDIu!=null&&r.vitaminDMcg!=null&&Math.abs(r.vitaminDIu-r.vitaminDMcg*40)>.01)issue('vitaminDIu','IU and microgram Vitamin D amounts disagree (1 µg = 40 IU).');
 if(r.vitaminDIu==null&&r.vitaminDMcg!=null)r.vitaminDIu=r.vitaminDMcg*40;
 if(r.vitaminDMcg==null&&r.vitaminDIu!=null)r.vitaminDMcg=r.vitaminDIu/40;
 const combined=r.epaMg!=null&&r.dhaMg!=null?r.epaMg+r.dhaMg:null;
 if(r.epaDhaMg!=null&&combined!=null&&Math.abs(r.epaDhaMg-combined)>.01)issue('epaDhaMg','The stated EPA+DHA total disagrees with the stated components.');
 if(r.epaDhaMg==null)r.epaDhaMg=combined;
 if(r.epaDhaMg!=null&&r.fishOilMg!=null&&r.epaDhaMg>r.fishOilMg+.01)issue('epaDhaMg','EPA+DHA cannot exceed the labelled fish oil mass on the same serving basis.');
 for(const key of ['magnesiumMg','calciumMg','zincMg'])if(r[key]!=null&&raw.mineralBasis!=='elemental')issue(key,'Elemental mineral amounts must be explicitly identified on the label. Do not substitute salt/compound mass.');
 r.withanolidesMg=positive(r.standardizedExtractMg)&&r.withanolidesPct!=null?r.standardizedExtractMg*r.withanolidesPct/100:null;
 r.packServings=powder?(r.grams!=null&&r.servingGrams!=null?r.grams/r.servingGrams:null):(r.packCount!=null&&r.servingUnits!=null?r.packCount/r.servingUnits:null);
 r.unitCost=r.price!=null&&r.packCount!=null?r.price/r.packCount:null;
 r.servingCost=r.price!=null&&positive(r.packServings)?r.price/r.packServings:null;
 r.activeUnitCost=r.price!=null&&positive(r.packServings)&&positive(r[definition.mainNutrient])?r.price/(r.packServings*r[definition.mainNutrient]):null;
 r.referenceQuantity=definition.referenceQuantity;r.referenceUnit=definition.referenceUnit;
 r.referenceCost=definition.mainNutrient==='multi'?r.servingCost:r.activeUnitCost==null?null:r.activeUnitCost*definition.referenceQuantity;
 r.cost=definition.mainNutrient==='multi'?r.servingCost:r.activeUnitCost;
 r.nutrientCosts=Object.fromEntries((definition.nutrientFields||[]).filter(f=>f.unit!=='%'&&f.unit!=='kcal').map(f=>[f.key,r.price!=null&&positive(r.packServings)&&positive(r[f.key])?r.price/(r.packServings*r[f.key]):null]));
 r.nutrientReferenceCosts=Object.fromEntries(nutrientCostFields(definition).map(f=>[f.key,r.nutrientCosts[f.key]==null?null:r.nutrientCosts[f.key]*f.costQuantity]));
 for(const f of nutrientCostFields(definition))r[nutrientCostKey(f)]=r.nutrientReferenceCosts[f.key];
 if(r.packServings==null)issue(powder?'servingGrams':'servingUnits','Label serving size not verified; serving and active-content costs are unavailable.','warning');
 if(definition.mainNutrient!=='multi'&&r[definition.mainNutrient]==null)issue(definition.mainNutrient,'Labelled active quantity not verified; no active-content cost is inferred.','warning');
 if(definition.id==='zmc'&&['calciumMg','magnesiumMg','zincMg'].some(k=>r[k]==null))issue('mineralAmounts','One or more elemental amounts are unverified. Mineral masses are not combined into a single value score.','warning');
 if(definition.mainNutrient==='multi'&&definition.id!=='zmc'){
  if(!Array.isArray(raw.declaredNutrients)||!raw.declaredNutrients.length||new Set(raw.declaredNutrients).size!==raw.declaredNutrients.length||raw.declaredNutrients.some(key=>!(definition.nutrientFields||[]).some(f=>f.key===key)))issue('declaredNutrients','List each declared ingredient once using the category nutrient keys. Do not combine their masses.');
  else if(raw.declaredNutrients.some(key=>r[key]==null))issue('ingredientAmounts','One or more declared ingredient amounts are unverified. Serving cost does not establish a complete ingredient profile.','warning');
 }
 if(definition.id==='pre-workout'){
  if(!['Contains caffeine','Labelled caffeine-free','Not verified'].includes(raw.stimulantStatus))issue('stimulantStatus','Record the verified caffeine status, or Not verified.');
  if(raw.stimulantStatus==='Labelled caffeine-free'&&r.caffeineMg!==0)issue('caffeineMg','A caffeine-free profile requires an explicit zero caffeine label amount.');
  if(r.caffeineMg!=null&&r.caffeineAnhydrousMg!=null&&r.caffeineAnhydrousMg>r.caffeineMg+.01)issue('caffeineMg','Total caffeine cannot be below the explicitly declared caffeine anhydrous component on the same serving basis.');
  if(r.caffeineMg!=null&&r.caffeineComponentMg!=null&&r.caffeineComponentMg>r.caffeineMg+.01)issue('caffeineMg','Total caffeine cannot be below an explicitly declared caffeine component on the same serving basis.');
  if(raw.stimulantStatus==='Contains caffeine'&&r.caffeineMg===0)issue('caffeineMg','A contains-caffeine profile cannot have zero total caffeine.');
 }
 if(definition.id==='zmc'&&!['calcium','magnesium','zinc'].every(k=>(raw.declaredActives||[]).includes(k)))issue('declaredActives','ZMC requires an explicit declaration of calcium, magnesium and zinc.');
 if(raw.notes&&/conflict|differs|unverified|not.*elemental|headline|ambiguous/i.test(raw.notes))issue('labelEvidence','Read the source notes for unresolved label or basis differences.','warning');
 return {offer:r,issues};
}
export function unitFacets(c){return [['brand','Brand'],['product','Product'],['type','Source / chemical form'],['subclass','Formulation / extract class'],['source','Ingredient origin'],['form','Dosage form'],['flavour','Flavour'],['packCount','Units per pack'],...(c.supportsPowder?[['grams','Powder pack size (g)']]:[]),...(c.extraFacets||[]),['stock','Availability']];}
export function unitMetrics(c){return [['price','Pack price (₹)'],['unitCost','Cost / single unit (₹)'],...(c.supportsPowder?[['powderCost','Cost / g powder (₹)'],['servingGrams','Powder label serving (g)']]:[]),['servingCost','Cost / label serving (₹)'],...(c.mainNutrient==='multi'?[]:[['referenceCost',`Cost / ${c.referenceQuantity} ${c.referenceUnit} ${c.compoundLabel} (₹)`]]),...(c.nutrientFields||[]).map(f=>[f.key,`${f.label} (${f.unit} / label serving)`]),...nutrientCostFields(c).map(f=>[nutrientCostKey(f),`Cost / ${f.costQuantity} ${f.unit} ${f.label} (₹)`]),['energyPerServing','Energy (kcal / label serving)']];}
