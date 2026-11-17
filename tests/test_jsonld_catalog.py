"""Exact SKU/URL matching for official non-Shopify product families."""
import copy
import importlib.util
import json
import pathlib
import unittest

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/build_additional_catalog.py'
SPEC=importlib.util.spec_from_file_location('jsonld_catalog',SCRIPT)
IMPORTER=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)

class JsonLdCatalogTests(unittest.TestCase):
 def setUp(self):
  self.profile=dict(variantSku='BETA-250',variantUrl='https://example.org/product/beta/?vId=250',variantId='250',form='Powder',grams=250)
  def variant(sku,weight,price,status):
   return dict(sku=sku,name='Beta-alanine '+str(weight)+' g',weight=dict(unitCode='GRM',value=weight),offers=dict(url='https://example.org/product/beta/?vId='+str(weight),priceCurrency='INR',price=str(price),availability='https://schema.org/'+status))
  self.group={'@type':'ProductGroup','offers':dict(price=1,priceCurrency='INR'),'hasVariant':[variant('BETA-100',100,249,'OutOfStock'),variant('BETA-250',250,599,'InStock')]}

 def html(self,group=None):
  return '<script type="application/ld+json">'+json.dumps([group or self.group])+'</script>'

 def test_exact_pack_price_and_stock_ignore_default_and_other_pack(self):
  actual=IMPORTER.jsonld_variant(self.html(),self.profile)
  self.assertEqual(actual['price'],599)
  self.assertTrue(actual['available'])
  self.assertEqual(actual['id'],'250')
  profile=dict(self.profile,variantSku='BETA-100',variantUrl='https://example.org/product/beta/?vId=100',variantId='100',grams=100)
  actual=IMPORTER.jsonld_variant(self.html(),profile)
  self.assertEqual(actual['price'],249)
  self.assertFalse(actual['available'])

 def test_sku_and_url_both_must_match(self):
  for changes in [dict(variantSku='MISSING'),dict(variantUrl='https://example.org/product/beta/'),dict(variantSku='BETA-100')]:
   with self.assertRaisesRegex(ValueError,'missing or conflicting'):
    IMPORTER.jsonld_variant(self.html(),dict(self.profile,**changes))

 def test_currency_weight_zero_price_and_conflicts_fail_closed(self):
  for field,value in [('priceCurrency','USD'),('price','0'),('price','NaN')]:
   group=copy.deepcopy(self.group);group['hasVariant'][1]['offers'][field]=value
   with self.assertRaises(ValueError):IMPORTER.jsonld_variant(self.html(group),self.profile)
  with self.assertRaisesRegex(ValueError,'weight differs'):
   IMPORTER.jsonld_variant(self.html(),dict(self.profile,grams=100))
  group=copy.deepcopy(self.group);duplicate=copy.deepcopy(group['hasVariant'][1]);duplicate['offers']['price']='999';group['hasVariant'].append(duplicate)
  with self.assertRaisesRegex(ValueError,'missing or conflicting'):
   IMPORTER.jsonld_variant(self.html(group),self.profile)

 def test_missing_unknown_unit_and_nonfinite_weights_fail_closed(self):
  for weight in [None,{},dict(unitCode='UNKNOWN',value=250),dict(unitCode='GRM',value='NaN'),dict(unitCode='GRM',value='Infinity'),dict(unitCode='GRM',value=0),dict(unitCode='GRM')]:
   group=copy.deepcopy(self.group);group['hasVariant'][1]['weight']=weight
   with self.assertRaisesRegex(ValueError,'weight'):
    IMPORTER.jsonld_variant(self.html(group),self.profile)

if __name__=='__main__':unittest.main()
