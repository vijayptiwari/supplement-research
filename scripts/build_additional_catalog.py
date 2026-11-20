"""Import curated label profiles and exact official pack prices.

Inputs are data/additional-sources.json, not UI constants. Unknown label amounts
stay null. Packs need a verified count or powder weight. --refresh fetches
product prices again; label dates remain separate.
"""
import argparse,datetime,html,json,math,pathlib,re,urllib.request
from decimal import Decimal,InvalidOperation
from html.parser import HTMLParser
from urllib.parse import parse_qs,urlsplit
ROOT=pathlib.Path(__file__).resolve().parents[1]
class VisibleText(HTMLParser):
 def __init__(self):super().__init__();self.skip=False;self.parts=[]
 def handle_starttag(self,t,a):
  if t in ['script','style']:self.skip=True
 def handle_endtag(self,t):
  if t in ['script','style']:self.skip=False
 def handle_data(self,d):
  if not self.skip:self.parts.append(d)
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (Supplement Research)','Accept':'application/json,text/html;q=0.9'}),timeout=25) as response:return response.read().decode('utf-8')

class JsonLdScripts(HTMLParser):
 def __init__(self):super().__init__();self.capture=False;self.parts=[];self.documents=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and dict(attrs).get('type')=='application/ld+json':self.capture=True;self.parts=[]
 def handle_data(self,data):
  if self.capture:self.parts.append(data)
 def handle_endtag(self,tag):
  if tag=='script' and self.capture:
   try:self.documents.append(json.loads(''.join(self.parts)))
   except json.JSONDecodeError:pass
   self.capture=False

def jsonld_variant(raw,entry):
 """Accept only the selected ProductGroup variant, never an aggregate/default price."""
 reader=JsonLdScripts();reader.feed(raw);candidates=[]
 def walk(node):
  if isinstance(node,list):
   for value in node:yield from walk(value)
  elif isinstance(node,dict):
   yield node
   for value in node.values():
    if isinstance(value,(list,dict)):yield from walk(value)
 for node in walk(reader.documents):
  types=node.get('@type',[]);types=[types] if isinstance(types,str) else types
  if 'ProductGroup' not in types:continue
  for variant in node.get('hasVariant',[]):
   if str(variant.get('sku',''))!=str(entry['variantSku']):continue
   offers=variant.get('offers',[]);offers=[offers] if isinstance(offers,dict) else offers
   for offer in offers:
    if offer.get('url')!=entry['variantUrl']:continue
    if offer.get('priceCurrency')!='INR':raise ValueError('Selected variant price is not INR: '+entry['variantUrl'])
    price=float(offer['price'])
    if not math.isfinite(price) or price<=0:raise ValueError('Selected variant needs a positive listed price: '+entry['variantUrl'])
    weight=variant.get('weight',{})
    if entry.get('form')=='Powder':
     if not isinstance(weight,dict) or weight.get('unitCode') not in ['KGM','GRM']:raise ValueError('Selected powder variant needs a supported structured weight: '+entry['variantUrl'])
     try:grams=float(weight['value'])*(1000 if weight['unitCode']=='KGM' else 1)
     except (KeyError,TypeError,ValueError):raise ValueError('Selected powder variant weight is invalid: '+entry['variantUrl'])
     if not math.isfinite(grams) or grams<=0:raise ValueError('Selected powder variant weight is invalid: '+entry['variantUrl'])
     if abs(grams-entry['grams'])>.001:raise ValueError('Selected variant weight differs from curated label profile: '+entry['variantUrl'])
    status=offer.get('availability','').rsplit('/',1)[-1]
    candidates.append(dict(id=entry.get('variantId',entry['variantSku']),title=variant.get('name','Selected pack'),price=price,available=True if status=='InStock' else False if status in ['OutOfStock','SoldOut'] else None))
 unique={json.dumps(v,sort_keys=True):v for v in candidates}
 if len(unique)!=1:raise ValueError('Exact JSON-LD variant missing or conflicting: '+entry['variantUrl'])
 return next(iter(unique.values()))

def source_kind(entry):
 """Unrecognized providers must not fall through to Shopify/default pricing."""
 kind=entry.get('kind','shopify')
 if kind not in ['shopify','jsonld','html','magento-configurable','hk-product']:raise ValueError('Unsupported product source kind: '+str(kind))
 return kind

