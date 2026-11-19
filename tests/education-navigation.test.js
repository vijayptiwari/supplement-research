import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {categoryGuideHref,categoryGuideNavigation,marketHomeMarkup,marketGroup,categoryPrimer} from '../docs/marketplace.js';

const categories=[{id:'protein',label:'Protein',page:'protein.html',stats:{offers:77,brands:8}},{id:'creatine',label:'Creatine',page:'creatine.html',stats:{offers:11,brands:3}}];
const snapshot={config:{locale:'en-IN',currency:'INR',categories,quickPicks:[{id:'old-product-pick'}]},categories:Object.fromEntries(categories.map(c=>[c.id,c])),stats:{offers:88,brands:9,verifiedPrices:81},research:{sources:[{id:'source'}],articles:categories.map(c=>({category:c.id,summary:'How this supplement works.'}))}};

test('the supplement rail always links to basics and retains the selected category',()=>{
 const html=categoryGuideNavigation(categories,'protein');
 for(const c of categories){assert.ok(html.includes(`href="guide-${c.id}.html"`));assert.ok(!html.includes(`href="${c.page}"`));}
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 assert.ok(html.includes('href="guide-protein.html" aria-current="page"'));
 assert.equal(categoryGuideHref('new category'),'guide-new%20category.html');
});

test('home supplement choices open learning guides rather than exact-product merchandising',()=>{
 const html=marketHomeMarkup(snapshot);
 for(const c of categories){assert.ok(html.includes(`Start with ${c.label} basics`));assert.ok(!html.includes(`href="${c.page}"`));}
 assert.ok(html.includes('2 supplement guides'));assert.ok(html.includes('88 exact packs to compare after learning'));assert.ok(html.includes('81 / 88'));
 assert.ok(!html.includes('data-offer=')&&!html.includes('LABEL COST COMPARISONS')&&!html.includes('Compare packs →'));
 assert.ok(html.includes('Explore matching products at the end of each guide'));
});

test('explicit catalog routes remain usable and their learning links begin at the full guide',()=>{
 const c={...categories[0],compoundLabel:'protein',concentrationField:'protein',referenceGrams:24};
 const r={id:'exact',brand:'Brand',product:'Product',flavour:'Plain',grams:1000,protein:80,scoop:30,price:899,referenceCost:24,stock:'In stock',priceAudit:{status:'verified',checked:'2026-11-17'}};
 const html=marketGroup(c,{brand:r.brand,product:r.product,count:1,variations:[r]},snapshot,()=>'<table></table>');
 assert.ok(html.includes('data-offer="exact"'));assert.ok(html.includes('data-add-compare'));
 assert.ok(html.includes('href="guide-protein.html"'));assert.ok(!html.includes('guide-protein.html#'));
 const primer=categoryPrimer(snapshot,c);assert.ok(primer.includes('How it works'));assert.ok(primer.includes('Read the full guide'));assert.ok(!primer.includes('guide-protein.html#'));
});

test('catalog and search pages use the same guide rail as the home page',async()=>{
 const js=await fs.readFile(new URL('../docs/site.js',import.meta.url),'utf8');
 assert.ok(js.includes('categoryNav.innerHTML=categoryGuideNavigation(next.config.categories,active)'));
 assert.ok(!js.includes("categoryId||pageType==='search'?c.page"));
});
