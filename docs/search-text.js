// Shared text projections let discovery index the evidence without importing
// the guide, intake or pathway renderers into the search page.
const rows=value=>Array.isArray(value)?value:[];

export function buyingGuideSearchText(guide){
 if(!guide)return '';
 return [
  ...rows(guide.whoCanConsider),...rows(guide.whoShouldReview),guide.foodSummary,
  ...rows(guide.foods).flatMap(food=>[food.name,food.detail,food.quantityNote,JSON.stringify(food.amounts||[])]),
  guide.value?.targetedUse,guide.value?.reason,guide.value?.scope,
  ...rows(guide.value?.worthWhen),...rows(guide.value?.skipWhen),
  ...[...rows(guide.practices?.dos),...rows(guide.practices?.donts)].flatMap(item=>[item.title,item.detail])
 ].join(' ');
}

export function clinicalSearchText(article){
 return [
  article.intakeGuide?.summary,...rows(article.intakeGuide?.notes),
  ...rows(article.intakeGuide?.targets).flatMap(target=>[target.label,target.min,target.max,target.unit,target.notes,target.referenceType]),
  ...rows(article.intakeGuide?.limits).flatMap(limit=>[limit.label,limit.max,limit.unit,limit.notes]),
  article.medicalGuide?.summary,
  ...rows(article.medicalGuide?.conditions).flatMap(condition=>[condition.condition,condition.findings,condition.limits])
 ].join(' ');
}

export function pathwaySearchText(pathway){
 if(!pathway)return '';
 return [
  pathway.title,pathway.summary,pathway.caveat,
  ...rows(pathway.tracks).flatMap(track=>[
   track.label,track.returnLabel,
   ...rows(track.steps).flatMap(step=>[step.label,step.detail,step.compartment])
  ])
 ].filter(Boolean).join(' ');
}
