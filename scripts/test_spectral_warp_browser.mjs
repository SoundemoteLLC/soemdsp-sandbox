import assert from 'node:assert/strict';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 let requestQueue=Promise.resolve();
 await page.route('**/*',route=>{
  if(route.request().method()!=='GET')return route.abort();
  const response=requestQueue.then(async()=>route.fulfill({response:await route.fetch()}));
  requestQueue=response.catch(()=>{});return response;
 });
 await page.route(/node-live-audio-worklet-native-graph\.js/,async route=>{
  const response=await route.fetch();const probe=`
const originalWarpQuantum=NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum=function(...args){
 const result=originalWarpQuantum.apply(this,args);
 if(this.nativeGraph&&this.nativeGraphHandle&&this.nodes)for(const[id,n]of this.nodes){
  if(n.type!=='spectralWarp')continue;
  const h=this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle,this.fnv1aHash32(String(id)));
  this.warpTestFrames=(this.warpTestFrames||0)+1;
  if(this.warpTestFrames%32===0)this.port.postMessage({type:'test-warp',fft:this.nativeGraph.soemdsp_spectral_warp_fft_size(h),error:this.nativeGraph.soemdsp_spectral_warp_error(h)});
 }return result;
};`;
  await route.fulfill({response,body:await response.text()+probe});
 });
 await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});await page.waitForTimeout(500);
 const id=await page.evaluate(()=>{
  const rows=nodeGraphModuleDefinitions.spectralWarp.face.map(row=>row.params.map(p=>p[0]));
  if(JSON.stringify(rows)!==JSON.stringify([['fftSize'],['warp','pivotHz'],['pitchSemitones','shiftHz','stereoShiftHz'],['mix','gainDb']]))throw Error('control row layout');
  const o={record:false,autosaveWorkingPatch:false,skipLivePlan:true},source=showNodeGraphModule('polyBlep',{x:20,y:40},o),warp=showNodeGraphModule('spectralWarp',{x:300,y:40},o);
  if(!source||!warp)throw Error('spawn failed');
  const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);patch.nodes=patch.nodes.filter(n=>[source,warp].includes(n.id)||n.type==='output');
  patch.nodes.find(n=>n.id===source).params={waveform:1,frequency:220,amplitude:.05};const output=patch.nodes.find(n=>n.type==='output');
  patch.connections=[{sourceNode:source,sourcePort:'Wave',destinationNode:warp,destinationPort:'In'},
   {sourceNode:warp,sourcePort:'Left',destinationNode:output.id,destinationPort:'Left'},
   {sourceNode:warp,sourcePort:'Right',destinationNode:output.id,destinationPort:'Right'}];
  patch.modulations=[];commitNodeGraphPatch(patch,{status:'Spectral Warp test'});
  if(nodeGraphDefaultModuleGridWidthUnits('spectralWarp')!==7)throw Error('spawn width');
  const plan=nodeGraphBuildLivePlan();if(plan.issues?.length)throw Error(JSON.stringify(plan.issues));return warp;
 });
 await page.evaluate(()=>setNodeGraphLiveOutputEnabled(true));
 await page.waitForFunction(()=>nodeGraphMvp.live.node&&nodeGraphMvp.live.outputLevelSmooth>1e-5,null,{timeout:30000});
 await page.evaluate(()=>{nodeGraphMvp.live.node.port.addEventListener('message',e=>{if(e.data?.type==='test-warp')window.testWarp=e.data;});nodeGraphMvp.live.node.port.start();});
 await page.waitForFunction(()=>window.testWarp?.fft===1024,null,{timeout:15000});
 await page.evaluate(id=>{
  for(const[key,value]of Object.entries({pitchSemitones:'12',stereoShiftHz:'80',shiftHz:'100',warp:'1.2'}))updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,key),value);
 },id);
 for(const size of [16384,512]){
  await page.evaluate(({id,size})=>updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'fftSize'),String(size)),{id,size});
  await page.waitForFunction(size=>window.testWarp?.fft===size,size,{timeout:15000});
 }
 await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>window.testWarp.error),0);
 assert.ok(await page.evaluate(()=>nodeGraphMvp.live.outputLevelSmooth>1e-5));
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(id=>{
   const b=nodeGraphSliderForParameter(id,'mix').closest('article').getBoundingClientRect(),area=document.getElementById('nodeGraphWorkspace').getBoundingClientRect();
   nodeGraphMvp.pan.x+=(innerWidth-b.width)/2-b.left;nodeGraphMvp.pan.y+=area.top+25-b.top;applyNodeGraphViewportCssLight();
  },id);await page.screenshot({path:path.join(os.tmpdir(),'spectral-warp-'+width+'.png')});
 }
 assert.deepEqual(errors,[]);await page.evaluate(()=>setNodeGraphLiveOutputEnabled(false));
 console.log('Spectral Warp browser: Pitch/Stereo controls, FFT handoff, native audio and 7 GU desktop/mobile GL face pass.');
}finally{await browser.close();}
