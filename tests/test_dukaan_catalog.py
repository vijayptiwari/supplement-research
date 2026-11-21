"""Offline selected-SKU checks for public Dukaan JSON and refresh wiring."""
import copy
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

SPEC=importlib.util.spec_from_file_location('dukaan_importer',pathlib.Path(__file__).resolve().parents[1]/'scripts/build_additional_catalog.py')
IMPORTER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(IMPORTER)

class DukaanCatalogTests(unittest.TestCase):
 def setUp(self):
  base='https://example-brand.in';url=base+'/products/creatine?sku_id=101'
  self.profile=dict(kind='dukaan-product',base=base,productUrl=url,variantUrl=url,storeId='10',productId='20',variantId='101',variantSku='558eb51a-8638-4cbb-bd0b-02a764dea1fa',variantCode='BRAND100',sourceStoreName='Example Nutrition',sourceProductName='Example Creatine Monohydrate',brand='Example',form='Powder',grams=100,variantAttributes={'size':'100gm','Flavor':'Unflavoured'})
  currency={'cc':'INR','code':'INR','currency_code':'INR'}
  store=dict(id=10,name='Example Nutrition',custom_domain='example-brand.in',is_active=True,currency_code='INR',currency=currency)
  sku=dict(id=101,uuid=self.profile['variantSku'],sku_code='BRAND100',is_active=True,selling_price=299,in_stock=True,all_images=['https://dms.mydukaan.io/exact-label.jpg'],attributes=[{'master_attribute':'size','value':'100gm'},{'master_attribute':'Flavor','value':'Unflavoured'}],original_price=999,discounted_price=199)
  product=dict(id=20,name='Example Creatine Monohydrate',slug='creatine',store={'id':10,'currency':copy.deepcopy(currency)},is_active=True,product_type=1,product_bundle_type=None,product_skus=[sku],skus=[copy.deepcopy(sku)],selling_price=99,min_selling_price=99,max_selling_price=9999,in_stock=True,manual_out_of_stock=False)
  self.data=dict(DUKAAN_STORE=store,DUKAAN_PRODUCT=product,DUKAAN_CURRENT_PAGE_HOST='example-brand.in',CANONICAL_BASE_URL=base,CANONICAL_URL=base+'/products/creatine',CURRENT_URL=base+'/products/creatine')

 def html(self,data=None,online='true'):
  return '<html data-store-online="'+online+'"><script type="application/json" id="__DUKAAN_DATA__">'+json.dumps(self.data if data is None else data)+'</script></html>'

 def child_patch(self,**patch):
  data=copy.deepcopy(self.data)
  for key in ['product_skus','skus']:data['DUKAAN_PRODUCT'][key][0].update(copy.deepcopy(patch))
  return data

 def test_exact_child_selling_price_never_uses_parent_range_mrp_or_discount(self):
  parsed=IMPORTER.dukaan_product_variant(self.html(),self.profile)
  self.assertEqual(parsed['price'],299);self.assertTrue(parsed['available']);self.assertEqual(parsed['currency'],'INR');self.assertEqual(parsed['id'],'101')
  self.assertFalse(IMPORTER.dukaan_product_variant(self.html(self.child_patch(in_stock=False)),self.profile)['available'])

 def test_exact_numeric_ids_uuid_and_optional_merchant_code_are_required(self):
  for key,value in [('storeId','11'),('productId','21'),('variantId','102'),('variantSku','bad'),('variantSku','658eb51a-8638-4cbb-bd0b-02a764dea1fa'),('variantCode','OTHER')]:
   with self.subTest(key=key,value=value),self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(),dict(self.profile,**{key:value}))
  for key in ['product_skus','skus']:
   data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT'][key][0]['uuid']='658eb51a-8638-4cbb-bd0b-02a764dea1fa'
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['store']['id']=11
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_urls_pin_one_sku_on_exact_storefront_and_slug(self):
  for url in ['https://example-brand.in/products/creatine?variant=101','http://example-brand.in/products/creatine?sku_id=101','https://other.in/products/creatine?sku_id=101','https://example-brand.in/products/other?sku_id=101','https://example-brand.in/products/creatine','https://example-brand.in/products/creatine?sku_id=101&sku_id=102','https://example-brand.in/products/creatine?sku_id=101&coupon=SALE','https://user@example-brand.in/products/creatine?sku_id=101']:
   with self.subTest(url=url),self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(),dict(self.profile,variantUrl=url))
  for key,value in [('DUKAAN_CURRENT_PAGE_HOST','other.in'),('CANONICAL_BASE_URL','https://other.in'),('CANONICAL_URL','https://example-brand.in/products/other'),('CURRENT_URL','https://example-brand.in/products/creatine?sku_id=102')]:
   data=copy.deepcopy(self.data);data[key]=value
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_brand_store_and_full_source_product_names_must_agree(self):
  for patch in [dict(brand='Other'),dict(sourceStoreName='Other Nutrition'),dict(sourceProductName='Other Creatine')]:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(),dict(self.profile,**patch))
  data=copy.deepcopy(self.data);data['DUKAAN_STORE']['custom_domain']='other.in'
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_inactive_store_product_sku_and_offline_store_are_rejected(self):
  for field in ['DUKAAN_STORE','DUKAAN_PRODUCT']:
   for value in [False,None,'true']:
    data=copy.deepcopy(self.data);data[field]['is_active']=value
    with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  for value in [False,None,'true']:
   data=self.child_patch(is_active=value)
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  for value in ['false','', 'True']:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(online=value),self.profile)
  for value in [None,True,2]:
   data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['product_type']=value
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  # Hidden translated UI/template messages cannot override the real root state.
  self.assertTrue(IMPORTER.dukaan_product_variant(self.html()+'<template>not accepting orders; data-store-online="false"</template>',self.profile)['available'])

 def test_full_attributes_match_both_public_sku_records_without_duplicates(self):
  for attrs in [{},{'size':'100gm'},dict(self.profile['variantAttributes'],Flavor='Orange'),dict(self.profile['variantAttributes'],extra='x')]:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(),dict(self.profile,variantAttributes=attrs))
  for attrs in [[],None,[{'master_attribute':'size','value':'100gm'},{'master_attribute':'size','value':'250gm'}]]:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(self.child_patch(attributes=attrs)),self.profile)
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['skus'][0]['attributes'][0]['value']='250gm'
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_missing_duplicate_or_conflicting_selected_skus_never_fall_back(self):
  for key in ['product_skus','skus']:
   for values in [[],None,[self.data['DUKAAN_PRODUCT'][key][0]]*2]:
    data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT'][key]=values
    with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_powder_weight_requires_explicit_actual_size_not_shipping_or_pounds(self):
  for grams in [True,None,0,-1,float('nan'),250]:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(),dict(self.profile,grams=grams))
  attrs=[{'master_attribute':'size','value':'0.22lb'},{'master_attribute':'Flavor','value':'Unflavoured'}]
  data=self.child_patch(attributes=attrs,volumetric_weight=100)
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),dict(self.profile,variantAttributes={'size':'0.22lb','Flavor':'Unflavoured'}))

 def flavour_only(self):
  data=self.child_patch(attributes=[{'master_attribute':'Flavor','value':'Orange'}]);data['DUKAAN_PRODUCT']['name']='Example Creatine HCl (1Kg)'
  profile=dict(self.profile,sourceProductName=data['DUKAAN_PRODUCT']['name'],variantAttributes={'Flavor':'Orange'},grams=1000,netWeightEvidenceGrams=1000,netWeightEvidenceChecked='2026-11-20',netWeightEvidenceUrl='https://dms.mydukaan.io/exact-label.jpg')
  return data,profile

 def test_single_size_flavour_only_name_fallback_needs_dated_own_label(self):
  data,profile=self.flavour_only();self.assertEqual(IMPORTER.dukaan_product_variant(self.html(data),profile)['price'],299)
  for patch in [dict(netWeightEvidenceUrl='https://dms.mydukaan.io/other-sku-label.jpg'),dict(netWeightEvidenceUrl='http://dms.mydukaan.io/exact-label.jpg'),dict(netWeightEvidenceChecked='2026-02-30'),dict(netWeightEvidenceChecked='2999-01-01'),dict(netWeightEvidenceGrams=999),dict(grams=999),dict(netWeightEvidenceUrl={})]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),dict(profile,**patch))
  profile['netWeightEvidenceUrl']=profile['variantUrl'];self.assertEqual(IMPORTER.dukaan_product_variant(self.html(data),profile)['price'],299)

 def test_parent_name_cannot_supply_size_when_sibling_has_size_dimension(self):
  data,profile=self.flavour_only()
  for key in ['product_skus','skus']:
   sibling=copy.deepcopy(data['DUKAAN_PRODUCT'][key][0]);sibling['id']=102;sibling['attributes'].append({'master_attribute':'size','value':'500g'});data['DUKAAN_PRODUCT'][key].append(sibling)
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),profile)
  data,profile=self.flavour_only();data['DUKAAN_PRODUCT']['name']='Example 3g protein / 1kg pack';profile['sourceProductName']=data['DUKAAN_PRODUCT']['name']
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),profile)

 def test_unit_count_requires_explicit_unit_and_correct_dosage_form(self):
  data=self.child_patch(attributes=[{'master_attribute':'size','value':'60 Softgels'}]);profile=dict(self.profile,form='Softgel',packCount=60,variantAttributes={'size':'60 Softgels'})
  self.assertEqual(IMPORTER.dukaan_product_variant(self.html(data),profile)['price'],299)
  for patch in [dict(packCount=30),dict(packCount=True),dict(form='Tablet')]:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),dict(profile,**patch))

 def test_currency_and_finite_positive_ordinary_selling_prices_must_agree(self):
  for node,key in [('DUKAAN_STORE','currency_code')]:
   data=copy.deepcopy(self.data);data[node][key]='USD'
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['store']['currency']['code']='USD'
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  for value in [None,True,0,-1,'NaN','Infinity','1e9999','299-499']:
   with self.subTest(value=value),self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(self.child_patch(selling_price=value)),self.profile)
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['skus'][0]['selling_price']=199
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_availability_is_never_inferred_from_parent_or_add_to_cart(self):
  self.assertIsNone(IMPORTER.dukaan_product_variant(self.html(self.child_patch(in_stock=None)),self.profile)['available'])
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['skus'][0].pop('in_stock')
  self.assertIsNone(IMPORTER.dukaan_product_variant(self.html(data),self.profile)['available'])
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['skus'][0]['in_stock']=False
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)
  for value in ['true',1,{}]:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(self.child_patch(in_stock=value)),self.profile)
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['manual_out_of_stock']=True
  self.assertFalse(IMPORTER.dukaan_product_variant(self.html(data),self.profile)['available'])
  data=copy.deepcopy(self.data);data['DUKAAN_PRODUCT']['in_stock']=False
  with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(self.html(data),self.profile)

 def test_missing_invalid_or_duplicate_inert_json_is_rejected(self):
  for raw in ['<html>Missing</html>',self.html()+self.html(),self.html().replace('application/json','text/javascript'),'<html data-store-online="true"><script type="application/json" id="__DUKAAN_DATA__">not JSON</script></html>']:
   with self.assertRaises(ValueError):IMPORTER.dukaan_product_variant(raw,self.profile)
  self.assertEqual(IMPORTER.source_kind(self.profile),'dukaan-product')
  with self.assertRaises(ValueError):IMPORTER.source_kind(dict(kind='unsupported-dukaan'))

 def test_refresh_wiring_preserves_other_offers_dates_identity_and_source_url(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);data=root/'docs/data';data.mkdir(parents=True)
   profile=dict(self.profile,category='creatine',id='exact',product='Creatine',cacheKey='dukaan-101',labelChecked='2026-11-20')
   (data/'additional-sources.json').write_text(json.dumps({'labelChecked':'2026-11-19','products':[profile]}),encoding='utf-8');(data/'price-observations.json').write_text(json.dumps({'observations':[]}),encoding='utf-8');(data/'site.json').write_text(json.dumps({'categories':[{'id':'creatine','file':'creatine.json'}]}),encoding='utf-8')
   other={'id':'other','brand':'Other brand','price':123};(data/'creatine.json').write_text(json.dumps({'category':'creatine','offers':[other]}),encoding='utf-8')
   with mock.patch.object(IMPORTER,'ROOT',root),mock.patch.object(IMPORTER,'get',return_value=self.html()) as get,mock.patch('sys.argv',['importer','--as-of','2026-11-20','--refresh']),contextlib.redirect_stdout(io.StringIO()):IMPORTER.main()
   get.assert_called_once_with(profile['productUrl']);rows=json.loads((data/'creatine.json').read_text(encoding='utf-8'))['offers'];self.assertIn(other,rows);row=next(r for r in rows if r['id']=='exact')
   self.assertEqual(row['url'],profile['variantUrl']);self.assertEqual(row['price'],299);self.assertEqual(row['stock'],'In stock');self.assertEqual(row['labelChecked'],'2026-11-20')
   for field in ['kind','variantAttributes','variantSku','storeId','sourceStoreName','sourceProductName','variantCode']:self.assertNotIn(field,row)
   observation=json.loads((data/'price-observations.json').read_text(encoding='utf-8'))['observations'][0];self.assertEqual(observation['variantId'],'101');self.assertEqual(observation['sourceUrl'],profile['variantUrl']);self.assertIn('Official Dukaan exact',observation['matchBasis'])

if __name__=='__main__':unittest.main()
