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
try:
 from artifact_bridge import artifact_workspace,reject_legacy_writer
except ModuleNotFoundError:
 from scripts.artifact_bridge import artifact_workspace,reject_legacy_writer
OUTPUT_ROOT=None
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
     if not weight and entry.get('netWeightEvidenceUrl'):
      # Some manufacturers publish the exact SKU's mass in its name/label only.
      # A dated review plus an explicit same-variant mass is required; never use
      # the parent name, a pound conversion, serving count or shipping weight.
      proof=urlsplit(entry['netWeightEvidenceUrl']);stamp=entry.get('netWeightEvidenceChecked','')
      try:valid_date=bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}',stamp)) and datetime.date.fromisoformat(stamp)<=datetime.date.today()
      except (TypeError,ValueError):valid_date=False
      name=variant.get('name','')
      # Explicit '2 kg Pack (1 kg x 2)' is a retail total, whereas '24 g'
      # at the start of a protein name is often the protein per serving.
      pack_masses=re.findall(r'(?:^|[|/])\s*(\d+(?:\.\d+)?)\s*(kg|g|grams?)\s+(?:pack|pouch|jar|tub|bag)\b',name,re.I)
      masses=[float(n)*(1000 if unit.lower()=='kg' else 1) for n,unit in pack_masses or re.findall(r'(?<![\w.])(\d+(?:\.\d+)?)\s*(kg|g|grams?)(?!\w)',name,re.I)]
      grams=entry.get('netWeightEvidenceGrams')
      if proof.scheme!='https' or proof.hostname!=urlsplit(entry['variantUrl']).hostname or not valid_date or entry.get('variantName',name)!=name or entry.get('netWeightEvidenceTitle',name)!=name or isinstance(grams,bool) or not isinstance(grams,(int,float)) or not math.isfinite(grams) or grams<=0 or not masses or any(abs(m-grams)>.001 for m in masses):raise ValueError('Selected powder variant needs dated net weight evidence and matching explicit grams in the exact variant name: '+entry['variantUrl'])
     else:
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
 if kind not in ['shopify','jsonld','html','magento-configurable','hk-product','nutrabay-product','dukaan-product']:raise ValueError('Unsupported product source kind: '+str(kind))
 return kind

class DukaanDataScript(HTMLParser):
 """Read the inert public Dukaan JSON; never execute storefront JavaScript."""
 def __init__(self):super().__init__();self.capture=False;self.parts=[];self.documents=[];self.online=[]
 def handle_starttag(self,tag,attrs):
  attributes=dict(attrs)
  if tag=='html':self.online.append(attributes.get('data-store-online'))
  if tag=='script' and attributes.get('id')=='__DUKAAN_DATA__':
   if attributes.get('type')!='application/json':raise ValueError('Dukaan product data must be inert application/json.')
   self.capture=True;self.parts=[]
 def handle_data(self,data):
  if self.capture:self.parts.append(data)
 def handle_endtag(self,tag):
  if tag=='script' and self.capture:
   try:self.documents.append(json.loads(''.join(self.parts)))
   except json.JSONDecodeError:raise ValueError('Public Dukaan product data is not valid JSON.')
   self.capture=False

