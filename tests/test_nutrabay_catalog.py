"""Offline exact selected-variant checks for Nutrabay's public SSR records."""
import copy
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

SPEC=importlib.util.spec_from_file_location('nutrabay_importer',pathlib.Path(__file__).resolve().parents[1]/'scripts/build_additional_catalog.py')
IMPORTER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(IMPORTER)

class NutrabayCatalogTests(unittest.TestCase):
 def setUp(self):
  url='https://nutrabay.com/product/pure-creatine?pId=1903618&vId=4334621'
  self.profile=dict(kind='nutrabay-product',productUrl=url,variantUrl=url,productId='1903618',variantId='4334621',variantSku='NB-NUT-1009-01',brand='Nutrabay',form='Powder',grams=250,variantAttributes={'pa_flavour':'Unflavoured','pa_weight':'250 g (0.55 lb)'})
  self.selected=dict(variant_product_id=4334621,parent_product_id=1903618,sku='NB-NUT-1009-01',parent_slug='pure-creatine',brand_name='Nutrabay',name='Pure Creatine 250 g',status=4,freebie=False,sale_price='549',regular_price='849',combo_price='449',stock_status=True,selected_swatch_values=copy.deepcopy(self.profile['variantAttributes']),specifications=[{'label':'Weight','value':'0.25 kg'},{'label':'Form','value':'Powder'}])
  self.parent=dict(parent_details=dict(parent_product_id=1903618,brand_name='Nutrabay',slug='pure-creatine',vid=999,min_sale_price='100',redirection_url='https://nutrabay.com/product/unrelated-pea'),variants=[dict(variant_id=4334621,sku='NB-NUT-1009-01',sale_price='500')])

 def html(self,selected=None,parent=None,currency='INR',page_pid='1903618'):
  state={'getVariantDetails':{'data':{'status':1,'data':self.selected if selected is None else selected}},'getParentDetails':{'data':{'status':1,'data':self.parent if parent is None else parent}}}
  page={'props':{'pageProps':{'pId':page_pid,'initialState':{'parentProduct':state}}}}
  return '<script id="__NEXT_DATA__">'+json.dumps(page)+'</script><script type="application/ld+json">'+json.dumps({'@type':['Product','DietarySupplement'],'offers':{'priceCurrency':currency}})+'</script>'

 def test_selected_price_and_stock_never_use_parent_range_child_list_or_combo(self):
  result=IMPORTER.nutrabay_product_variant(self.html(),self.profile)
  self.assertEqual(result,dict(id='4334621',title='Pure Creatine 250 g',price=549,available=True,currency='INR'))
  self.assertFalse(IMPORTER.nutrabay_product_variant(self.html(dict(self.selected,stock_status=False)),self.profile)['available'])
  self.assertIsNone(IMPORTER.nutrabay_product_variant(self.html(dict(self.selected,stock_status=None)),self.profile)['available'])

 def test_exact_product_variant_sku_and_brand_are_required(self):
  for patch in [dict(parent_product_id=1),dict(variant_product_id=1),dict(sku='other'),dict(brand_name='Other')]:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(dict(self.selected,**patch)),self.profile)
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(page_pid='1'),self.profile)
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(parent=dict(self.parent,parent_details={**self.parent['parent_details'],'brand_name':'Other'})),self.profile)

 def test_url_must_pin_selected_identity_on_the_correct_storefront_and_slug(self):
  for url in ['http://nutrabay.com/product/pure-creatine?pId=1903618&vId=4334621','https://unrelated.example/product/pure-creatine?pId=1903618&vId=4334621','https://nutrabay.com/product/pure-creatine?pId=1903618','https://nutrabay.com/product/pure-creatine?pId=1903618&vId=1','https://nutrabay.com/product/pure-creatine?pId=1903618&vId=4334621&vId=1','https://nutrabay.com/product/unrelated-pea?pId=1903618&vId=4334621']:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(),dict(self.profile,productUrl=url))

 def test_missing_selected_record_never_falls_back_to_complete_parent_children(self):
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected={}),self.profile)
  parent=copy.deepcopy(self.parent);parent['variants'].append(parent['variants'][0])
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(parent=parent),self.profile)
  parent['variants']=[]
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(parent=parent),self.profile)

 def test_inactive_or_freebie_records_do_not_become_current_prices(self):
  for patch in [dict(status=0),dict(status='4'),dict(status=None),dict(freebie=True)]:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(dict(self.selected,**patch)),self.profile)

 def test_full_formulation_flavour_and_size_attributes_are_matched(self):
  for attributes in [{},{'pa_flavour':'Unflavoured'},dict(self.profile['variantAttributes'],pa_flavour='Orange'),dict(self.profile['variantAttributes'],extra='other')]:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(),dict(self.profile,variantAttributes=attributes))
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(),dict(self.profile,variantUrl=self.profile['variantUrl']+'&pa_flavour=Orange'))

 def test_weight_is_exact_grams_not_serving_count_or_rounded_pounds(self):
  for grams in [100,True,0,None,float('nan')]:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(),dict(self.profile,grams=grams))
  selected=copy.deepcopy(self.selected);selected['specifications']=[{'label':'Number of Servings','value':'80'}];selected['selected_swatch_values']['pa_weight']='0.55 lb'
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected),dict(self.profile,variantAttributes=selected['selected_swatch_values']))
  selected=copy.deepcopy(self.selected);selected['specifications'][0]['value']='0.5 kg'
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected),self.profile)

 def test_rounded_kg_detail_requires_exact_gram_selector_and_reviewed_label(self):
  selected=copy.deepcopy(self.selected);selected['specifications'][0]['value']='0.17 kg';selected['selected_swatch_values']['pa_weight']='174 g (0.38 lb)'
  profile=dict(self.profile,grams=174,variantAttributes=selected['selected_swatch_values'],specWeightIsRounded=True,netWeightEvidenceUrl='https://cdn2.nutrabay.com/selected-174g-label.png',netWeightEvidenceGrams=174,netWeightEvidenceChecked='2026-11-20')
  self.assertEqual(IMPORTER.nutrabay_product_variant(self.html(selected),profile)['price'],549)
  for patch in [dict(specWeightIsRounded=False),dict(netWeightEvidenceGrams=170),dict(netWeightEvidenceUrl='http://example.org/label.png'),dict(netWeightEvidenceChecked='bad')]:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected),dict(profile,**patch))
  selected['specifications'][0]['value']='0.2 kg'
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected),profile)

 def test_unit_count_requires_explicit_count_or_numeric_pack_with_form(self):
  selected=dict(self.selected,selected_swatch_values={'pa_pack-size':'60 Caps'},specifications=[{'label':'Form','value':'Capsules'}]);profile=dict(self.profile,form='Capsule',packCount=60,variantAttributes=selected['selected_swatch_values'])
  self.assertEqual(IMPORTER.nutrabay_product_variant(self.html(selected),profile)['price'],549)
  selected['selected_swatch_values']={'pa_pack-size':'60'};profile['variantAttributes']=selected['selected_swatch_values']
  self.assertEqual(IMPORTER.nutrabay_product_variant(self.html(selected),profile)['price'],549)
  for changes in [dict(packCount=30),dict(packCount=True),dict(form='Tablet')]:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected),dict(profile,**changes))
  selected['specifications']=[]
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(selected),profile)

 def test_currency_and_positive_unconditional_price_are_required(self):
  with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(currency='USD'),self.profile)
  for value in [None,True,0,-1,'NaN','Infinity','1e9999','499-999']:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(self.html(dict(self.selected,sale_price=value)),self.profile)

 def test_duplicate_or_invalid_json_is_never_executed(self):
  for raw in ['<script id="__NEXT_DATA__">not_json</script>',self.html()+self.html(),'<html>Missing</html>']:
   with self.assertRaises(ValueError):IMPORTER.nutrabay_product_variant(raw,self.profile)

 def test_refresh_wiring_keeps_exact_url_dates_and_unrelated_offers(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);data=root/'docs/data';data.mkdir(parents=True)
   profile=dict(self.profile,base='https://nutrabay.com',category='creatine',id='exact',product='Pure Creatine',cacheKey='selected-creatine',labelChecked='2026-11-20')
   (data/'additional-sources.json').write_text(json.dumps({'labelChecked':'2026-11-19','products':[profile]}),encoding='utf-8')
   (data/'price-observations.json').write_text(json.dumps({'observations':[]}),encoding='utf-8')
   (data/'site.json').write_text(json.dumps({'categories':[{'id':'creatine','file':'creatine.json'}]}),encoding='utf-8')
   other={'id':'other-brand','brand':'Other brand','price':123};(data/'creatine.json').write_text(json.dumps({'category':'creatine','offers':[other]}),encoding='utf-8')
   with mock.patch.object(IMPORTER,'ROOT',root),mock.patch.object(IMPORTER,'get',return_value=self.html()),mock.patch('sys.argv',['importer','--as-of','2026-11-20','--refresh']),contextlib.redirect_stdout(io.StringIO()):IMPORTER.main()
   rows=json.loads((data/'creatine.json').read_text(encoding='utf-8'))['offers'];self.assertIn(other,rows);row=next(r for r in rows if r['id']=='exact')
   self.assertEqual(row['url'],profile['variantUrl']);self.assertEqual(row['price'],549);self.assertEqual(row['labelChecked'],'2026-11-20');self.assertNotIn('variantAttributes',row)
   observation=json.loads((data/'price-observations.json').read_text(encoding='utf-8'))['observations'][0];self.assertIn('Nutrabay exact selected',observation['matchBasis']);self.assertEqual(observation['variantId'],'4334621')

if __name__=='__main__':unittest.main()
