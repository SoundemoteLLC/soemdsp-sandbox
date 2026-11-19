import assert from 'node:assert/strict';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
 await page.route('**/*',r=>r.request().method()==='GET'?r.continue():r.abort());
 await page.route(/node-live-audio-worklet-native-graph\.js/,async route=>{
  const response=await route.fetch();const probe=`
const originalDispersionQuantum=NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum=function(...args){
 const result=originalDispersionQuantum.apply(this,args);
 if(this.nativeGraph&&this.nativeGraphHandle&&this.nodes)for(const[id,n]of this.nodes){if(n.type!=='dispersion')continue;
  const h=this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle,this.fnv1aHash32(String(id)));
  this.dispersionTestFrames=(this.dispersionTestFrames||0)+1;
  if(this.dispersionTestFrames%32===0)this.port.postMessage({type:'test-dispersion',low:this.nativeGraph.soemdsp_dispersion_group_delay_ms(h,0,0),high:this.nativeGraph.soemdsp_dispersion_group_delay_ms(h,0,(this.engineSampleRate||sampleRate)*.5),error:this.nativeGraph.soemdsp_dispersion_error(h)});
 }return result;
};`;await route.fulfill({response,body:await response.text()+probe});
 });
 await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof showNodeGraphModule==='function'&&document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});await page.waitForTimeout(500);
 const id=await page.evaluate(()=>{const o={record:false,autosaveWorkingPatch:false,skipLivePlan:true},source=showNodeGraphModule('polyBlep',{x:20,y:40},o),dispersion=showNodeGraphModule('dispersion',{x:300,y:40},o);if(!source||!dispersion)throw Error('dispersion must spawn');
  const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);patch.nodes=patch.nodes.filter(n=>[source,dispersion].includes(n.id)||n.type==='output');patch.nodes.find(n=>n.id===source).params={waveform:1,frequency:220,amplitude:.05};const output=patch.nodes.find(n=>n.type==='output');
  patch.connections=[{sourceNode:source,sourcePort:'Wave',destinationNode:dispersion,destinationPort:'In'},{sourceNode:dispersion,sourcePort:'Left',destinationNode:output.id,destinationPort:'Left'},{sourceNode:dispersion,sourcePort:'Right',destinationNode:output.id,destinationPort:'Right'}];patch.modulations=[];commitNodeGraphPatch(patch,{status:'Dispersion test'});
  const plan=nodeGraphBuildLivePlan();if(plan.issues?.length)throw Error(JSON.stringify(plan.issues));return dispersion;
 });
 await page.evaluate(()=>setNodeGraphLiveOutputEnabled(true));await page.waitForFunction(()=>nodeGraphMvp.live.node,null,{timeout:30000});
 await page.evaluate(()=>{nodeGraphMvp.live.node.port.addEventListener('message',e=>{if(e.data?.type==='test-dispersion')window.testDispersion=e.data;});nodeGraphMvp.live.node.port.start();});
 await page.waitForFunction(()=>window.testDispersion?.low>window.testDispersion?.high&&nodeGraphMvp.live.outputLevelSmooth>1e-5,null,{timeout:30000});
 await page.evaluate(id=>updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'direction'),'High Late'),id);
 try {await page.waitForFunction(()=>window.testDispersion?.high>window.testDispersion?.low,null,{timeout:15000});}
 catch(e){console.log(await page.evaluate(id=>({probe:window.testDispersion,params:nodeGraphMvp.patch.nodes.find(n=>n.id===id)?.params,slider:nodeGraphSliderForParameter(id,'direction').value}),id));throw e;}
 await page.evaluate(id=>updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'stages'),'0'),id);
 await page.waitForFunction(()=>window.testDispersion?.high===0&&window.testDispersion?.low===0,null,{timeout:15000});
 await page.evaluate(id=>{updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'stages'),'32');updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'stereoOct'),'.5');},id);
 await page.waitForFunction(()=>window.testDispersion?.high>window.testDispersion?.low,null,{timeout:15000});assert.equal(await page.evaluate(()=>window.testDispersion.error),0);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});await page.evaluate(id=>{const b=nodeGraphSliderForParameter(id,'mix').closest('article').getBoundingClientRect(),area=document.getElementById('nodeGraphWorkspace').getBoundingClientRect();nodeGraphMvp.pan.x+=(innerWidth-b.width)/2-b.left;nodeGraphMvp.pan.y+=area.top+25-b.top;applyNodeGraphViewportCssLight();},id);await page.screenshot({path:path.join(os.tmpdir(),`dispersion-${width}.png`)});}
 assert.deepEqual(errors,[]);await page.evaluate(()=>setNodeGraphLiveOutputEnabled(false));console.log('Dispersion browser: native audio, real direction/count updates, stereo control and desktop/mobile GL pass.');
}finally{await browser.close();}