class NextDataScript(HTMLParser):
 """Read public server-rendered JSON without executing page JavaScript."""
 def __init__(self):super().__init__();self.capture=False;self.parts=[];self.documents=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and dict(attrs).get('id')=='__NEXT_DATA__':self.capture=True;self.parts=[]
 def handle_data(self,data):
  if self.capture:self.parts.append(data)
 def handle_endtag(self,tag):
  if tag=='script' and self.capture:
   try:self.documents.append(json.loads(''.join(self.parts)))
   except json.JSONDecodeError:raise ValueError('Public HK product data is not valid JSON.')
   self.capture=False

def hk_product_variant(raw,entry):
 """Match the exact published HK-platform SKU, full attributes and net pack.

 A family price, loyalty price, ignored navKey, stale unpublished page or a
 rounded pound description cannot establish the curated gram/count offer.
 """
 hosts={'healthkart.com','www.healthkart.com','hkvitals.com','www.hkvitals.com','muscleblaze.com','www.muscleblaze.com','fuelone.in','www.fuelone.in','truebasics.com','www.truebasics.com'}
 product_url=urlsplit(entry.get('productUrl',''));variant_url=urlsplit(entry.get('variantUrl',''))
 if product_url.scheme!='https' or product_url.hostname not in hosts or variant_url.scheme!='https' or variant_url.hostname!=product_url.hostname:raise ValueError('HK source and exact variant URL must use the same supported HTTPS storefront.')
 variant_id=str(entry.get('variantId',''));product_id=str(entry.get('productId',''))
 if not re.fullmatch(r'[1-9]\d*',variant_id) or not re.fullmatch(r'[1-9]\d*',product_id):raise ValueError('HK product and variant IDs must be explicit positive integers.')
 query=parse_qs(variant_url.query)
 if query.get('navKey')!=['VRNT-'+variant_id]:raise ValueError('HK exact variant URL must retain its one matching navKey.')
 for parsed in [product_url,variant_url]:
  path_ids=re.findall(r'/SP-(\d+)(?:/|$)',parsed.path)
  if path_ids and path_ids!=[product_id]:raise ValueError('HK source URL product ID differs from the curated product.')
 source_query=parse_qs(product_url.query)
 if 'navKey' in source_query and source_query['navKey']!=['VRNT-'+variant_id]:raise ValueError('HK fetched URL selects another variant.')
 reader=NextDataScript();reader.feed(raw)
 if len(reader.documents)!=1:raise ValueError('One unambiguous public HK product document is required.')
 try:page=reader.documents[0]['props']['pageProps']
 except (KeyError,TypeError):raise ValueError('Public HK product data is missing page props.')
 if not isinstance(page,dict):raise ValueError('Public HK product page props must be an object.')
 candidates=[value for value in [page.get('reviewData'),page.get('data',{}).get('results') if isinstance(page.get('data'),dict) else None] if isinstance(value,dict)]
 if len(candidates)!=1:raise ValueError('One unambiguous selected HK product is required.')
 product=candidates[0]
 if str(product.get('sp_id',''))!=product_id:raise ValueError('Returned HK product ID differs from the requested product.')
 norm=lambda value:' '.join(str(value).split()).casefold()
 expected_brand=entry.get('sourceBrand',entry.get('brand'))
 if not isinstance(expected_brand,str) or not expected_brand.strip() or norm(product.get('brName',''))!=norm(expected_brand):raise ValueError('Returned HK brand differs from the curated source brand.')
 published=[product[key] for key in ['isPublish','is_published'] if key in product and product[key] is not None]
 if not published or any(value is not True for value in published):raise ValueError('HK product is not explicitly published.')
 selected_id=str(product.get('id',''))
 if not re.fullmatch(r'[1-9]\d*',selected_id) or product.get('navKey')!='VRNT-'+selected_id:raise ValueError('Returned HK selected ID and navKey disagree.')
 selected=product;attributes=product.get('selAttr1');title=product.get('nm')
 if selected_id!=variant_id:
  # A URL that explicitly selected this child must not silently return a
  # default. Family pages may supply a complete, independently priced child.
  if 'navKey' in source_query:raise ValueError('HK fetched navKey was ignored; selected variant differs.')
  variants=product.get('availVar',{})
  matches=[value for value in variants.values() if isinstance(value,dict) and str(value.get('sv_id',''))==variant_id] if isinstance(variants,dict) else []
  unique={json.dumps(value,sort_keys=True):value for value in matches}
  if len(unique)!=1:raise ValueError('Exact HK family child is absent or ambiguous.')
  selected=next(iter(unique.values()));attributes=selected.get('attrKeyVsValue');title=selected.get('fullName')
  if any(selected.get(key) is False for key in ['isPublish','is_published']):raise ValueError('HK child variant is unpublished.')
 wanted=entry.get('variantAttributes')
 if not isinstance(wanted,dict) or not wanted or not isinstance(attributes,dict) or set(wanted)!=set(attributes) or any(not isinstance(value,str) or not value.strip() or norm(value)!=norm(attributes[key]) for key,value in wanted.items()):raise ValueError('Every HK variant attribute must match the exact selected pack.')
 quantity_keys=[key for key in attributes if key in ['fn-att-quant','gen-pro-siz','gen-sn-qty']]
 if len(quantity_keys)!=1:raise ValueError('One explicit HK net pack quantity is required.')
 quantity=attributes[quantity_keys[0]]
 if entry.get('form')=='Powder':
  match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?)\s*',quantity,re.I)
  grams=entry.get('grams')
  if not isinstance(grams,(int,float)) or isinstance(grams,bool) or not math.isfinite(grams) or grams<=0:raise ValueError('HK powder needs a positive, explicitly verified net gram weight.')
  if match:
   if abs(float(match[1])*(1000 if match[2].lower()=='kg' else 1)-grams)>.001:raise ValueError('HK powder weight differs from the curated net pack.')
  else:
   # Marketplace attributes often round 100 g to 0.22 lb or 1 kg to 2.2 lb.
   # Never convert that rounded number. A curated selected-pack label must
   # independently establish actual grams, and retain its evidence metadata.
   evidence=urlsplit(entry.get('netWeightEvidenceUrl',''));verified_grams=entry.get('netWeightEvidenceGrams')
   try:
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',entry.get('netWeightEvidenceChecked','')):raise ValueError()
    datetime.date.fromisoformat(entry['netWeightEvidenceChecked'])
   except (TypeError,ValueError):raise ValueError('Rounded HK pack size needs dated exact-label gram evidence.')
   if not re.fullmatch(r'\s*\d+(?:\.\d+)?\s*lb\s*',quantity,re.I) or entry.get('packSizeLabel')!=quantity or evidence.scheme!='https' or not evidence.hostname or not isinstance(verified_grams,(int,float)) or isinstance(verified_grams,bool) or not math.isfinite(verified_grams) or verified_grams!=grams:raise ValueError('Rounded HK pack size needs exact selected-pack label evidence; pounds are never scaled.')
 else:
  count=entry.get('packCount');match=re.fullmatch(r'\s*(\d+)\s*(tablets?|tablet\(s\)|tabs?|capsules?|capsule\(s\)|softgels?|gummies|oral\s+strips?)\s*',quantity,re.I)
  forms={'Tablet':{'tablet','tablets','tablet(s)','tab','tabs'},'Capsule':{'capsule','capsules','capsule(s)'},'Softgel':{'softgel','softgels','capsule','capsules','capsule(s)'},'Gummy':{'gummies'},'Oral strip':{'oral strip','oral strips'}}
  if not match or not isinstance(count,(int,float)) or isinstance(count,bool) or not math.isfinite(count) or count<=0 or int(count)!=count or int(match[1])!=count or norm(match[2]) not in forms.get(entry.get('form'),set()):raise ValueError('HK selected unit count or form differs from the curated retail pack.')
 # These storefronts render INR. Require actual currency evidence as well as
 # an approved source host; do not derive currency from a profile default.
 if selected.get('currency') not in [None,'INR'] or product.get('currency') not in [None,'INR']:raise ValueError('HK selected price is not INR.')
 currency_reader=JsonLdScripts();currency_reader.feed(raw)
 def currencies(node):
  if isinstance(node,list):
   for value in node:yield from currencies(value)
  elif isinstance(node,dict):
   if 'priceCurrency' in node:yield node['priceCurrency']
   for value in node.values():
    if isinstance(value,(list,dict)):yield from currencies(value)
 declared=set(currencies(currency_reader.documents))
 if declared and declared!={'INR'}:raise ValueError('HK page currency evidence conflicts with INR.')
 if not declared and not any(symbol in raw for symbol in ['₹','\\u20b9','&#8377;','&#x20b9;']):raise ValueError('HK page does not establish INR pricing.')
 try:price=Decimal(str(selected.get('offer_pr','NaN')))
 except (InvalidOperation,TypeError,ValueError):raise ValueError('HK exact variant listed price is invalid.')
 if not price.is_finite() or price<=0 or not math.isfinite(float(price)):raise ValueError('HK exact variant listed price must be positive and finite.')
 if not isinstance(title,str) or not title.strip():raise ValueError('HK exact variant title is missing.')
 available=False if selected.get('oos') is True else True if selected.get('oos') is False else None
 return dict(id=variant_id,title=title,price=float(price),available=available,currency='INR')