def dukaan_product_variant(raw,entry):
 """Match both public SKU records, not the parent/default/range or coupon price."""
 pid=str(entry.get('productId',''));vid=str(entry.get('variantId',''));sid=str(entry.get('storeId',''));sku=entry.get('variantSku')
 if any(not re.fullmatch(r'[1-9]\d*',value) for value in [pid,vid,sid]) or not isinstance(sku,str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',sku,re.I):raise ValueError('Dukaan needs exact store, product and SKU IDs plus the SKU UUID.')
 norm=lambda value:' '.join(str(value).split()).casefold()
 base=urlsplit(entry.get('base',''));urls=[urlsplit(entry.get(key,'')) for key in ['productUrl','variantUrl']]
 if base.scheme!='https' or not base.hostname or base.username or base.password or base.port not in [None,443] or base.path not in ['', '/'] or base.query or base.fragment:raise ValueError('Dukaan requires a clean HTTPS storefront base.')
 for url in urls:
  query=parse_qs(url.query,keep_blank_values=True)
  if url.scheme!='https' or url.hostname!=base.hostname or url.username or url.password or url.port not in [None,443] or url.fragment or not url.path.startswith('/products/') or query!={'sku_id':[vid]}:raise ValueError('Dukaan exact product URLs must pin one matching variant on the curated storefront.')
 reader=DukaanDataScript();reader.feed(raw)
 if len(reader.documents)!=1 or reader.online!=['true']:raise ValueError('Dukaan needs one public product document and an explicitly online storefront.')
 data=reader.documents[0]
 if not isinstance(data,dict):raise ValueError('Dukaan public product data must be an object.')
 store=data.get('DUKAAN_STORE');product=data.get('DUKAAN_PRODUCT')
 if not isinstance(store,dict) or not isinstance(product,dict) or str(store.get('id',''))!=sid or str(product.get('id',''))!=pid or not isinstance(product.get('store'),dict) or str(product['store'].get('id',''))!=sid:raise ValueError('Dukaan store or product differs from the curated identity.')
 if store.get('is_active') is not True or product.get('is_active') is not True or type(product.get('product_type')) is not int or product['product_type']!=1 or product.get('product_bundle_type') is not None:raise ValueError('Dukaan record is not an active ordinary retail product.')
 if norm(store.get('custom_domain',''))!=base.hostname or data.get('DUKAAN_CURRENT_PAGE_HOST')!=base.hostname:raise ValueError('Dukaan store domain differs from the curated storefront.')
 for key in ['CANONICAL_BASE_URL','CANONICAL_URL','CURRENT_URL']:
  url=urlsplit(data.get(key,''))
  if url.scheme!='https' or url.hostname!=base.hostname or url.username or url.password or url.port not in [None,443] or url.fragment or (key=='CANONICAL_BASE_URL' and (url.path not in ['', '/'] or url.query)):raise ValueError('Dukaan public canonical/store URL differs from the curated storefront.')
  if key!='CANONICAL_BASE_URL' and (url.path.rstrip('/')!='/products/'+str(product.get('slug','')) or url.query and parse_qs(url.query,keep_blank_values=True)!={'sku_id':[vid]}):raise ValueError('Dukaan public product URL disagrees with the selected SKU.')
 slug=product.get('slug');name=product.get('name');brand=entry.get('sourceBrand',entry.get('brand'))
 if not isinstance(slug,str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',slug) or any(url.path.rstrip('/')!='/products/'+slug for url in urls):raise ValueError('Dukaan exact URL slug does not match the returned product.')
 if not isinstance(name,str) or not name.strip() or not isinstance(entry.get('sourceProductName'),str) or name!=entry['sourceProductName'] or not isinstance(entry.get('sourceStoreName'),str) or store.get('name')!=entry['sourceStoreName'] or not isinstance(brand,str) or not brand.strip() or not all(re.match(re.escape(norm(brand))+r'(?:\W|$)',norm(value)) for value in [name,store['name']]):raise ValueError('Dukaan product/store names and source brand must match the curated brand identity.')
 if store.get('currency_code')!='INR':raise ValueError('Dukaan store currency must explicitly be INR.')
 for node in [store,product['store']]:
  currency=node.get('currency')
  if not isinstance(currency,dict) or any(currency.get(key)!='INR' for key in ['cc','code','currency_code']):raise ValueError('Dukaan store currency declarations are missing or conflicting.')
 def attributes(node):
  values=node.get('attributes')
  if not isinstance(values,list) or not values:raise ValueError('Dukaan SKU needs explicit complete variant attributes.')
  result={}
  for attribute in values:
   if not isinstance(attribute,dict) or not isinstance(attribute.get('master_attribute'),str) or not attribute['master_attribute'].strip() or not isinstance(attribute.get('value'),str) or not attribute['value'].strip() or attribute['master_attribute'] in result:raise ValueError('Dukaan SKU attributes are malformed or duplicated.')
   result[attribute['master_attribute']]=attribute['value']
  return result
 wanted=entry.get('variantAttributes')
 if not isinstance(wanted,dict) or not wanted or any(not isinstance(k,str) or not k.strip() or not isinstance(v,str) or not v.strip() for k,v in wanted.items()):raise ValueError('Dukaan requires all selected attribute names and values.')
 selected=[]
 for key in ['product_skus','skus']:
  children=product.get(key)
  if not isinstance(children,list) or any(not isinstance(child,dict) for child in children):raise ValueError('Dukaan public SKU collections are missing or malformed.')
  matches=[child for child in children if str(child.get('id',''))==vid]
  if len(matches)!=1 or matches[0].get('uuid')!=sku:raise ValueError('Dukaan exact selected SKU ID/UUID is missing, ambiguous or changed.')
  child=matches[0];actual=attributes(child)
  if set(actual)!=set(wanted) or any(norm(value)!=norm(actual[key]) for key,value in wanted.items()):raise ValueError('Every Dukaan selected SKU attribute must match the curated pack.')
  if child.get('is_active') is False or key=='product_skus' and child.get('is_active') is not True:raise ValueError('Dukaan selected SKU is not explicitly active.')
  if entry.get('variantCode') is not None and child.get('sku_code')!=entry['variantCode']:raise ValueError('Dukaan selected merchant SKU code differs from the curated pack.')
  selected.append(child)
 def mass(value):
  match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?)(?:\s*\([^)]*\))?\s*',value,re.I)
  return float(match[1])*(1000 if match[2].lower()=='kg' else 1) if match else None
 size_keys={'size','weight','pack size','pack-size','pack_size','quantity','count'}
 pack_values=[value for key,value in wanted.items() if norm(key) in size_keys]
 if entry.get('form')=='Powder':
  grams=entry.get('grams');proof=[mass(value) for value in pack_values];proof=[v for v in proof if v is not None]
  if isinstance(grams,bool) or not isinstance(grams,(int,float)) or not math.isfinite(grams) or grams<=0:raise ValueError('Dukaan requires actual positive net powder grams.')
  if not proof:
   # A single-size, flavour-only family may publish mass in its exact name.
   # Dated label evidence must be on this page or in this SKU's own gallery.
   # Any size/quantity dimension prevents this fallback, including siblings.
   stamp=entry.get('netWeightEvidenceChecked','');label=entry.get('netWeightEvidenceUrl');label_url=urlsplit(label if isinstance(label,str) else '')
   try:valid_date=isinstance(stamp,str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}',stamp)) and datetime.date.fromisoformat(stamp)<=datetime.date.today()
   except ValueError:valid_date=False
   own_images=[image for child in selected for image in (child.get('all_images') if isinstance(child.get('all_images'),list) else []) if isinstance(image,str)]
   own_evidence=label in [entry['productUrl'],entry['variantUrl']]+own_images
   name_masses=[float(n)*(1000 if unit.lower()=='kg' else 1) for n,unit in re.findall(r'(?<![\w.])(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?)(?!\w)',name,re.I)]
   flavour_keys={'flavor','flavour','color','colour'}
   flavour_only=all(set(norm(k) for k in attributes(child))<=flavour_keys for collection in ['product_skus','skus'] for child in product[collection])
   if not valid_date or label_url.scheme!='https' or label_url.username or label_url.password or not own_evidence or entry.get('netWeightEvidenceGrams')!=grams or not flavour_only or not name_masses:raise ValueError('Dukaan single-size name fallback requires dated exact-SKU label evidence and no size variants.')
   proof=name_masses
  if any(not math.isfinite(value) or abs(value-grams)>.001 for value in proof):raise ValueError('Dukaan actual selected net grams disagree with the curated pack; pounds and shipping weights are not converted.')
 else:
  count=entry.get('packCount');forms={'Tablet':r'tablets?|tabs?','Capsule':r'capsules?|caps?','Softgel':r'softgels?','Gummy':r'gummies','Oral strip':r'(?:oral\s+)?strips?'};unit_pattern=forms.get(entry.get('form'));counts=[]
  if unit_pattern:
   for value in pack_values:
    match=re.fullmatch(r'\s*(\d+)\s*('+unit_pattern+r')\s*',value,re.I)
    if match:counts.append(int(match[1]))
  if not isinstance(count,int) or isinstance(count,bool) or count<=0 or not counts or any(value!=count for value in counts):raise ValueError('Dukaan exact retail unit count and dosage form are not established.')
 prices=[]
 for child in selected:
  value=child.get('selling_price')
  try:price=Decimal(str(value))
  except (InvalidOperation,TypeError,ValueError):raise ValueError('Dukaan selected ordinary selling_price is invalid.')
  if isinstance(value,bool) or not price.is_finite() or price<=0 or not math.isfinite(float(price)):raise ValueError('Dukaan selected ordinary selling_price must be positive and finite.')
  prices.append(price)
 if prices[0]!=prices[1]:raise ValueError('Dukaan selected ordinary SKU prices conflict between public records.')
 stocks=[child.get('in_stock') for child in selected]
 if any(value is not None and not isinstance(value,bool) for value in stocks) or len({value for value in stocks if isinstance(value,bool)})>1:raise ValueError('Dukaan selected SKU availability is malformed or conflicting.')
 available=stocks[0] if all(isinstance(value,bool) for value in stocks) else None
 if any(product.get(key) is not None and not isinstance(product[key],bool) for key in ['in_stock','manual_out_of_stock']):raise ValueError('Dukaan parent availability is malformed.')
 if product.get('manual_out_of_stock') is True:available=False
 if product.get('in_stock') is False and available is True:raise ValueError('Dukaan parent availability contradicts the selected SKU.')
 return dict(id=vid,title=name+' / '+' / '.join(wanted.values()),price=float(prices[0]),available=available,currency='INR')

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

