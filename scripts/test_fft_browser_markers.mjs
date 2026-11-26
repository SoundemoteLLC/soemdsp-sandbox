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
  await page.waitForFunction(()=>typeof nodeGraphModuleStoreEntries==='function'&&document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});
  const result=await page.evaluate(types=> {
    const entries=nodeGraphModuleStoreEntries();
    const rows=types.map(type=> {
      const entry=entries.find(e=>e.type===type);if(!entry)throw Error(type);
      const card=createNodeGraphModuleStoreButton(entry);
      return {type,emoji:card.querySelector('.scene-context-store-card-category').textContent,
        text:card.querySelector('strong').textContent,label:entry.label,title:nodeGraphNodeLabels[type]||entry.label,
        category:entry.category,expectedCategory:normalizeNodeGraphModuleStoreDepartment(nodeGraphModuleStoreCatalog[type].category)};
    });
    const plain=entries.find(e=>e.type==='polyBlep');
    const nature=nodeGraphEmojiCatalog.find(c=>c.id==='sky');
    return {rows,plain:createNodeGraphModuleStoreButton(plain).querySelector('.scene-context-store-card-category').textContent,nature};
  },["earlyReflectionConvolution","spectralFreeze","spectralSmear","spectralDelay","spectralBlur","spectralWarble","stftContrast","stftGate","convolutionResonator","noiseConvReverb","fftReconstruction","stftBlur","spectrogram","circularSpectrogram","spectrum1d"]);
  for(const row of result.rows) {
    assert.equal(row.emoji,'🌊',row.type);assert.equal(row.text,row.label);
    assert.ok(!row.text.includes('🌊')&&!row.title.includes('🌊'),'browser marker must not contaminate labels/titles');
    assert.equal(row.category,row.expectedCategory,'category remains unchanged');
  }
  assert.notEqual(result.plain,'🌊');assert.equal(result.nature.label,'Nature');assert.ok(result.nature.glyphs.includes('🌊'));
  console.log('14 FFT/STFT browser markers, unchanged categories/titles, normal-module icons, and Nature wave emoji pass.');
}finally{await browser.close();}
