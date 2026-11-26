import {escapeHtml as esc} from './presentation.js';

// Schematic organ symbols, not anatomical or molecular structure diagrams.
const symbols={
 digest:'<path d="M27 5v14c0 8-6 12-6 20 0 10 7 17 17 17 11 0 19-9 19-20 0-9-6-17-14-17-5 0-8 3-8 7"/><path d="M27 56v6m11-10c-8-3-10-8-8-14m13-13c5 2 8 6 8 12"/>',
 blood:'<path d="M10 10h17v16c0 6 4 10 10 10h17v18M54 10H37v8"/><ellipse cx="15" cy="46" rx="9" ry="6" transform="rotate(-25 15 46)"/><ellipse cx="47" cy="18" rx="8" ry="5" transform="rotate(20 47 18)"/><path d="M12 45h6m25-28h7"/>',
 liver:'<path d="M7 23C16 10 41 10 57 20c2 2 3 7 0 11-4 7-15 10-25 10-9 1-17 8-24 4-6-3-4-15-1-22Z"/><path d="m33 15-5 26m2-11c8-6 17-7 25-6M16 26c-5 4-6 9-5 13"/>',
 kidney:'<path d="M29 10c-6-7-18-4-22 8-5 15 1 32 11 37 7 4 15 0 14-7-1-5-7-7-8-13-1-5 0-10 5-13 5-3 4-8 0-12Z"/><path d="M28 26c9 1 13 8 13 18v16m-14-29c10-5 18-3 27-8m-27 9c11 6 18 7 29 6"/>',
 muscle:'<path d="M8 46c4-3 8-8 11-13l4-14c1-4 6-7 10-5l9 5-6 10-8-4-3 12c7-5 14-5 20 0 9 6 8 15 3 19H19c-7 0-11-4-11-10Z"/><path d="m42 19 3-7-9-6-5 7M20 44c5-1 8 1 10 5m5-10c6-2 10 1 12 6"/>',
 cell:'<path d="M53 16c10 12 8 30-5 39-11 7-31 4-39-8C1 35 5 17 18 9c12-7 27-4 35 7Z"/><ellipse cx="32" cy="31" rx="11" ry="10"/><circle cx="35" cy="29" r="3"/><path d="M13 32h5m29 8 5 3M22 15l3 4m-7 26 4-3"/>',
 brain:'<path d="M31 10C20 1 9 10 12 19 2 23 3 36 10 39c-4 10 5 18 14 15l7 5 7-5c10 3 20-5 16-15 8-5 8-17-1-21C55 7 41 2 33 10Z"/><path d="M32 11v44M13 20c8-3 14 2 14 8m-17 9c6-4 13 0 14 5m26-22c-7-3-13 2-13 8m16 10c-7-5-14-1-15 5M17 12c-3 6 0 11 5 12m24-12c3 5 0 10-5 12"/>',
 energy:'<path d="m32 5 23 13v27L32 59 9 45V18Z"/><path d="m35 15-13 19h12l-5 16 15-23H32z"/>',
 bone:'<path d="M16 5c5-3 10 0 11 5l-1 9 19 21 9 1c5 0 8 5 6 10-1 4-5 6-9 4-1 5-6 7-10 4-4-2-5-6-3-10L18 27l-9-1c-5-1-7-6-4-10 2-3 5-4 8-3-1-3 0-6 3-8Z"/><path d="m25 24 16 18"/>',
 molecule:'<path d="m20 12 22 9v23L20 54 4 37V18zM20 12v22l22 10M20 34 4 37M42 21l15-10m-15 33 15 10"/><circle cx="20" cy="12" r="5"/><circle cx="42" cy="21" r="5"/><circle cx="42" cy="44" r="5"/><circle cx="20" cy="34" r="5"/><circle cx="57" cy="11" r="4"/><circle cx="57" cy="54" r="4"/>',
 signal:'<path d="M6 42h17l4-12h10l4 12h17M6 50h52m-25-8v16M20 20l7 7m17-7-7 7"/><circle cx="32" cy="12" r="6"/><path d="M12 12h6m28 0h6"/>',
 food:'<path d="M6 34h52c-2 16-11 24-26 24S8 50 6 34Zm5 6h42M13 11l9 12m13-14-3 15m19-12-9 12"/><path d="M17 7c-6-2-10 4-5 9m25-10c4-4 9 0 6 5M51 9c6 1 9 6 5 10"/>'
};

export {pathwaySearchText} from './search-text.js';
export const pathwayIconNames=Object.keys(symbols);
export function pathwaySymbol(name){return symbols[name]||symbols.molecule;}

