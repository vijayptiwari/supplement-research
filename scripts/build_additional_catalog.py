"""Import curated label profiles and exact official pack prices.

Inputs are data/additional-sources.json, not UI constants. Unknown label amounts
stay null. Packs need a verified count or powder weight. --refresh fetches
product prices again; label dates remain separate.
"""
import argparse,datetime,html,json,math,pathlib,re,urllib.request
from html.parser import HTMLParser
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

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--as-of',required=True);parser.add_argument('--refresh',action='store_true');parser.add_argument('--categories',nargs='+',help='Refresh only these category IDs; the default is every category in the source manifest.');args=parser.parse_args();datetime.date.fromisoformat(args.as_of)
 manifest=json.loads((ROOT/'docs/data/additional-sources.json').read_text(encoding='utf-8'));cache=ROOT/'outputs'/('supplements_'+args.as_of.replace('-',''));cache.mkdir(exist_ok=True,parents=True)
 available=list(dict.fromkeys(e['category'] for e in manifest['products']));selected=args.categories or available
 if any(c not in available for c in selected):parser.error('Unknown category: '+', '.join(c for c in selected if c not in available))
 categories={c:[] for c in selected};observations=[];excluded=[]
 for entry in manifest['products']:
  if entry['category'] not in categories:continue
  brand=entry['brand'];base=entry['base'];handle=entry.get('handle');url=entry.get('productUrl') or base+'/products/'+handle
  if entry.get('kind')=='jsonld':
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
    if entry.get('kind')!='jsonld' and not entry.get('variantIds') and not entry.get('variantTitles'):raise ValueError('Powder profile requires explicit variant selection so weight and flavour cannot leak across packs: '+url)
   elif not quantity:excluded.append(dict(url=url,variant=variant['id'],reason='Pack count not verified.'));continue
   row={k:v for k,v in entry.items() if k not in ['category','base','handle','variantTitles','variantIds','cacheKey','kind','id','numericVariantIsCount','allowRetailMultipack','productUrl','variantUrl','variantSku','variantId']}
   row.update(id=entry.get('id') or f"{entry['category']}-{variant['id']}",product=entry['product'],packCount=quantity,price=float(variant['price']),currency='INR',stock='In stock' if variant.get('available') is True else 'Sold out' if variant.get('available') is False else 'Listed; confirm stock',url=url if entry.get('kind')=='html' else url+'?variant='+str(variant['id']),nutritionUrl=entry.get('nutritionUrl',url),flavour=entry.get('flavour','Unflavoured'),packaging=entry.get('packaging','Single retail pack'),labelChecked=entry.get('labelChecked',manifest['labelChecked']))
   if entry.get('kind')=='jsonld':row['url']=entry['variantUrl']
   categories[entry['category']].append(row);observations.append(dict(category=entry['category'],offerId=row['id'],date=args.as_of,price=row['price'],currency='INR',sourceUrl=row['url'],evidenceUrl=evidence,kind='official-live',matchBasis='Official exact ProductGroup variant SKU and URL; pack weight checked' if entry.get('kind')=='jsonld' else 'Official primary product page and explicitly selected pack' if entry.get('kind')=='html' else 'Official Shopify exact variant ID; net powder grams verified' if powder else 'Official Shopify exact variant ID; retail-pack count verified',variantId=None if entry.get('kind')=='html' else str(variant['id'])))
 for category,offers in categories.items():
  if not offers:raise ValueError('No verified packs for '+category)
  (ROOT/'docs/data'/(category+'.json')).write_text(json.dumps(dict(checked=args.as_of,category=category,offers=offers),ensure_ascii=False,indent=2),encoding='utf-8');print(category,len(offers),'offers',len({r['brand'] for r in offers}),'brands')
 ledger_path=ROOT/'docs/data/price-observations.json';ledger=json.loads(ledger_path.read_text(encoding='utf-8'));key=lambda r:(r['category'],str(r['offerId']),r['date'],r['price'],r['evidenceUrl']);merged={key(r):r for r in ledger['observations']}
 merged.update({key(r):r for r in observations});ledger.update(checked=max(ledger.get('checked',''),args.as_of),observations=list(merged.values()));ledger_path.write_text(json.dumps(ledger,ensure_ascii=False),encoding='utf-8')
 (cache/'excluded.json').write_text(json.dumps(excluded,indent=2),encoding='utf-8')
if __name__=='__main__':main()
