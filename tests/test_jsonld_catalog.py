"""Exact SKU/URL matching for official non-Shopify product families."""
import copy
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

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

class MagentoCatalogTests(unittest.TestCase):
 def setUp(self):
  self.profile=dict(kind='magento-configurable',category='taurine',brand='Example',base='https://example.org',productUrl='https://example.org/taurine',variantUrl='https://example.org/taurine?super_attribute%5B140%5D=8&super_attribute%5B181%5D=76',variantId='47',variantOptions={'140':'8','181':'76'},form='Powder',grams=100,servingGrams=2,product='Taurine',id='taurine-example-47',cacheKey='taurine')
  self.config=dict(template='₹ #{price}',basePrice='1',oldPrice='9999',isAvailable=True,attributes={
   '140':dict(code='size',options=[dict(id='8',label='100g',products=['47','48']),dict(id='12',label='250g',products=['100','101'])]),
   '181':dict(code='flavor',options=[dict(id='76',label='Unflavored',products=['47','100']),dict(id='17',label='Orange',products=['48','101'])])
  },taxConfig=dict(includeTax=True,showIncludeTax=True,showBothPrices=False),childProducts={'47':dict(price='449',finalPrice='279'),'48':dict(price='500',finalPrice='299'),'100':dict(price='749',finalPrice='469'),'101':dict(price='800',finalPrice='499')})

 def html(self,config=None):
  return '<script>var spConfig=new Product.Config('+json.dumps(self.config if config is None else config)+');</script>'

 def test_exact_child_price_ignores_family_default_and_does_not_inherit_stock(self):
  actual=IMPORTER.magento_configurable_variant(self.html(),self.profile)
  self.assertEqual(actual['id'],'47');self.assertEqual(actual['price'],279)
  self.assertEqual(actual['title'],'100g / Unflavored');self.assertEqual(actual['currency'],'INR')
  self.assertIsNone(actual['available']);self.assertTrue(actual['taxInclusive'])
  profile=dict(self.profile,variantId='100',variantOptions={'140':'12','181':'76'},grams=250,variantUrl='https://example.org/taurine?super_attribute%5B140%5D=12&super_attribute%5B181%5D=76')
  self.assertEqual(IMPORTER.magento_configurable_variant(self.html(),profile)['price'],469)

 def test_all_options_and_one_exact_child_are_required(self):
  for options in [{},{'140':'8'},{'140':'8','181':'missing'},{'140':'8','181':'76','999':'1'}]:
   with self.assertRaises(ValueError):IMPORTER.magento_configurable_variant(self.html(),dict(self.profile,variantOptions=options))
  with self.assertRaisesRegex(ValueError,'intended child'):
   IMPORTER.magento_configurable_variant(self.html(),dict(self.profile,variantId='48'))
  ambiguous=copy.deepcopy(self.config);ambiguous['attributes']['181']['options'][0]['products']=['47','48','100']
  with self.assertRaisesRegex(ValueError,'intended child'):
   IMPORTER.magento_configurable_variant(self.html(ambiguous),self.profile)
  duplicate=copy.deepcopy(self.config);duplicate['attributes']['140']['options'].append(copy.deepcopy(duplicate['attributes']['140']['options'][0]))
  with self.assertRaisesRegex(ValueError,'ambiguous'):
   IMPORTER.magento_configurable_variant(self.html(duplicate),self.profile)

 def test_non_inr_and_unclear_tax_basis_are_rejected(self):
  for template in ['$ #{price}','EUR #{price}','₹ #{price} USD','#{price}']:
   config=copy.deepcopy(self.config);config['template']=template
   with self.assertRaisesRegex(ValueError,'INR'):IMPORTER.magento_configurable_variant(self.html(config),self.profile)
  for tax in [{},{'includeTax':False,'showIncludeTax':True},{'includeTax':True,'showIncludeTax':False},{'includeTax':True,'showIncludeTax':True,'showBothPrices':True}]:
   config=copy.deepcopy(self.config);config['taxConfig']=tax
   with self.assertRaisesRegex(ValueError,'tax-inclusive'):IMPORTER.magento_configurable_variant(self.html(config),self.profile)

 def test_missing_invalid_or_zero_child_price_never_uses_family_price(self):
  for price in [None,'0','-1','NaN','Infinity','not a price','1e1000']:
   config=copy.deepcopy(self.config);config['childProducts']['47']['finalPrice']=price
   with self.assertRaises(ValueError):IMPORTER.magento_configurable_variant(self.html(config),self.profile)
  config=copy.deepcopy(self.config);del config['childProducts']['47']
  with self.assertRaisesRegex(ValueError,'child price'):IMPORTER.magento_configurable_variant(self.html(config),self.profile)

 def test_pack_weight_and_shareable_variant_url_must_match_the_chosen_options(self):
  for grams in [None,0,True,99,float('nan')]:
   with self.assertRaises(ValueError):IMPORTER.magento_configurable_variant(self.html(),dict(self.profile,grams=grams))
  for url in ['https://other.example/taurine?super_attribute%5B140%5D=8&super_attribute%5B181%5D=76','https://example.org/taurine','https://example.org/taurine?super_attribute%5B140%5D=12&super_attribute%5B181%5D=76','https://example.org/taurine?super_attribute%5B140%5D=8&super_attribute%5B181%5D=76&super_attribute%5B181%5D=17']:
   with self.assertRaises(ValueError):IMPORTER.magento_configurable_variant(self.html(),dict(self.profile,variantUrl=url))
  config=copy.deepcopy(self.config);config['attributes']['140']['options'][0]['label']='100 servings'
  with self.assertRaisesRegex(ValueError,'net weight'):IMPORTER.magento_configurable_variant(self.html(config),self.profile)

 def test_malformed_or_multiple_configurations_are_not_executed_or_guessed(self):
  for raw in ['<html>No configurable data</html>','new Product.Config(not_json)','new Product.Config({"template": ()=>"₹"})',self.html()+self.html()]:
   with self.assertRaises(ValueError):IMPORTER.magento_configurable_variant(raw,self.profile)

 def test_importer_writes_exact_url_observation_and_unknown_stock_without_provider_selectors(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);data=root/'docs/data';data.mkdir(parents=True)
   (data/'additional-sources.json').write_text(json.dumps(dict(labelChecked='2026-11-19',products=[self.profile])),encoding='utf-8')
   (data/'price-observations.json').write_text(json.dumps(dict(checked='2026-11-18',observations=[])),encoding='utf-8')
   with mock.patch.object(IMPORTER,'ROOT',root),mock.patch.object(IMPORTER,'get',return_value=self.html()) as fetch,mock.patch('sys.argv',['importer','--as-of','2026-11-19','--refresh']),contextlib.redirect_stdout(io.StringIO()):
    IMPORTER.main();fetch.assert_called_once_with(self.profile['productUrl'])
   offer=json.loads((data/'taurine.json').read_text(encoding='utf-8'))['offers'][0]
   self.assertEqual(offer['id'],self.profile['id']);self.assertEqual(offer['price'],279)
   self.assertEqual(offer['url'],self.profile['variantUrl']);self.assertEqual(offer['stock'],'Listed; confirm stock')
   for field in ['variantOptions','variantId','variantUrl','productUrl','kind','cacheKey']:
    self.assertNotIn(field,offer)
   observation=json.loads((data/'price-observations.json').read_text(encoding='utf-8'))['observations'][0]
   self.assertEqual(observation['variantId'],'47');self.assertEqual(observation['sourceUrl'],self.profile['variantUrl']);self.assertEqual(observation['evidenceUrl'],self.profile['productUrl'])
   self.assertIn('child stock unverified',observation['matchBasis'])

 def test_unknown_provider_is_rejected_before_network_or_catalog_write(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);data=root/'docs/data';data.mkdir(parents=True)
   profile=dict(self.profile,kind='unsupported-provider')
   (data/'additional-sources.json').write_text(json.dumps(dict(labelChecked='2026-11-19',products=[profile])),encoding='utf-8')
   with mock.patch.object(IMPORTER,'ROOT',root),mock.patch.object(IMPORTER,'get') as fetch,mock.patch('sys.argv',['importer','--as-of','2026-11-19','--refresh']):
    with self.assertRaisesRegex(ValueError,'Unsupported product source kind'):IMPORTER.main()
    fetch.assert_not_called()
   self.assertFalse((data/'taurine.json').exists())

if __name__=='__main__':unittest.main()