def magento_configurable_variant(raw,entry):
 """Match every published attribute to one child and use only its final price."""
 marker='new Product.Config('
 if raw.count(marker)!=1:raise ValueError('One unambiguous public configurable product document is required.')
 try:config,_=json.JSONDecoder().raw_decode(raw.split(marker,1)[1])
 except (TypeError,ValueError):raise ValueError('Public configurable product data is not valid JSON.')
 if not isinstance(config,dict) or not re.fullmatch(r'\s*₹\s*#\{price\}\s*',config.get('template','')):raise ValueError('Exact configurable price template must establish INR.')
 tax=config.get('taxConfig',{})
 if not isinstance(tax,dict) or tax.get('includeTax') is not True or tax.get('showIncludeTax') is not True or tax.get('showBothPrices'):raise ValueError('An unambiguous tax-inclusive price basis is required.')
 wanted=entry.get('variantOptions',{});attributes=config.get('attributes',{})
 if not isinstance(wanted,dict) or not wanted or not isinstance(attributes,dict) or set(wanted)!=set(attributes):raise ValueError('Every configurable attribute must be selected exactly.')
 parent=urlsplit(entry.get('productUrl',''));selected_url=urlsplit(entry.get('variantUrl',''));query=parse_qs(selected_url.query)
 if parent.scheme!='https' or (selected_url.scheme,selected_url.netloc,selected_url.path)!=(parent.scheme,parent.netloc,parent.path):raise ValueError('Exact variant URL must use the official parent product URL.')
 selectors={k for k in query if k.startswith('super_attribute[')}
 if selectors!={'super_attribute['+k+']' for k in wanted} or any(query.get('super_attribute['+k+']')!=[str(v)] for k,v in wanted.items()):raise ValueError('Exact variant URL must retain all selected attribute options.')
 selected=None;labels=[];size_label=None
 for attr_id,option_id in wanted.items():
  attribute=attributes[attr_id]
  if not isinstance(attribute,dict) or not isinstance(attribute.get('options'),list):raise ValueError('Configurable attribute options are missing.')
  matches=[option for option in attribute['options'] if isinstance(option,dict) and str(option.get('id'))==str(option_id)]
  if len(matches)!=1:raise ValueError('Selected attribute option is absent or ambiguous.')
  option=matches[0]
  if not isinstance(option.get('label'),str) or not isinstance(option.get('products'),list):raise ValueError('Selected option lacks a label or child products.')
  labels.append(option['label']);children=set(map(str,option['products']));selected=children if selected is None else selected&children
  if attribute.get('code')=='size':size_label=option['label']
 child_id=str(entry.get('variantId',''))
 if selected!={child_id}:raise ValueError('Selected attributes do not identify exactly the intended child product.')
 if entry.get('form')=='Powder':
  match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?)\s*',size_label or '',re.I);grams=entry.get('grams')
  if not match or not isinstance(grams,(int,float)) or isinstance(grams,bool) or not math.isfinite(grams) or grams<=0:raise ValueError('Selected powder size needs an explicit verified net weight.')
  selected_grams=float(match[1])*(1000 if match[2].lower()=='kg' else 1)
  if abs(selected_grams-grams)>.001:raise ValueError('Selected powder size differs from the curated net weight.')
 children=config.get('childProducts',{});child=children.get(child_id) if isinstance(children,dict) else None
 if not isinstance(child,dict):raise ValueError('Exact child price is absent.')
 try:price=Decimal(str(child.get('finalPrice','NaN')))
 except (InvalidOperation,TypeError,ValueError):raise ValueError('Exact child final price is invalid.')
 if not price.is_finite() or price<=0 or not math.isfinite(float(price)):raise ValueError('Exact child final price must be positive and finite.')
 # The public child-price configuration does not expose variant stock. A family
 # Add to cart button or availability value cannot establish child availability.
 return dict(id=child_id,title=' / '.join(labels),price=float(price),available=None,currency='INR',taxInclusive=True)

