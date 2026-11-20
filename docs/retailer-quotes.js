import {escapeHtml as esc,formatDate,https,positive,isoDate} from './model.js';

export const primarySourceLabel=r=>r.sourceType==='retailer'?`${r.retailer} product listing`:'Official product listing';

export function retailerQuotesMarkup(r,{money,asOf,maxAgeDays=90}){
 const quotes=(Array.isArray(r.retailerQuotes)?r.retailerQuotes:[]).filter(q=>q&&https(q.sourceUrl)&&positive(q.price)&&q.currency==='INR'&&isoDate(q.checked)&&(!asOf||q.checked<=asOf));
 if(!quotes.length)return '';
 return `<section class="method-card retailer-quotes"><h3>Retailer prices for this pack</h3><p>Catalog costs and price history use the primary listing above. These separately dated quotes refer to the same exact pack.</p><ul>${quotes.map(q=>{const age=asOf?Math.floor((Date.parse(asOf)-Date.parse(q.checked))/86400000):null;return `<li><a href="${esc(q.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(q.retailer)} listed price ↗</a>: <strong>${money(q.price)}</strong> · checked ${esc(formatDate(q.checked))}${q.stock?' · '+esc(q.stock):''}${q.seller?' · Seller: '+esc(q.seller):''}${age!=null&&age>maxAgeDays?' · Quote needs a fresh check':''}<p class="hint">${esc(q.matchBasis)}</p></li>`;}).join('')}</ul></section>`;
}
