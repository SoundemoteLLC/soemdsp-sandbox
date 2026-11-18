import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
 await page.route('**/*',r=>r.request().method()==='GET'?r.continue():r.abort());
 await page.route(/node-live-audio-worklet-native-graph\.js/,async route=>{
  const response=await route.fetch();const probe=`
const originalMaterialQuantum=NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum=function(...args){
 const result=originalMaterialQuantum.apply(this,args);
 if(this.nativeGraph&&this.nativeGraphHandle&&this.nodes)for(const[id,n]of this.nodes){
  if(n.type!=='materialResonator')continue;
  const h=this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle,this.fnv1aHash32(String(id)));
  this.materialTestFrames=(this.materialTestFrames||0)+1;
  if(this.materialTestFrames%32===0)this.port.postMessage({type:'test-material',f:this.nativeGraph.soemdsp_material_resonator_mode_frequency(h,0),second:this.nativeGraph.soemdsp_material_resonator_mode_frequency(h,1),error:this.nativeGraph.soemdsp_material_resonator_error(h)});
 }return result;
};`;await route.fulfill({response,body:await response.text()+probe});
 });
 await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof showNodeGraphModule==='function'&&document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});await page.waitForTimeout(500);
 const ids=await page.evaluate(()=>{
  const o={record:false,autosaveWorkingPatch:false,skipLivePlan:true};
  const source=showNodeGraphModule('polyBlep',{x:20,y:40},o),material=showNodeGraphModule('materialResonator',{x:300,y:40},o);if(!source||!material)throw Error('material must be spawnable');
  const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);patch.nodes=patch.nodes.filter(n=>[source,material].includes(n.id)||n.type==='output');
  patch.nodes.find(n=>n.id===source).params={waveform:1,frequency:220,amplitude:.1};const output=patch.nodes.find(n=>n.type==='output');
  patch.connections=[{sourceNode:source,sourcePort:'Wave',destinationNode:material,destinationPort:'In'},
   {sourceNode:material,sourcePort:'Left',destinationNode:output.id,destinationPort:'Left'},
   {sourceNode:material,sourcePort:'Right',destinationNode:output.id,destinationPort:'Right'}];
  patch.modulations=[];commitNodeGraphPatch(patch,{status:'Material test'});const plan=nodeGraphBuildLivePlan();if(plan.issues?.length)throw Error(JSON.stringify(plan.issues));return{source,material};
 });
 const parked=await page.evaluate(()=> {
  const def=nodeGraphModuleDefinitions.materialResonator;
  return ['structureAspect','dampingCurve','modalDisplay'].map(key=> {
   const p=def.parameters.find(p=>p.key===key);
   return {key,visible:nodeGraphParameterDefaultVisible(p),modulation:p.modulation,output:p.parameterOutput,tooltip:p.tooltip,
     widget:def.face.some(row=>(row.params||[]).some(cell=>cell[0]===key))};
  });
 });
 for(const p of parked){assert.equal(p.visible,false);assert.equal(p.modulation,false);assert.equal(p.output,false);assert.equal(p.widget,false);assert.match(p.tooltip,/inactive/i);}
 if(process.argv.includes('--metadata-only')) {
  assert.deepEqual(errors,[]);console.log('Material placeholders: hidden defaults, inactive tooltips, no face widgets or modulation/output ports pass.');
 } else {
 await page.evaluate(()=>setNodeGraphLiveOutputEnabled(true));await page.waitForFunction(()=>nodeGraphMvp.live.node,null,{timeout:30000});
 await page.evaluate(()=>{nodeGraphMvp.live.node.port.addEventListener('message',e=>{if(e.data?.type==='test-material')window.testMaterial=e.data;});nodeGraphMvp.live.node.port.start();});
 await page.waitForFunction(()=>Math.abs((window.testMaterial?.f||0)-220)<.01&&nodeGraphMvp.live.outputLevelSmooth>1e-5,null,{timeout:30000});
 await page.evaluate(id=>{updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'frequency'),'440');updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'material'),'glass');},ids.material);
 await page.waitForFunction(()=>Math.abs((window.testMaterial?.f||0)-440)<.01&&Math.abs((window.testMaterial?.second||0)-440*3.02)<.1,null,{timeout:15000});
 assert.equal(await page.evaluate(()=>window.testMaterial.error),0);
 for(const width of [1280,390]) {
  await page.setViewportSize({width,height:900});await page.evaluate(id=>{const b=nodeGraphSliderForParameter(id,'mix').closest('article').getBoundingClientRect(),area=document.getElementById('nodeGraphWorkspace').getBoundingClientRect();nodeGraphMvp.pan.x+=(innerWidth-b.width)/2-b.left;nodeGraphMvp.pan.y+=area.top+25-b.top;applyNodeGraphViewportCssLight();},ids.material);
  await page.screenshot({path:path.join(os.tmpdir(),`material-resonator-${width}.png`)});
 }
 assert.deepEqual(errors,[]);await page.evaluate(()=>setNodeGraphLiveOutputEnabled(false));console.log('Material browser: native audio, real frequency/material edits, clean GL desktop/mobile and no page errors pass.');
 }
}finally{await browser.close();}
