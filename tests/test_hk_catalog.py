"""Fail-closed selection of HK-platform public product JSON (no network)."""
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/build_additional_catalog.py'
SPEC=importlib.util.spec_from_file_location('hk_catalog',SCRIPT)
IMPORTER=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)

class HKCatalogTests(unittest.TestCase):
 def setUp(self):
  self.profile=dict(kind='hk-product',category='collagen',brand='HK Vitals',sourceBrand='HK Vitals',base='https://www.hkvitals.com',productUrl='https://www.hkvitals.com/products/skin-radiance-collagen',variantUrl='https://www.hkvitals.com/sv/hk-vitals-collagen/SP-99764?navKey=VRNT-185734',productId='99764',variantId='185734',variantAttributes={'veg-nveg-vnsc':'Marine Collagen','fn-att-quant':'200 g','spc-att-flvr':'Orange'},form='Powder',grams=200,product='Skin Radiance Collagen',id='collagen-hkv-185734',cacheKey='hkv-collagen')
  self.product=dict(id=185734,navKey='VRNT-185734',sp_id=99764,brName='HK Vitals',brand=[dict(nm='HealthKart')],isPublish=True,is_published=True,nm='Skin Radiance Collagen, Marine Collagen 200 g Orange',selAttr1=copy.deepcopy(self.profile['variantAttributes']),offer_pr=799,reg_offer_pr=999,mrp=1499,oos=False,hkUserLoyaltyPricingDto=dict(hkPremiumOfferPrice=699,hkSelectOfferPrice=599),availVar={
   'marine;100;orange':dict(sv_id=234963,oos=True,offer_pr=519,fullName='HK Vitals Skin Radiance Collagen, Marine Collagen 100 g Orange',attrKeyVsValue={'veg-nveg-vnsc':'Marine Collagen','fn-att-quant':'100 g','spc-att-flvr':'Orange'}),
   'veg;200;orange':dict(sv_id=246331,oos=False,offer_pr=1179,fullName='HK Vitals Skin Radiance Collagen, Veg Collagen 200 g Orange',attrKeyVsValue={'veg-nveg-vnsc':'Veg Collagen','fn-att-quant':'200 g','spc-att-flvr':'Orange'})})

 def html(self,product=None,shape='hkv',currency='₹'):
  selected=self.product if product is None else product
  page={'reviewData':selected} if shape=='hkv' else {'data':{'results':selected}}
  return '<p>'+currency+'</p><script id="__NEXT_DATA__" type="application/json">'+json.dumps({'props':{'pageProps':page}})+'</script>'

 def test_selected_exact_product_uses_own_price_and_stock_not_family_or_membership(self):
  for shape in ['hkv','marketplace']:
   actual=IMPORTER.hk_product_variant(self.html(shape=shape),self.profile)
   self.assertEqual(actual,dict(id='185734',title=self.product['nm'],price=799,available=True,currency='INR'))
  product=copy.deepcopy(self.product);product['oos']=True
  self.assertFalse(IMPORTER.hk_product_variant(self.html(product),self.profile)['available'])
  del product['oos']
  self.assertIsNone(IMPORTER.hk_product_variant(self.html(product),self.profile)['available'])

 def test_selected_brand_and_product_id_cannot_match_related_or_wrong_product(self):
  for changes in [dict(brName='Other Brand'),dict(brName='HealthKart'),dict(sp_id=123),dict(navKey='VRNT-234963')]:
   product=dict(self.product,**changes)
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),self.profile)
  # The marketplace operator in product.brand is deliberately not the brand.
  self.assertEqual(IMPORTER.hk_product_variant(self.html(),self.profile)['price'],799)

 def test_unpublished_missing_or_conflicting_publication_does_not_retain_stale_price(self):
  for flags in [{},{'isPublish':False,'is_published':False},{'isPublish':True,'is_published':False},{'isPublish':'true'}]:
   product={key:value for key,value in self.product.items() if key not in ['isPublish','is_published']};product.update(flags)
   with self.assertRaisesRegex(ValueError,'published'):IMPORTER.hk_product_variant(self.html(product),self.profile)
  product=dict(self.product,isPublish=None,is_published=True)
  self.assertEqual(IMPORTER.hk_product_variant(self.html(product),self.profile)['price'],799)

 def test_every_attribute_must_match_including_collagen_source_and_flavour(self):
  for attributes in [{},{'fn-att-quant':'200 g'},dict(self.profile['variantAttributes'],**{'veg-nveg-vnsc':'Veg Collagen'}),dict(self.profile['variantAttributes'],**{'spc-att-flvr':'Lemon'}),dict(self.profile['variantAttributes'],unexpected='option')]:
   with self.assertRaisesRegex(ValueError,'Every HK variant attribute'):IMPORTER.hk_product_variant(self.html(),dict(self.profile,variantAttributes=attributes))
  product=dict(self.product,selAttr1={},selAttr=self.product['selAttr1'])
  with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),self.profile)

 def test_exact_family_child_can_supply_its_own_complete_price_and_stock(self):
  profile=dict(self.profile,variantId='234963',variantUrl='https://www.hkvitals.com/sv/hk-vitals-collagen/SP-99764?navKey=VRNT-234963',grams=100,variantAttributes={'veg-nveg-vnsc':'Marine Collagen','fn-att-quant':'100 g','spc-att-flvr':'Orange'})
  actual=IMPORTER.hk_product_variant(self.html(),profile)
  self.assertEqual(actual['id'],'234963');self.assertEqual(actual['price'],519);self.assertFalse(actual['available'])
  for field in ['offer_pr','attrKeyVsValue']:
   product=copy.deepcopy(self.product);del product['availVar']['marine;100;orange'][field]
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),profile)
  product=copy.deepcopy(self.product);product['availVar']['marine;100;orange']['is_published']=False
  with self.assertRaisesRegex(ValueError,'unpublished'):IMPORTER.hk_product_variant(self.html(product),profile)

 def test_ignored_explicit_navkey_is_rejected_even_if_child_exists(self):
  profile=dict(self.profile,productUrl='https://www.hkvitals.com/sv/hk-vitals-collagen/SP-99764?navKey=VRNT-234963',variantUrl='https://www.hkvitals.com/sv/hk-vitals-collagen/SP-99764?navKey=VRNT-234963',variantId='234963',grams=100,variantAttributes={'veg-nveg-vnsc':'Marine Collagen','fn-att-quant':'100 g','spc-att-flvr':'Orange'})
  with self.assertRaisesRegex(ValueError,'navKey was ignored'):IMPORTER.hk_product_variant(self.html(),profile)

 def test_missing_and_conflicting_family_children_are_rejected(self):
  profile=dict(self.profile,variantId='234963',variantUrl='https://www.hkvitals.com/sv/hk-vitals-collagen/SP-99764?navKey=VRNT-234963',grams=100,variantAttributes={'veg-nveg-vnsc':'Marine Collagen','fn-att-quant':'100 g','spc-att-flvr':'Orange'})
  product=copy.deepcopy(self.product);product['availVar']={}
  with self.assertRaisesRegex(ValueError,'absent or ambiguous'):IMPORTER.hk_product_variant(self.html(product),profile)
  product=copy.deepcopy(self.product);product['availVar']['duplicate']=dict(product['availVar']['marine;100;orange'],offer_pr=499)
  with self.assertRaisesRegex(ValueError,'absent or ambiguous'):IMPORTER.hk_product_variant(self.html(product),profile)

 def test_https_storefront_shareable_navkey_and_sp_id_are_checked(self):
  for changes in [dict(productUrl='http://www.hkvitals.com/products/skin-radiance-collagen'),dict(productUrl='https://other.example/products/skin-radiance-collagen'),dict(variantUrl='https://www.healthkart.com/sv/hk-vitals-collagen/SP-99764?navKey=VRNT-185734'),dict(variantUrl='https://www.hkvitals.com/sv/hk-vitals-collagen/SP-99764'),dict(variantUrl=self.profile['variantUrl']+'&navKey=VRNT-234963'),dict(variantUrl=self.profile['variantUrl'].replace('SP-99764','SP-99999')),dict(variantId='VRNT-185734'),dict(productId=0)]:
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(),dict(self.profile,**changes))

 def test_grams_are_matched_exactly_not_defaulted_or_scaled(self):
  for grams in [100,0,True,float('nan'),None]:
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(),dict(self.profile,grams=grams))
  product=copy.deepcopy(self.product);product['selAttr1']['fn-att-quant']='0.2 kg'
  profile=dict(self.profile,variantAttributes=product['selAttr1'])
  self.assertEqual(IMPORTER.hk_product_variant(self.html(product),profile)['price'],799)
  product['selAttr1']['fn-att-quant']='0.44 lb'
  with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),dict(profile,variantAttributes=product['selAttr1']))

 def test_rounded_pounds_require_independently_reviewed_selected_label_grams(self):
  product=copy.deepcopy(self.product);product['selAttr1']['fn-att-quant']='0.44 lb'
  profile=dict(self.profile,variantAttributes=product['selAttr1'],packSizeLabel='0.44 lb',netWeightEvidenceUrl='https://img2.hkrtcdn.com/example/selected-label.jpg',netWeightEvidenceGrams=200,netWeightEvidenceChecked='2026-11-19')
  self.assertEqual(IMPORTER.hk_product_variant(self.html(product),profile)['price'],799)
  for changes in [dict(packSizeLabel='0.22 lb'),dict(netWeightEvidenceUrl='http://img2.hkrtcdn.com/label.jpg'),dict(netWeightEvidenceGrams=100),dict(netWeightEvidenceGrams=True),dict(netWeightEvidenceChecked='20261119'),dict(netWeightEvidenceChecked='2026-02-30')]:
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),dict(profile,**changes))

 def test_unit_counts_and_forms_are_exact_not_amount_per_dose(self):
  product=dict(self.product,nm='Glutathione 600 mg, 15 tablet(s)',selAttr1={'fn-att-quant':'15 tablet(s)'})
  profile=dict(self.profile,form='Tablet',packCount=15,variantAttributes=product['selAttr1']);profile.pop('grams')
  self.assertEqual(IMPORTER.hk_product_variant(self.html(product),profile)['price'],799)
  for changes in [dict(packCount=30),dict(packCount=True),dict(packCount=0),dict(form='Capsule')]:
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),dict(profile,**changes))

 def test_price_requires_positive_finite_unconditional_offer_field(self):
  for value in [None,0,-1,'NaN','Infinity','1e9999',True]:
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(dict(self.product,offer_pr=value)),self.profile)
  product=copy.deepcopy(self.product);del product['offer_pr']
  with self.assertRaises(ValueError):IMPORTER.hk_product_variant(self.html(product),self.profile)

 def test_currency_needs_public_evidence_and_rejects_conflicts(self):
  with self.assertRaisesRegex(ValueError,'INR'):IMPORTER.hk_product_variant(self.html(currency='$'),self.profile)
  with self.assertRaisesRegex(ValueError,'INR'):IMPORTER.hk_product_variant(self.html(dict(self.product,currency='USD')),self.profile)
  for currency in ['INR','USD']:
   html=self.html(currency='')+'<script type="application/ld+json">'+json.dumps({'@type':['Product','DietarySupplement'],'offers':{'priceCurrency':currency,'price':799}})+'</script>'
   if currency=='INR':self.assertEqual(IMPORTER.hk_product_variant(html,self.profile)['price'],799)
   else:
    with self.assertRaisesRegex(ValueError,'INR'):IMPORTER.hk_product_variant(html,self.profile)

 def test_malformed_duplicate_or_ambiguous_documents_are_not_executed(self):
  for raw in ['<html>none</html>','<script id="__NEXT_DATA__">not_json</script>','<script id="__NEXT_DATA__">'+json.dumps({'props':{'pageProps':[]}})+'</script>',self.html()+self.html()]:
   with self.assertRaises(ValueError):IMPORTER.hk_product_variant(raw,self.profile)
  data={'props':{'pageProps':{'reviewData':self.product,'data':{'results':self.product}}}}
  with self.assertRaisesRegex(ValueError,'unambiguous'):IMPORTER.hk_product_variant('<script id="__NEXT_DATA__">'+json.dumps(data)+'</script>',self.profile)

 def test_importer_writes_selected_url_evidence_and_strips_provider_selectors(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);data=root/'docs/data';data.mkdir(parents=True)
   (data/'additional-sources.json').write_text(json.dumps(dict(labelChecked='2026-11-19',products=[self.profile])),encoding='utf-8')
   (data/'price-observations.json').write_text(json.dumps(dict(checked='2026-11-18',observations=[])),encoding='utf-8')
   with mock.patch.object(IMPORTER,'ROOT',root),mock.patch.object(IMPORTER,'get',return_value=self.html()) as fetch,mock.patch('sys.argv',['importer','--as-of','2026-11-19','--refresh']),contextlib.redirect_stdout(io.StringIO()):
    IMPORTER.main();fetch.assert_called_once_with(self.profile['productUrl'])
   offer=json.loads((data/'collagen.json').read_text(encoding='utf-8'))['offers'][0]
   self.assertEqual(offer['id'],self.profile['id']);self.assertEqual(offer['price'],799)
   self.assertEqual(offer['url'],self.profile['variantUrl']);self.assertEqual(offer['stock'],'In stock')
   for field in ['variantAttributes','variantId','variantUrl','productUrl','kind','cacheKey','productId','sourceBrand']:
    self.assertNotIn(field,offer)
   observation=json.loads((data/'price-observations.json').read_text(encoding='utf-8'))['observations'][0]
   self.assertEqual(observation['variantId'],'185734');self.assertEqual(observation['sourceUrl'],self.profile['variantUrl']);self.assertEqual(observation['evidenceUrl'],self.profile['productUrl'])
   self.assertIn('unconditional INR',observation['matchBasis'])

 def test_partial_refresh_retains_other_brands_quotes_and_configured_protein_filename(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);data=root/'docs/data';data.mkdir(parents=True)
   (data/'site.json').write_text(json.dumps({'categories':[{'id':'protein','file':'catalog.json'}]}),encoding='utf-8')
   old={'category':'protein','checked':'2026-11-18','offers':[{'id':'existing','brand':'Existing','price':900,'retailerQuotes':[{'price':850}]},{'id':'other-brand','brand':'Other','price':1000}]}
   (data/'catalog.json').write_text(json.dumps(old),encoding='utf-8')
   with contextlib.redirect_stdout(io.StringIO()):IMPORTER.save_refreshed_categories(root,{'protein':[{'id':'existing','brand':'Existing','price':950},{'id':'new','brand':'New','price':500}]},'2026-11-20')
   saved=json.loads((data/'catalog.json').read_text(encoding='utf-8'));rows={r['id']:r for r in saved['offers']}
   self.assertEqual(set(rows),{'existing','other-brand','new'});self.assertEqual(rows['existing']['price'],950)
   self.assertEqual(rows['existing']['retailerQuotes'],[{'price':850}]);self.assertEqual(rows['other-brand'],old['offers'][1]);self.assertFalse((data/'protein.json').exists())

 def test_conflicting_duplicate_refresh_cannot_write_a_partial_category(self):
  with self.assertRaisesRegex(ValueError,'Conflicting refreshes'):IMPORTER.merge_refreshed_offers([], [{'id':'same','price':1},{'id':'same','price':2}])

 def test_price_evidence_identity_retains_distinct_metadata_and_nested_provenance(self):
  original={'offerId':'same','price':799,'matchBasis':'Original review','proof':{'variant':'1','pack':'200 g'}}
  revised={**original,'matchBasis':'Later corroboration'}
  self.assertNotEqual(IMPORTER.observation_key(original),IMPORTER.observation_key(revised))
  reordered={'proof':{'pack':'200 g','variant':'1'},'matchBasis':'Original review','price':799,'offerId':'same'}
  self.assertEqual(IMPORTER.observation_key(original),IMPORTER.observation_key(reordered))
  self.assertNotEqual(IMPORTER.observation_key(original),IMPORTER.observation_key({**original,'proof':{'variant':'2','pack':'200 g'}}))

if __name__=='__main__':unittest.main()