def merge_refreshed_offers(existing,refreshed):
 """A partial source manifest must never replace unrelated catalog records."""
 merged={str(row['id']):dict(row) for row in existing};seen={}
 for row in refreshed:
  key=str(row['id'])
  if key in seen and seen[key]!=row:raise ValueError('Conflicting refreshes for stable offer ID: '+key)
  seen[key]=row
  merged[key]={**merged.get(key,{}),**row}
 return list(merged.values())

def observation_key(row):
 """Keep earlier provenance even when the same quote is described again."""
 return json.dumps(row,sort_keys=True,ensure_ascii=False,separators=(',',':'))

def save_refreshed_categories(root,categories,as_of):
 data=root/'docs/data';config_path=data/'site.json'
 definitions=json.loads(config_path.read_text(encoding='utf-8'))['categories'] if config_path.exists() else []
 files={c['id']:c['file'] for c in definitions};pending=[]
 for category,offers in categories.items():
  if not offers:raise ValueError('No verified packs for '+category)
  filename=files.get(category,category+'.json')
  if not re.fullmatch(r'[a-z][a-z0-9-]*\.json',filename):raise ValueError('Unsafe category data filename.')
  target=data/filename;prior=json.loads(target.read_text(encoding='utf-8')) if target.exists() else dict(category=category,offers=[])
  prior.update(checked=as_of,offers=merge_refreshed_offers(prior['offers'],offers));pending.append((target,prior))
 # Validate every merge before writing any category.
 for target,payload in pending:
  target.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  print(payload['category'],len(payload['offers']),'offers',len({r['brand'] for r in payload['offers']}),'brands')

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--as-of',required=True);parser.add_argument('--refresh',action='store_true');parser.add_argument('--categories',nargs='+',help='Refresh only these category IDs; the default is every category in the source manifest.');args=parser.parse_args();datetime.date.fromisoformat(args.as_of)
 manifest=json.loads((ROOT/'docs/data/additional-sources.json').read_text(encoding='utf-8'));cache=ROOT/'outputs'/('supplements_'+args.as_of.replace('-',''));cache.mkdir(exist_ok=True,parents=True)
 available=list(dict.fromkeys(e['category'] for e in manifest['products']));selected=args.categories or available
 if any(c not in available for c in selected):parser.error('Unknown category: '+', '.join(c for c in selected if c not in available))
 categories={c:[] for c in selected};observations=[];excluded=[]
 for entry in manifest['products']:
  if entry['category'] not in categories:continue
  kind=source_kind(entry)
  brand=entry['brand'];base=entry['base'];handle=entry.get('handle');url=entry.get('productUrl') or base+'/products/'+handle
  if kind=='hk-product':
   raw_path=cache/(entry['cacheKey']+'.html');raw=get(url) if args.refresh or not raw_path.exists() else raw_path.read_text(encoding='utf-8');raw_path.write_text(raw,encoding='utf-8')
   variants=[hk_product_variant(raw,entry)];evidence=url
  elif kind=='magento-configurable':
   raw_path=cache/(entry['cacheKey']+'.html');raw=get(url) if args.refresh or not raw_path.exists() else raw_path.read_text(encoding='utf-8');raw_path.write_text(raw,encoding='utf-8')
   variants=[magento_configurable_variant(raw,entry)];evidence=url
  elif kind=='jsonld':
   raw_path=cache/(entry['cacheKey']+'.html');raw=get(url) if args.refresh or not raw_path.exists() else raw_path.read_text(encoding='utf-8');raw_path.write_text(raw,encoding='utf-8')
   variants=[jsonld_variant(raw,entry)];evidence=entry['variantUrl']
  elif entry.get('kind')=='html':
   raw_path=cache/(entry['cacheKey']+'.txt');raw=get(url) if args.refresh or not raw_path.exists() else raw_path.read_text(encoding='utf-8');raw_path.write_text(raw,encoding='utf-8')
   reader=VisibleText();reader.feed(raw);text=re.sub(r'\s+',' ',' '.join(reader.parts));start=text.find('Key Features');primary=text[start:start+3500] if start>=0 else ''
   match=re.search(r'₹\s*([\d,]+(?:\.\d+)?)\s+MRP',primary)
   if not match:raise ValueError('Exact primary price not established: '+url)
   variants=[dict(id=entry['id'],title=entry['form'],price=match[1].replace(',',''),available=None)];evidence=url
  else:
   feed_path=cache/(re.sub(r'\W+','_',brand)+'.json');product_path=cache/(handle+'.json')
   if not args.refresh and feed_path.exists():
    product=next((p for p in json.loads(feed_path.read_text(encoding='utf-8')).get('products',[]) if p['handle']==handle),None);evidence=base+'/products.json?limit=250'
   else:product=None
   if product is None:
    evidence=url+'.json';text=get(evidence) if args.refresh or not product_path.exists() else product_path.read_text(encoding='utf-8');product_path.write_text(text,encoding='utf-8');product=json.loads(text)['product']
   variants=product['variants']
  for variant in variants:
   title=variant['title']
   if entry.get('variantIds') and str(variant['id']) not in [str(value) for value in entry['variantIds']]:continue
   if entry.get('variantTitles') and title not in entry['variantTitles']:continue
   count_title=re.fullmatch(r'Pack of (\d+)',title,re.I) if entry.get('countFromPackTitle') else None
   if not count_title and not entry.get('allowRetailMultipack') and re.search(r'pack\s+of\s*[2-9]\b|\b[2-9]\s*boxes|\bx\s*[2-9]|\b[2-9]\s*x\b',title,re.I):continue
   powder=entry.get('form')=='Powder'
   quantity=entry.get('packCount');count=re.search(r'(\d+)\s*(?:tablets?|tabs?|capsules?|softgels?|gummies|oral strips?|\bN\b)',title,re.I)
   if count_title:quantity=int(count_title[1])
   elif count:quantity=int(count[1])
   elif title.isdigit() and entry.get('numericVariantIsCount',True):quantity=int(title)
   if powder:
    quantity=None
    if not isinstance(entry.get('grams'),(int,float)) or isinstance(entry['grams'],bool) or entry['grams']<=0:excluded.append(dict(url=url,variant=variant['id'],reason='Net powder grams not verified.'));continue
    if kind not in ['jsonld','magento-configurable','hk-product'] and not entry.get('variantIds') and not entry.get('variantTitles'):raise ValueError('Powder profile requires explicit variant selection so weight and flavour cannot leak across packs: '+url)
   elif not quantity:excluded.append(dict(url=url,variant=variant['id'],reason='Pack count not verified.'));continue
   row={k:v for k,v in entry.items() if k not in ['category','base','handle','variantTitles','variantIds','cacheKey','kind','id','numericVariantIsCount','allowRetailMultipack','productUrl','variantUrl','variantSku','variantId','variantOptions','productId','sourceBrand','variantAttributes']}
   row.update(id=entry.get('id') or f"{entry['category']}-{variant['id']}",product=entry['product'],packCount=quantity,price=float(variant['price']),currency='INR',stock='In stock' if variant.get('available') is True else 'Sold out' if variant.get('available') is False else 'Listed; confirm stock',url=url if entry.get('kind')=='html' else url+'?variant='+str(variant['id']),nutritionUrl=entry.get('nutritionUrl',url),flavour=entry.get('flavour','Unflavoured'),packaging=entry.get('packaging','Single retail pack'),labelChecked=entry.get('labelChecked',manifest['labelChecked']))
   if kind in ['jsonld','magento-configurable','hk-product']:row['url']=entry['variantUrl']
   categories[entry['category']].append(row);observations.append(dict(category=entry['category'],offerId=row['id'],date=args.as_of,price=row['price'],currency='INR',sourceUrl=row['url'],evidenceUrl=evidence,kind='official-live',matchBasis='Public HK-platform exact published product/variant ID, source brand and all selected attributes; unconditional INR offer price and exact retail pack checked'+('; gram weight from separately reviewed selected-pack label, not rounded pounds' if entry.get('netWeightEvidenceUrl') else '') if kind=='hk-product' else 'Official Magento exact child ID and all attribute options; INR tax-inclusive child finalPrice and net pack weight checked; child stock unverified' if kind=='magento-configurable' else 'Official exact ProductGroup variant SKU and URL; pack weight checked' if kind=='jsonld' else 'Official primary product page and explicitly selected pack' if kind=='html' else 'Official Shopify exact variant ID; net powder grams verified' if powder else 'Official Shopify exact variant ID; retail-pack count verified',variantId=None if kind=='html' else str(variant['id'])))
 save_refreshed_categories(ROOT,categories,args.as_of)
 ledger_path=ROOT/'docs/data/price-observations.json';ledger=json.loads(ledger_path.read_text(encoding='utf-8'));merged={observation_key(r):r for r in ledger['observations']}
 merged.update({observation_key(r):r for r in observations});ledger.update(checked=max(ledger.get('checked',''),args.as_of),observations=list(merged.values()));ledger_path.write_text(json.dumps(ledger,ensure_ascii=False),encoding='utf-8')
 (cache/'excluded.json').write_text(json.dumps(excluded,indent=2),encoding='utf-8')
if __name__=='__main__':main()
