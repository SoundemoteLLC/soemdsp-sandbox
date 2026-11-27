import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=await new Promise(resolve=>{
  const socket=net.createServer();
  socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});
});
assert(![8765,8766,8080].includes(port));
const server=spawn('python',['server.py','--port',String(port)],{cwd:root,stdio:'ignore'});
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const url=`http://127.0.0.1:${port}/`;
  for(let i=0;i<240;i++) {
    try {if((await fetch(url)).ok) break;} catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  const page = await browser.newPage({viewport:{width:1400,height:1000}});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#nodeBootStartButton').click().catch(()=>{});
  await page.waitForFunction(()=>document.body.classList.contains('node-boot-ready'),null,{timeout:180000});
  await page.evaluate(()=>{
    const hs=createNodeGraphPatchNode('hypersaw2',{id:'hs',gx:3,gy:3});
    const src=createNodeGraphPatchNode('pluginSlider',{id:'src',gx:15,gy:3});
    src.params.offset=.8;
    const out=createNodeGraphPatchNode('output',{id:'output',gx:22,gy:3});
    commitNodeGraphPatch({nodes:[hs,src,out],connections:[{sourceNode:'hs',sourcePort:'Left',destinationNode:'output',destinationPort:'In'}],modulations:[{sourceNode:'src',sourcePort:'Bias',destinationNode:'hs',destinationParam:'jitterDistance'}]},{status:'live ghost test'});
    window.__ghostDraws=[];
    const draw=nodeGraphModuleFaceDrawGl;
    nodeGraphModuleFaceDrawGl=function(batch,article,...args){
      if(article===nodeGraphNodeElement('hs')) __ghostDraws.push({time:performance.now(),x:nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(article,'jitterDistance'))});
      return draw(batch,article,...args);
    };
    const b=nodeGraphModuleGeometryGet('hs').box;
    viewFrameRect({x:b.x-12,y:b.y-12,w:b.w+24,h:b.h+24});
  });
  await page.locator('#nodeTransportPlay').click();
  await page.waitForTimeout(5000);
  const live=await page.evaluate(()=>{
    const el=nodeGraphNodeElement('hs'),input=nodeGraphModuleFaceInput(el,'jitterDistance');
    return {transport:nodeGraphLiveTransportUiState(),status:document.getElementById('nodeLiveStatus')?.textContent,mods:nodeGraphMvp.patch.modulations,source:nodeGraphGhostSliderModRange('src','Bias'),ghost:nodeGraphParameterGhostSignal('hs','jitterDistance',input),data:{...input.dataset},readout:input.closest('label')?.querySelector('.node-slider-readout')?.className,travel:nodeGraphModuleFaceGhostTravel(input),draws:__ghostDraws.slice(-10)};
  });
  assert.equal(live.transport,'playing');
  assert.equal(live.mods.length,1);
  assert(live.draws.some(draw=>Number.isFinite(draw.x)),'live telemetry repaints the shared face');
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/hypersaw-live-ghost.png')});
  assert(await page.evaluate(()=>Number.isFinite(nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(nodeGraphNodeElement('hs'),'jitterDistance')))));
  for (const keys of [['jitterSpeed'],['jitterDistance','jitterSpeed']]) {
    await page.evaluate(keys=>{
      const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
      patch.modulations=keys.map(destinationParam=>({sourceNode:'src',sourcePort:'Bias',destinationNode:'hs',destinationParam}));
      commitNodeGraphPatch(patch,{wireEdit:true});
    },keys);
    await page.waitForTimeout(1200);
    const state=await page.evaluate(()=>['jitterDistance','jitterSpeed'].map(key=>({key,travel:nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(nodeGraphNodeElement('hs'),key))})));
    for (const axis of state) assert.equal(Number.isFinite(axis.travel),keys.includes(axis.key));
  }
  await page.evaluate(()=>{
    const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
    const source=createNodeGraphPatchNode('sinCos',{id:'sine',gx:30,gy:3});
    source.params.freq=1;
    patch.nodes.push(source);
    patch.modulations=[{sourceNode:'sine',sourcePort:'sin',destinationNode:'hs',destinationParam:'jitterDistance'}];
    commitNodeGraphPatch(patch);
  });
  await page.waitForTimeout(2500);
  assert(await page.evaluate(()=>Number.isFinite(nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(nodeGraphNodeElement('hs'),'jitterDistance')))));
  await page.evaluate(()=>{__ghostDraws.length=0;});
  const movement=[];
  for(let i=0;i<12;i++) {
    await page.waitForTimeout(130);
    movement.push(await page.evaluate(()=>({source:nodeGraphGhostSliderModRange('sine','sin')?.latest,travel:nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(nodeGraphNodeElement('hs'),'jitterDistance'))})));
  }
  const drawn=await page.evaluate(()=>__ghostDraws.map(draw=>draw.x));
  assert(new Set(movement.map(sample=>sample.travel?.toFixed(3))).size>3,'telemetry keeps moving');
  assert(new Set(drawn.map(value=>value?.toFixed(3))).size>3,'shared face keeps painting moving ghosts');
  await page.evaluate(()=>{
    const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
    const source=createNodeGraphPatchNode('polyBlep',{id:'poly',gx:30,gy:3});
    source.params.frequency=67.54614031106517;
    source.params.amplitude=.3568;
    patch.nodes.push(source);
    patch.connections=[{sourceNode:'poly',sourcePort:'Wave',destinationNode:'output',destinationPort:'Mono'}];
    patch.modulations=['jitterDistance','jitterSpeed'].map((destinationParam,i)=>({sourceNode:'poly',sourcePort:i?'Tri':'Saw',destinationNode:'hs',destinationParam}));
    commitNodeGraphPatch(patch);
    __ghostDraws.length=0;
  });
  const polyMovement=[];
  const observers=await page.evaluate(()=>nodeGraphBuildLivePlan().scopeCapturePorts);
  assert(observers.some(port=>port.sourceNode==='poly'&&port.sourcePort==='Saw'));
  assert(observers.some(port=>port.sourceNode==='poly'&&port.sourcePort==='Tri'));
  for(let i=0;i<12;i++) {
    await page.waitForTimeout(137);
    polyMovement.push(await page.evaluate(()=>({source:nodeGraphGhostSliderModRange('poly','Saw'),tri:nodeGraphGhostSliderModRange('poly','Tri'),travel:nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(nodeGraphNodeElement('hs'),'jitterDistance'))})));
  }
  assert(polyMovement.some(sample=>sample.source.hi-sample.source.lo>.1),'Saw observer is not a zero-filled inactive native tap');
  assert(polyMovement.some(sample=>sample.tri.hi-sample.tri.lo>.1),'Tri observer is not a zero-filled inactive native tap');
  assert(new Set(polyMovement.map(sample=>sample.travel?.toFixed(3))).size>1,'unused destination still observes live source ports');
  assert(new Set(await page.evaluate(()=>__ghostDraws.map(draw=>draw.x?.toFixed(3)))).size>1,'off-route ghost repaints');
  await page.evaluate(()=>{
    const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
    window.__observerMods=patch.modulations;
    patch.modulations=[];
    commitNodeGraphPatch(patch,{wireEdit:true});
  });
  await page.waitForTimeout(1000);
  assert(await page.evaluate(()=>!Number.isFinite(nodeGraphModuleFaceGhostTravel(nodeGraphModuleFaceInput(nodeGraphNodeElement('hs'),'jitterDistance')))),'disconnect removes the ghost');
  await page.evaluate(()=>{
    const patch=cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.modulations=__observerMods;
    commitNodeGraphPatch(patch,{wireEdit:true});
    __ghostDraws.length=0;
  });
  await page.waitForTimeout(1500);
  assert(new Set(await page.evaluate(()=>__ghostDraws.map(draw=>draw.x?.toFixed(3)))).size>1,'observer-only reconnect refreshes masks without changing audio topology');
  await page.locator('#nodeTransportStop').click();
  await page.locator('#nodeTransportPlay').click();
  await page.waitForTimeout(1800);
  assert(await page.evaluate(()=>nodeGraphGhostSliderModRange('poly','Saw').hi-nodeGraphGhostSliderModRange('poly','Saw').lo>.1),'cold plan preserves observer ports');
  console.log('ok: live Distance/Speed ghosts, moving sine, off-route PolyBLEP Saw/Tri observers');
  await page.locator('#nodeTransportStop').click();
} finally {await browser.close();server.kill();}
