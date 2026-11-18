import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
let chromium;
try {({chromium}=await import('playwright'));}
catch {({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
  await page.route('**/*',r=>r.request().method()==='GET'?r.continue():r.abort());
  await page.route(/node-live-audio-worklet-native-graph\.js/,async route=> {
    const response=await route.fetch();
    const probe=`
const originalDelayQuantum=NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum=function(...args) {
 const result=originalDelayQuantum.apply(this,args);
 if(this.nativeGraph&&this.nativeGraphHandle&&this.nodes)for(const [id,n]of this.nodes) {
  if(n.type!=='spectralDelay')continue;
  const h=this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle,this.fnv1aHash32(String(id)));
  const size=this.nativeGraph.soemdsp_spectral_delay_fft_size(h),busy=this.nativeGraph.soemdsp_spectral_delay_busy(h);
  const error=this.nativeGraph.soemdsp_spectral_delay_error(h),capacity=this.nativeGraph.soemdsp_spectral_delay_max_delay_ms(h);
  const low=this.nativeGraph.soemdsp_spectral_delay_bin_delay_ms(h,0),high=this.nativeGraph.soemdsp_spectral_delay_bin_delay_ms(h,size/2);
  this.testDelayFrames=(this.testDelayFrames||0)+1;
  if(this.testDelayFrames%32===0)this.port.postMessage({type:'test-delay',size,busy,error,capacity,low,high});
 }
 return result;
};`;
    await route.fulfill({response,body:await response.text()+probe});
  });
  await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof showNodeGraphModule==='function'&&document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});
  await page.waitForTimeout(500);
  const ids=await page.evaluate(()=> {
    const o={record:false,autosaveWorkingPatch:false,skipLivePlan:true};
    const source=showNodeGraphModule('polyBlep',{x:20,y:40},o),delay=showNodeGraphModule('spectralDelay',{x:300,y:40},o);
    if(!source||!delay)throw Error('Spectral Delay must be spawnable');
    const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes=patch.nodes.filter(n=>[source,delay].includes(n.id)||n.type==='output');
    patch.nodes.find(n=>n.id===source).params={waveform:1,frequency:187.5,amplitude:.05};
    const output=patch.nodes.find(n=>n.type==='output');
    patch.connections=[{sourceNode:source,sourcePort:'Wave',destinationNode:delay,destinationPort:'In'},
      {sourceNode:delay,sourcePort:'Left',destinationNode:output.id,destinationPort:'Left'},
      {sourceNode:delay,sourcePort:'Right',destinationNode:output.id,destinationPort:'Right'}];
    patch.modulations=[];commitNodeGraphPatch(patch,{status:'Spectral delay test'});
    const plan=nodeGraphBuildLivePlan();if(plan.issues?.length)throw Error(JSON.stringify(plan.issues));return {source,delay};
  });
  await page.evaluate(()=>setNodeGraphLiveOutputEnabled(true));
  await page.waitForFunction(()=>nodeGraphMvp.live.node,null,{timeout:30000});
  await page.evaluate(()=>{nodeGraphMvp.live.node.port.addEventListener('message',e=>{if(e.data?.type==='test-delay')window.testDelay=e.data;});nodeGraphMvp.live.node.port.start();});
  await page.waitForFunction(()=>window.testDelay?.size===4096&&!window.testDelay.busy&&nodeGraphMvp.live.outputLevelSmooth>1e-5,null,{timeout:30000});
  await page.evaluate(id=>{updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'baseDelayMs'),'40');updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'spreadMs'),'-100');},ids.delay);
  await page.waitForFunction(()=>window.testDelay?.low>139&&window.testDelay?.high<41,null,{timeout:15000});
  for(const size of [512,16384,4096]) {
    await page.evaluate(({id,size})=>updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'fftSize'),String(size)),{id:ids.delay,size});
    await page.waitForFunction(n=>window.testDelay?.size===n&&!window.testDelay.busy,size,{timeout:20000});
    assert.equal(await page.evaluate(()=>window.testDelay.error),0);
  }
  assert.ok(await page.evaluate(()=>window.testDelay.capacity)>10000);
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(id=>{const b=nodeGraphSliderForParameter(id,'mix').closest('article').getBoundingClientRect(),area=document.getElementById('nodeGraphWorkspace').getBoundingClientRect();nodeGraphMvp.pan.x+=(innerWidth-b.width)/2-b.left;nodeGraphMvp.pan.y+=area.top+25-b.top;applyNodeGraphViewportCssLight();},ids.delay);
    await page.screenshot({path:path.join(os.tmpdir(),`spectral-delay-${width}.png`)});
  }
  assert.deepEqual(errors,[]);await page.evaluate(()=>setNodeGraphLiveOutputEnabled(false));
  console.log('Spectral Delay browser: native audio, signed spread from UI, actual FFT handoffs/capacity and desktop/mobile GL pass.');
}finally{await browser.close();}