function lines(text,max){
 const out=[];let line='';
 for(const word of String(text).trim().split(/\s+/)){
  if(line&&(line+' '+word).length>max){out.push(line);line='';}
  if(word.length>max){if(line){out.push(line);line='';}for(let i=0;i<word.length;i+=max)out.push(word.slice(i,i+max));}
  else line+=(line?' ':'')+word;
 }
 if(line)out.push(line);return out;
}
const textLines=(rows,x,y,className,lineHeight,anchor='middle')=>`<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}">${rows.map((line,i)=>`<tspan x="${x}" dy="${i?lineHeight:0}">${esc(line)}</tspan>`).join('')}</text>`;
const organ=(step,x,y)=>`<g class="pathway-organ" transform="translate(${x-34} ${y-34})"><circle class="pathway-organ-halo" cx="34" cy="34" r="34"/><g transform="translate(10 10) scale(.75)" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${pathwaySymbol(step.icon)}</g></g>`;
const caption=(step,x,y)=>{const width=Math.min(200,Math.max(68,step.compartment.length*6.2+22));return `<g class="pathway-compartment"><rect x="${x-width/2}" y="${y-13}" width="${width}" height="22" rx="11"/><text x="${x}" y="${y+2}" text-anchor="middle">${esc(step.compartment)}</text></g>`;};
function svgTrack(track,id,vertical){
 const count=track.steps.length,width=vertical?320:900,nodeWidth=width/count,arrow=id+'-arrow',title=id+'-title',description=id+'-description';
 const geometries=track.steps.map((step,i)=>{
  const label=lines(step.label,vertical?22:Math.floor((nodeWidth-30)/7.7)),detail=lines(step.detail,vertical?26:Math.floor((nodeWidth-32)/6.2));
  return {step,label,detail,height:Math.max(150,58+label.length*20+detail.length*(vertical?20:17))};
 });
 let total=vertical?geometries.reduce((sum,g)=>sum+g.height,0)+20:Math.max(...geometries.map(g=>120+g.label.length*21+g.detail.length*17))+35;
 if(track.returnLabel)total+=vertical?54:50;
 const descriptionText=track.steps.map((s,i)=>`${i+1}. ${s.compartment}: ${s.label}. ${s.detail}`).join(' ')+(track.returnLabel?' Recycling: '+track.returnLabel:'');
 let offset=18;
 const nodes=geometries.map((g,i)=>{
  const {step,label,detail}=g,x=vertical?52:nodeWidth*(i+.5),y=vertical?offset+48:78;
  const top=offset;offset+=g.height;
  const link=i<count-1?(vertical?`<path class="pathway-arrow" d="M52 ${y+44}V${offset+21}" marker-end="url(#${arrow})"/>`:`<path class="pathway-arrow" d="M${x+45} 78H${x+nodeWidth-48}" marker-end="url(#${arrow})"/>`):'';
  return `<g data-pathway-step="${i+1}">${link}${organ(step,x,y)}${vertical?caption(step,205,top+15)+textLines(label,100,top+51,'pathway-node-label',20,'start')+textLines(detail,100,top+60+label.length*20,'pathway-node-detail',20,'start'):caption(step,x,22)+textLines(label,x,137,'pathway-node-label',21)+textLines(detail,x,150+label.length*21,'pathway-node-detail',17)}<text class="pathway-node-index" x="${x-25}" y="${y-27}">${String(i+1).padStart(2,'0')}</text></g>`;
 }).join('');
 const loop=track.returnLabel?(vertical?textLines(lines(track.returnLabel,38),160,total-29,'pathway-return-label',16):`<path class="pathway-return" d="M${width-nodeWidth/2} ${total-48}Q${width/2} ${total-12} ${nodeWidth/2} ${total-48}" marker-end="url(#${arrow})"/>${textLines(lines(track.returnLabel,90),450,total-10,'pathway-return-label',16)}`):'';
 return `<svg class="pathway-svg ${vertical?'pathway-vertical':'pathway-horizontal'}" viewBox="0 0 ${width} ${total}" role="img" aria-labelledby="${title} ${description}" xmlns="http://www.w3.org/2000/svg"><title id="${title}">${esc(track.label)}</title><desc id="${description}">${esc(descriptionText)}</desc><defs><marker id="${arrow}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 9 5 1 9" class="pathway-arrowhead"/></marker></defs>${nodes}${loop}</svg>`;
}

export function pathwayMarkup(pathway,refs,articleId,policy=null){
 if(!pathway)return '';
 const prefix=String(articleId).replace(/[^a-zA-Z0-9_-]/g,'-');
 const sources=pathway.sourceIds.map(id=>refs.get(id)).filter(Boolean);
 return `<figure class="pathway-figure" aria-label="${esc(pathway.title)}"><header><span class="section-kicker">ILLUSTRATED MECHANISM</span><h4>${esc(pathway.title)}</h4><p>${esc(pathway.summary)}</p></header><div class="pathway-tracks">${pathway.tracks.map((track,i)=>`<section class="pathway-track"><h5><span>${String(i+1).padStart(2,'0')}</span>${esc(track.label)}</h5>${svgTrack(track,prefix+'-pathway-'+i+'-wide',false)}${svgTrack(track,prefix+'-pathway-'+i+'-narrow',true)}${track.returnLabel?`<p class="pathway-return-note">↻ ${esc(track.returnLabel)}</p>`:''}</section>`).join('')}</div><figcaption><p><strong>Reading this diagram:</strong> ${esc(pathway.caveat)}</p>${policy?.summary?`<p>${esc(policy.summary)}</p>`:''}<p class="source-line">Sources: ${sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join(' · ')}</p></figcaption></figure>`;
}
