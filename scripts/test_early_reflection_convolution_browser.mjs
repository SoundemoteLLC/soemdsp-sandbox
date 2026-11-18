import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
let chromium;
try { ({chromium}=await import('playwright')); }
catch { ({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright')); }
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error') console.log(m.text());});
  await page.route('**/*',r=>r.request().method()==='GET' ? r.continue():r.abort());
  await page.route(/node-live-audio-worklet-native-graph\.js/,async route=> {
    const response=await route.fetch();
    const probe=`
const originalRoomQuantum=NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum=function(...args) {
 const result=originalRoomQuantum.apply(this,args);
 if(this.nativeGraph && this.nativeGraphHandle && this.nodes) for(const [id,n] of this.nodes) {
  if(n.type!=='earlyReflectionConvolution') continue;
  const h=this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle,this.fnv1aHash32(String(id)));
  const ready=this.nativeGraph.soemdsp_early_reflection_convolution_ready(h);
  const error=this.nativeGraph.soemdsp_early_reflection_convolution_error(h);
  const length=this.nativeGraph.soemdsp_early_reflection_convolution_ir_length(h);
  const busy=this.nativeGraph.soemdsp_early_reflection_convolution_busy(h);
  const key=[ready,error,length,busy].join(',');
  this.testRoomFrames=(this.testRoomFrames||0)+1;
  if(key!==this.testRoomKey || this.testRoomFrames%32===0) {this.testRoomKey=key;this.port.postMessage({type:'test-room',ready,error,length,busy});}
 }
 return result;
};`;
    await route.fulfill({response,body:await response.text()+probe});
  });
  await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof showNodeGraphModule==='function' && document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});
  await page.waitForTimeout(500);
  const ids=await page.evaluate(()=> {
    const o={record:false,autosaveWorkingPatch:false,skipLivePlan:true};
    const source=showNodeGraphModule('polyBlep',{x:20,y:40},o), room=showNodeGraphModule('earlyReflectionConvolution',{x:300,y:40},o);
    if(!source || !room) throw Error('native room must be spawnable');
    const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes=patch.nodes.filter(n=>[source,room].includes(n.id)||n.type==='output');
    patch.nodes.find(n=>n.id===source).params={waveform:1,frequency:187.5,amplitude:.05};
    patch.nodes.find(n=>n.id===room).params.mix=1;
    const output=patch.nodes.find(n=>n.type==='output');
    patch.connections=[{sourceNode:source,sourcePort:'Wave',destinationNode:room,destinationPort:'In'},
      {sourceNode:room,sourcePort:'Left',destinationNode:output.id,destinationPort:'Left'},
      {sourceNode:room,sourcePort:'Right',destinationNode:output.id,destinationPort:'Right'}];
    patch.modulations=[]; commitNodeGraphPatch(patch,{status:'Room test'});
    const plan=nodeGraphBuildLivePlan(); if(plan.issues?.length) throw Error(JSON.stringify(plan.issues));
    return {source,room};
  });
  await page.evaluate(()=>setNodeGraphLiveOutputEnabled(true));
  await page.waitForFunction(()=>nodeGraphMvp.live.node,null,{timeout:30000});
  await page.evaluate(()=> {
    nodeGraphMvp.live.node.port.addEventListener('message',e=>{if(e.data?.type==='test-room') window.testRoom=e.data;});
    nodeGraphMvp.live.node.port.start();
  });
  try {
    await page.waitForFunction(()=>window.testRoom?.ready===1 && !window.testRoom.busy && nodeGraphMvp.live.outputLevelSmooth>1e-5,null,{timeout:30000});
  } catch(e) {
    console.log(await page.evaluate(()=>({probe:window.testRoom,level:nodeGraphMvp.live.outputLevelSmooth,
      params:nodeGraphMvp.patch.nodes.find(n=>n.type==='earlyReflectionConvolution')?.params,
      live:Object.fromEntries(Object.entries(nodeGraphMvp.live).filter(([,v])=>v==null||['string','number','boolean'].includes(typeof v)))})));
    throw e;
  }
  const length=await page.evaluate(()=>window.testRoom.length);
  await page.evaluate(id=>updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'roomWidth'),'.3'),ids.room);
  await page.waitForFunction(old=>window.testRoom?.ready===1 && !window.testRoom.busy && window.testRoom.length!==old,length,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.testRoom.error),0);
  const parameters=await page.evaluate(id=>{
    const node=nodeGraphMvp.patch.nodes.find(n=>n.id===id);
    return {width:node.params.roomWidth,count:nodeGraphModuleDefinitions.earlyReflectionConvolution.parameters.length};
  },ids.room);
  assert.ok(Math.abs(Number(parameters.width)-.3)<1e-5); assert.equal(parameters.count,16);
  const beforeDiffusion=await page.evaluate(()=>window.testRoom.length);
  await page.evaluate(id=> {
    updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'diffusionMs'),'30');
    updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id,'diffusion'),'1');
  },ids.room);
  await page.waitForFunction(old=>window.testRoom?.ready===1 && !window.testRoom.busy && window.testRoom.length>old,beforeDiffusion,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.testRoom.error),0);
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(id=> {
      const b=nodeGraphSliderForParameter(id,'mix').closest('article').getBoundingClientRect();
      const area=document.getElementById('nodeGraphWorkspace').getBoundingClientRect();
      nodeGraphMvp.pan.x+=(innerWidth-b.width)/2-b.left;nodeGraphMvp.pan.y+=area.top+25-b.top;applyNodeGraphViewportCssLight();
    },ids.room);
    await page.screenshot({path:path.join(os.tmpdir(),`early-reflection-room-${width}.png`)});
  }
  assert.deepEqual(errors,[]); await page.evaluate(()=>setNodeGraphLiveOutputEnabled(false));
  console.log('Room browser: native plan/audio, real IR rebuild from UI, persisted setting and desktop/mobile GL pass.');
} finally {await browser.close();}
