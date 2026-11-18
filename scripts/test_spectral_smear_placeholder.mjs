import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
let chromium;
try {({chromium}=await import('playwright'));}
catch {({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();
  await page.route('**/*',r=>r.request().method()==='GET'?r.continue():r.abort());
  await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof showNodeGraphModule==='function'&&document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});
  const result=await page.evaluate(()=>({
    listed:nodeGraphModuleStoreTypesList().includes('spectralSmear'),
    category:nodeGraphModuleStoreCatalog.spectralSmear.category,
    label:nodeGraphNodeLabels.spectralSmear,
    note:nodeGraphModuleConstructionPlans.spectralSmear,
    parked:nodeGraphModuleTypeIsUnderConstruction('spectralSmear'),
    definition:nodeGraphModuleDefinitions.spectralSmear,
    spawn:showNodeGraphModule('spectralSmear',{x:20,y:20}),
  }));
  assert.equal(result.listed,true);assert.equal(result.category,'space');assert.equal(result.label,'Spectral Smear');
  assert.equal(result.note,'pre and post ringing smear');assert.equal(result.parked,true);assert.ok(!result.spawn);
  assert.deepEqual(result.definition.inputs,[]);assert.deepEqual(result.definition.outputs,[]);assert.deepEqual(result.definition.parameters,[]);
  console.log('Spectral Smear is listed, marked under construction with the requested note, and cannot spawn fake DSP.');
}finally{await browser.close();}
