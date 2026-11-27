import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const types=["earlyReflectionConvolution","spectralFreeze","dispersion","spectralCrossSynthesis","spectralWarp","materialResonator","spectralSmear","spectralDelay","spectralBlur","spectralWarble","spectralContrast","spectralGate","convolutionResonator","noiseConvReverb","fftReconstruction","stftBlur","spectrum1d","vocoder"];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();
 await page.route('**/*',r=>r.request().method()==='GET'?r.continue():r.abort());
 await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});
 const result=await page.evaluate(types=>({
  widths:types.map(type=>[type,nodeGraphDefaultModuleGridWidthUnits(type)]),
  savedWidths:types.map(type=>nodeGraphPatchNodeGridWidthUnits({type,widthGu:13})),
  spectrogram:nodeGraphModuleDefinitions.spectrogram.defaultWidthGu,
  circularSpectrogram:nodeGraphModuleDefinitions.circularSpectrogram.defaultWidthGu
 }),types);
 for(const[type,width]of result.widths)assert.equal(width,7,type+' spawn width');
 for(const width of result.savedWidths)assert.equal(width,13,'saved patch width must survive');
 assert.equal(result.spectrogram,12);assert.equal(result.circularSpectrogram,12);
 console.log('Spectral spawn widths: '+types.length+' modules at 7 GU; both Spectrogram defaults unchanged.');
}finally{await browser.close();}
