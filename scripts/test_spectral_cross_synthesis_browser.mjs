import assert from 'node:assert/strict';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_FAILED')console.log('request failed',r.url(),r.failure()?.errorText);});
 // Keep this local server's small connection backlog from dropping the worklet burst.
 let requestQueue=Promise.resolve();
 await page.route('**/*',route=>{
  if(route.request().method()!=='GET')return route.abort();
  const response=requestQueue.then(async()=>route.fulfill({response:await route.fetch()}));
  requestQueue=response.catch(()=>{});return response;
 });
 await page.route(/node-live-audio-worklet-native-graph\.js/,async route=>{
  const response=await route.fetch();const probe=`
const originalCrossQuantum=NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum=function(...args){
 const result=originalCrossQuantum.apply(this,args);
 if(this.nativeGraph&&this.nativeGraphHandle&&this.nodes)for(const[id,n]of this.nodes){
  if(n.type!=='spectralCrossSynthesis')continue;
  const h=this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle,this.fnv1aHash32(String(id)));
  this.crossTestFrames=(this.crossTestFrames||0)+1;
  if(this.crossTestFrames%32===0)this.port.postMessage({type:'test-cross',fft:this.nativeGraph.soemdsp_spectral_cross_synthesis_fft_size(h),error:this.nativeGraph.soemdsp_spectral_cross_synthesis_error(h)});
 }return result;
};`;
  await route.fulfill({response,body:await response.text()+probe});
 });
 await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});await page.waitForTimeout(500);
 const id=await page.evaluate(()=>{
  const o={record:false,autosaveWorkingPatch:false,skipLivePlan:true},voice=showNodeGraphModule('polyBlep',{x:20,y:40},o),synth=showNodeGraphModule('polyBlep',{x:20,y:350},o),cross=showNodeGraphModule('spectralCrossSynthesis',{x:350,y:40},o);
  if(!voice||!synth||!cross)throw Error('spawn failed');
  const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);patch.nodes=patch.nodes.filter(n=>[voice,synth,cross].includes(n.id)||n.type==='output');
  patch.nodes.find(n=>n.id===voice).params={waveform:1,frequency:110,amplitude:.05};
  patch.nodes.find(n=>n.id===synth).params={waveform:1,frequency:220,amplitude:.05};
  const output=patch.nodes.find(n=>n.type==='output');
  patch.connections=[{sourceNode:voice,sourcePort:'Wave',destinationNode:cross,destinationPort:'Voice L'},{sourceNode:synth,sourcePort:'Wave',destinationNode:cross,destinationPort:'Synth L'},
   {sourceNode:cross,sourcePort:'Left',destinationNode:output.id,destinationPort:'Left'},{sourceNode:cross,sourcePort:'Right',destinationNode:output.id,destinationPort:'Right'}];
  patch.modulations=[];commitNodeGraphPatch(patch,{status:'Cross-synthesis test'});
  const plan=nodeGraphBuildLivePlan();if(plan.issues?.length)throw Error(JSON.stringify(plan.issues));return cross;
 });
 await page.evaluate(()=>setNodeGraphLiveOutputEnabled(true));
 await page.waitForFunction(()=>nodeGraphMvp.live.node&&nodeGraphMvp.live.outputLevelSmooth>1e-5,null,{timeout:30000});
 await page.evaluate(()=>{nodeGraphMvp.live.node.port.addEventListener('message',e=>{if(e.data?.type==='test-cross')window.testCross=e.data;});nodeGraphMvp.live.node.port.start();});
 await page.waitForFunction(()=>window.testCross?.fft===2048,null,{timeout:15000});
 for(const size of [16384,512]){
  await page.evaluate(({id,size})=>updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'fftSize'),String(size)),{id,size});
  await page.waitForFunction(size=>window.testCross?.fft===size,size,{timeout:15000});
 }
 await page.evaluate(id=>{updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'widthHz'),'1000');updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'releaseMs'),'200');updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'formantShift'),'12');},id);
 await page.waitForTimeout(1000);
 assert.ok(await page.evaluate(()=>nodeGraphMvp.live.outputLevelSmooth>1e-5));
 assert.equal(await page.evaluate(()=>window.testCross.error),0);
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(id=>{const b=nodeGraphSliderForParameter(id,'mix').closest('article').getBoundingClientRect(),area=document.getElementById('nodeGraphWorkspace').getBoundingClientRect();nodeGraphMvp.pan.x+=(innerWidth-b.width)/2-b.left;nodeGraphMvp.pan.y+=area.top+25-b.top;applyNodeGraphViewportCssLight();},id);
  await page.screenshot({path:path.join(os.tmpdir(),'spectral-cross-synthesis-'+width+'.png')});
 }
 assert.deepEqual(errors,[]);await page.evaluate(()=>setNodeGraphLiveOutputEnabled(false));
 console.log('Spectral Cross-Synthesis browser: live native audio, controls and desktop/mobile face pass.');
} finally {await browser.close();}