def nutrabay_product_variant(raw,entry):
 """Use only the exact selected Nutrabay product, never parent/range prices."""
 pid=str(entry.get('productId',''));vid=str(entry.get('variantId',''));sku=entry.get('variantSku')
 if not re.fullmatch(r'[1-9]\d*',pid) or not re.fullmatch(r'[1-9]\d*',vid) or not isinstance(sku,str) or not sku.strip():raise ValueError('Nutrabay needs explicit product, variant and SKU identities.')
 urls=[urlsplit(entry.get(key,'')) for key in ['productUrl','variantUrl']]
 for url in urls:
  query=parse_qs(url.query)
  if url.scheme!='https' or url.hostname not in ['nutrabay.com','www.nutrabay.com'] or url.username or url.password or not url.path.startswith('/product/') or query.get('pId')!=[pid] or query.get('vId')!=[vid]:raise ValueError('Nutrabay exact HTTPS product URL must retain one matching pId and vId.')
 reader=NextDataScript();reader.feed(raw)
 if len(reader.documents)!=1:raise ValueError('One unambiguous Nutrabay product document is required.')
 try:
  page=reader.documents[0]['props']['pageProps'];state=page['initialState']['parentProduct'];selected_response=state['getVariantDetails']['data'];parent_response=state['getParentDetails']['data'];selected=selected_response['data'];parent_data=parent_response['data'];parent=parent_data['parent_details']
 except (KeyError,TypeError):raise ValueError('Nutrabay selected variant data is missing.')
 if not isinstance(selected,dict) or not isinstance(parent,dict) or selected_response.get('status')!=1 or parent_response.get('status')!=1 or selected.get('status')!=4 or selected.get('freebie') is True:raise ValueError('Nutrabay selected product is not a published retail record.')
 if str(page.get('pId',''))!=pid or str(parent.get('parent_product_id',''))!=pid or str(selected.get('parent_product_id',''))!=pid or str(selected.get('variant_product_id',''))!=vid or selected.get('sku')!=sku:raise ValueError('Returned Nutrabay product, variant or SKU differs from the selected pack.')
 norm=lambda value:' '.join(str(value).split()).casefold()
 brand=entry.get('sourceBrand',entry.get('brand'))
 if not isinstance(brand,str) or not brand.strip() or any(norm(node.get('brand_name',''))!=norm(brand) for node in [selected,parent]):raise ValueError('Nutrabay source brand does not match the curated brand.')
 slug=selected.get('parent_slug')
 if not isinstance(slug,str) or not slug or parent.get('slug')!=slug or any(url.path.rstrip('/')!='/product/'+slug for url in urls):raise ValueError('Nutrabay URL slug does not match the selected parent product.')
 children=parent_data.get('variants',[]);matches=[child for child in children if isinstance(child,dict) and str(child.get('variant_id',''))==vid] if isinstance(children,list) else []
 if len(matches)!=1 or matches[0].get('sku')!=sku:raise ValueError('Nutrabay selected SKU is absent or ambiguous in the parent variant list.')
 wanted=entry.get('variantAttributes');attributes=selected.get('selected_swatch_values')
 if not isinstance(wanted,dict) or not wanted or not isinstance(attributes,dict) or set(wanted)!=set(attributes) or any(not isinstance(value,str) or not value.strip() or norm(value)!=norm(attributes[key]) for key,value in wanted.items()):raise ValueError('Every Nutrabay selected attribute must match the curated pack.')
 for url in urls:
  for key,values in parse_qs(url.query).items():
   if key.startswith('pa_') and (key not in attributes or len(values)!=1 or norm(values[0])!=norm(attributes[key])):raise ValueError('Nutrabay URL attributes disagree with the selected variant.')
 specifications=selected.get('specifications',[])
 if not isinstance(specifications,list):raise ValueError('Nutrabay pack specifications are malformed.')
 def masses(value):
  match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?)(?:\s*\([^)]*\))?\s*',str(value),re.I)
  return float(match[1])*(1000 if match[2].lower()=='kg' else 1) if match else None
 if entry.get('form')=='Powder':
  grams=entry.get('grams');spec_proof=[masses(s.get('value')) for s in specifications if isinstance(s,dict) and norm(s.get('label'))=='weight'];attribute_proof=[masses(value) for key,value in attributes.items() if key in ['pa_weight','pa_pack-size']];proof=[value for value in spec_proof+attribute_proof if value is not None]
  valid_grams=isinstance(grams,(int,float)) and not isinstance(grams,bool) and math.isfinite(grams) and grams>0
  # Some selected detail tables round kg to two decimals (174 g -> 0.17 kg).
  # Only a reviewed actual gram label plus the exact gram selector may resolve
  # that specific discrepancy; no pound conversion or shipping weight is used.
  if valid_grams and entry.get('specWeightIsRounded') is True:
   label_url=urlsplit(entry.get('netWeightEvidenceUrl',''));label_date=entry.get('netWeightEvidenceChecked','')
   try:date_valid=bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}',label_date)) and datetime.date.fromisoformat(label_date) is not None
   except (TypeError,ValueError):date_valid=False
   if label_url.scheme!='https' or not label_url.hostname or not date_valid or entry.get('netWeightEvidenceGrams')!=grams or not any(value is not None and abs(value-grams)<.001 for value in attribute_proof):raise ValueError('Rounded Nutrabay kg specification needs an exact selector and dated actual gram-label evidence.')
   proof=[value for value in attribute_proof if value is not None]+[value for value in spec_proof if value is not None and abs(value-round(grams/1000,2)*1000)>.001]
  if not valid_grams or not proof or any(not math.isfinite(value) or abs(value-grams)>.001 for value in proof):raise ValueError('Nutrabay exact net powder grams must match explicit selected pack weight, never rounded pounds.')
 else:
  count=entry.get('packCount');counts=[]
  source_forms=[norm(s.get('value')) for s in specifications if isinstance(s,dict) and norm(s.get('label'))=='form']
  allowed_forms={'Tablet':['tablet','tablets'],'Capsule':['capsule','capsules'],'Softgel':['softgel','softgels','capsule','capsules'],'Gummy':['gummy','gummies'],'Oral strip':['oral strip','oral strips','strip','strips']}.get(entry.get('form'),[])
  if source_forms and any(form not in allowed_forms for form in source_forms):raise ValueError('Nutrabay selected dosage form differs from the curated form.')
  for key,value in attributes.items():
   if key not in ['pa_pack-size','pa_quantity','pa_count']:continue
   match=re.fullmatch(r'\s*(\d+)\s*(caps?|capsules?|softgels?|tabs?|tablets?|gummies|strips?)\s*',value,re.I)
   if match:counts.append(int(match[1]))
   elif re.fullmatch(r'\d+',value.strip()) and source_forms:counts.append(int(value))
  if not isinstance(count,int) or isinstance(count,bool) or count<=0 or not counts or any(value!=count for value in counts):raise ValueError('Nutrabay exact retail unit count is not established.')
 currencies=[]
 def walk(node):
  if isinstance(node,list):
   for value in node:yield from walk(value)
  elif isinstance(node,dict):
   if 'priceCurrency' in node:yield node['priceCurrency']
   for value in node.values():
    if isinstance(value,(list,dict)):yield from walk(value)
 ld=JsonLdScripts();ld.feed(raw);currencies=list(walk(ld.documents))
 if any(currency!='INR' for currency in currencies) or not ('INR' in currencies or '₹' in raw or '&#8377;' in raw or '\\u20b9' in raw.lower()) or selected.get('currency') not in [None,'INR']:raise ValueError('Nutrabay selected price needs explicit INR evidence.')
 value=selected.get('sale_price')
 try:price=Decimal(str(value))
 except (InvalidOperation,TypeError,ValueError):raise ValueError('Nutrabay selected ordinary sale price is invalid.')
 if isinstance(value,bool) or not price.is_finite() or price<=0 or not math.isfinite(float(price)):raise ValueError('Nutrabay selected ordinary sale price must be positive and finite.')
 stock=selected.get('stock_status');available=stock if isinstance(stock,bool) else None
 return dict(id=vid,title=selected.get('name') or sku,price=float(price),available=available,currency='INR')

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
 reject_legacy_writer(root,'Direct save_refreshed_categories')
 data=root/'docs/data';config_path=data/'site.json'
 definitions=json.loads(config_path.read_text(encoding='utf-8'))['categories'] if config_path.exists() else []
 files={c['id']:c['file'] for c in definitions};pending=[]
 for category,offers in categories.items():
  if not offers:raise ValueError('No verified packs for '+category)
  filename=files.get(category,category+'.json')
  if not re.fullmatch(r'[a-z][a-z0-9-]*\.json',filename):raise ValueError('Unsafe category data filename.')
  target=data/filename;prior=json.loads(target.read_text(encoding='utf-8')) if target.exists() else dict(category=category,offers=[])
  if prior.get('category') not in [None,category]:raise ValueError('Existing category file belongs to another category.')
  prior.update(category=category,checked=as_of,offers=merge_refreshed_offers(prior['offers'],offers));pending.append((target,prior))
 # Validate every merge before writing any category.
 for target,payload in pending:
  target.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  print(payload['category'],len(payload['offers']),'offers',len({r['brand'] for r in payload['offers']}),'brands')

def _main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--as-of',required=True);parser.add_argument('--refresh',action='store_true');parser.add_argument('--categories',nargs='+',help='Refresh only these category IDs; the default is every category in the source manifest.');args=parser.parse_args();datetime.date.fromisoformat(args.as_of)
 manifest=json.loads((ROOT/'docs/data/additional-sources.json').read_text(encoding='utf-8'));cache=(OUTPUT_ROOT or ROOT)/'outputs'/('supplements_'+args.as_of.replace('-',''));cache.mkdir(exist_ok=True,parents=True)
 available=list(dict.fromkeys(e['category'] for e in manifest['products']));selected=args.categories or available
 if any(c not in available for c in selected):parser.error('Unknown category: '+', '.join(c for c in selected if c not in available))
 categories={c:[] for c in selected};observations=[];excluded=[]
 for entry in manifest['products']:
  if entry['category'] not in categories:continue
  kind=source_kind(entry)
  brand=entry['brand'];base=entry['base'];handle=entry.get('handle');url=entry.get('productUrl') or base+'/products/'+handle
  if kind in ['hk-product','nutrabay-product','dukaan-product']:
   raw_path=cache/(entry['cacheKey']+'.html');raw=get(url) if args.refresh or not raw_path.exists() else raw_path.read_text(encoding='utf-8');raw_path.write_text(raw,encoding='utf-8')
   variants=[{'hk-product':hk_product_variant,'nutrabay-product':nutrabay_product_variant,'dukaan-product':dukaan_product_variant}[kind](raw,entry)];evidence=url
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
    if kind not in ['jsonld','magento-configurable','hk-product','nutrabay-product','dukaan-product'] and not entry.get('variantIds') and not entry.get('variantTitles'):raise ValueError('Powder profile requires explicit variant selection so weight and flavour cannot leak across packs: '+url)
   elif not quantity:excluded.append(dict(url=url,variant=variant['id'],reason='Pack count not verified.'));continue
   row={k:v for k,v in entry.items() if k not in ['category','base','handle','variantTitles','variantIds','cacheKey','kind','id','numericVariantIsCount','allowRetailMultipack','productUrl','variantUrl','variantSku','variantId','variantOptions','productId','sourceBrand','variantAttributes','storeId','sourceStoreName','sourceProductName','variantCode']}
   row.update(id=entry.get('id') or f"{entry['category']}-{variant['id']}",product=entry['product'],packCount=quantity,price=float(variant['price']),currency='INR',stock='In stock' if variant.get('available') is True else 'Sold out' if variant.get('available') is False else 'Listed; confirm stock',url=url if entry.get('kind')=='html' else url+'?variant='+str(variant['id']),nutritionUrl=entry.get('nutritionUrl',url),flavour=entry.get('flavour','Unflavoured'),packaging=entry.get('packaging','Single retail pack'),labelChecked=entry.get('labelChecked',manifest['labelChecked']))
   if kind in ['jsonld','magento-configurable','hk-product','nutrabay-product','dukaan-product']:row['url']=entry['variantUrl']
   categories[entry['category']].append(row);observations.append(dict(category=entry['category'],offerId=row['id'],date=args.as_of,price=row['price'],currency='INR',sourceUrl=row['url'],evidenceUrl=evidence,kind='official-live',matchBasis='Official Dukaan exact store/product/SKU ID and UUID plus all selected attributes; ordinary INR selling_price, stock and actual retail net pack verified' if kind=='dukaan-product' else 'Nutrabay exact selected product/variant ID, SKU, brand and all attributes; ordinary INR sale price, stock and net retail pack verified' if kind=='nutrabay-product' else 'Public HK-platform exact published product/variant ID, source brand and all selected attributes; unconditional INR offer price and exact retail pack checked'+('; gram weight from separately reviewed selected-pack label, not rounded pounds' if entry.get('netWeightEvidenceUrl') else '') if kind=='hk-product' else 'Official Magento exact child ID and all attribute options; INR tax-inclusive child finalPrice and net pack weight checked; child stock unverified' if kind=='magento-configurable' else 'Official exact ProductGroup variant SKU and URL; pack weight checked' if kind=='jsonld' else 'Official primary product page and explicitly selected pack' if kind=='html' else 'Official Shopify exact variant ID; net powder grams verified' if powder else 'Official Shopify exact variant ID; retail-pack count verified',variantId=None if kind=='html' else str(variant['id'])))
 save_refreshed_categories(ROOT,categories,args.as_of)
 ledger_path=ROOT/'docs/data/price-observations.json';ledger=json.loads(ledger_path.read_text(encoding='utf-8'));merged={observation_key(r):r for r in ledger['observations']}
 merged.update({observation_key(r):r for r in observations});ledger.update(checked=max(ledger.get('checked',''),args.as_of),observations=list(merged.values()));ledger_path.write_text(json.dumps(ledger,ensure_ascii=False),encoding='utf-8')
 (cache/'excluded.json').write_text(json.dumps(excluded,indent=2),encoding='utf-8')

def main():
 global ROOT,OUTPUT_ROOT
 original_root,original_output=ROOT,OUTPUT_ROOT
 with artifact_workspace(original_root) as work:
  ROOT,OUTPUT_ROOT=work,original_output or original_root
  try:return _main()
  finally:ROOT,OUTPUT_ROOT=original_root,original_output

if __name__=='__main__':main()
