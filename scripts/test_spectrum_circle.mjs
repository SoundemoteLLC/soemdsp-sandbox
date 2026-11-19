import assert from 'node:assert/strict';
import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(new URL('../../soemdsp-sandbox/package.json',import.meta.url))('playwright'));}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 let queue=Promise.resolve();
 await page.route('**/*',route=>{
  if(route.request().method()!=='GET')return route.abort();
  const next=queue.then(async()=>route.fulfill({response:await route.fetch()}));queue=next.catch(()=>{});return next;
 });
 await page.goto((process.env.SANDBOX_URL||'http://127.0.0.1:9447/')+'?mode=circuitbuilder',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.nodeBootFinished==='interface-ready',null,{timeout:60000});await page.waitForTimeout(500);
 const result=await page.evaluate(async()=>{
  const check=(yes,message)=>{if(!yes)throw Error(message);};
  const settings=normalizeNodeGraphVideoFeedbackSettings({spectrumDbFloor:-83.37,spectrumCircleRayWidth:.357,spectrumCircleColorLevel:'on',spectrumCircleColorRadius:'on',spectrumCircleSymmetric:'off'});
  check(settings.spectrumDbFloor===-83.37&&settings.spectrumCircleRayWidth===.357,'continuous settings must not snap');
  const legacy=normalizeNodeGraphVideoFeedbackSettings({spectrumCircleColorBy:'radius'});
  check(legacy.spectrumCircleColorRadius==='on'&&legacy.spectrumCircleColorLevel==='off','legacy color migration');
  const options={record:false,autosaveWorkingPatch:false,skipLivePlan:true},id=showNodeGraphModule('videoFeedback',{x:100,y:80},options);
  check(id,'Spectrum Circle must spawn');
  const slider=nodeGraphSliderForParameter(id,'twist');check(slider?.dataset.wraparound==='true','Twist wraps');
  setNodeGraphNodeSelection([id]);
  openNodeGraphTraceDisplaySettings(id);
  const root=nodeGraphTraceDisplaySettingsRoot();
  for(const label of root.querySelectorAll('[data-trace-display-switch-for^="spectrumCircle"] > span:first-child'))
   check(label.scrollWidth<=label.clientWidth+1,'switch label must not clip: '+label.textContent);
  for(const[key,value]of Object.entries({spectrumDbFloor:'-83.37',spectrumCircleRayWidth:'.357'})){
   const input=root.querySelector('[data-trace-display-field="'+key+'"]');
   check(input instanceof HTMLInputElement,key+' must be numeric');input.value=value;
  }
  for(const key of ['spectrumCircleColorLevel','spectrumCircleColorRadius','spectrumCircleSymmetric']){
   const select=root.querySelector('[data-trace-display-choice="'+key+'"]');check(select,key+' switch');select.value='on';
  }
  nodeGraphDisplaySettingsSyncSwitches(root);
  markNodeGraphTraceDisplaySettingsDirty(['spectrumDbFloor','spectrumCircleRayWidth','spectrumCircleColorLevel','spectrumCircleColorRadius','spectrumCircleSymmetric']);
  const stored=applyNodeGraphTraceDisplaySettingsForm({persist:'immediate',record:false});
  check(stored.spectrumDbFloor===-83.37&&stored.spectrumCircleRayWidth===.357,'continuous values persist');
  check(stored.spectrumCircleColorLevel==='on'&&stored.spectrumCircleColorRadius==='on','both color modes persist');
  root.querySelector('[data-trace-display-switch-for="spectrumCircleSymmetric"] [data-trace-display-switch-option="off"]').click();
  await new Promise(resolve=>requestAnimationFrame(resolve));
  check(nodeGraphPatchNode(id).traceDisplaySettings.spectrumCircleSymmetric==='off','Symmetric Off button persists');
  check(nodeGraphPatchNode(id).traceDisplaySettings.spectrumCircleColorLevel==='on'&&nodeGraphPatchNode(id).traceDisplaySettings.spectrumCircleColorRadius==='on','symmetry edit preserves independent color toggles');
  const patch=validateNodeGraphPatch(cloneNodeGraphPatch(nodeGraphMvp.patch)),saved=patch.nodes.find(n=>n.id===id);
  check(saved.traceDisplaySettings.spectrumCircleRayWidth===.357,'patch persistence');
  const host={},renderer=nodeGraphVideoFeedbackGlEnsure(host,256,256);check(renderer,'GL shader must compile');
  const levels=Float32Array.from({length:64},(_,i)=>.2+.8*i/63),lut=new Uint8Array(768);
  for(let i=0;i<256;i++){lut[3*i]=i;lut[3*i+1]=255-i;lut[3*i+2]=32;}
  const base={levels,count:64,bands:64,rayWidth:.6,size:.9,inner:0,bright:1,smooth:0,decay:0,twist:0,spin:0,colorByLevel:true,colorByRadius:false,symmetric:true,lutRgb:lut};
  const draw=extra=>{
   nodeGraphVideoFeedbackGlStep(host,{...base,...extra});const pixels=new Uint8Array(256*256*4),gl=renderer.gl;
   gl.bindFramebuffer(gl.FRAMEBUFFER,renderer.read.framebuffer);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
   check(gl.getError()===gl.NO_ERROR,'GL errors');return pixels;
  };
  const hash=a=>{let h=2166136261;for(const v of a)h=Math.imul(h^v,16777619);return h>>>0;};
  const meanDiff=(a,b,coord=(x,y)=>[x,y])=>{let sum=0;for(let y=0;y<256;y++)for(let x=0;x<256;x++){const[xx,yy]=coord(x,y);for(let c=0;c<3;c++)sum+=Math.abs(a[(y*256+x)*4+c]-b[(yy*256+xx)*4+c]);}return sum/(256*256*3);};
  const original=draw({}),wrappedA=draw({twist:-1}),wrappedB=draw({twist:1});
  check(meanDiff(wrappedA,wrappedB)<.01,'wrap endpoints must render identically');
  const quarter=draw({twist:.5});
  check(meanDiff(quarter,original,(x,y)=>[255-y,x])<1,'Twist half-unit must rotate exactly 90 degrees');
  check(meanDiff(original,original,(x,y)=>[255-x,y])<1,'Symmetric mirror');
  const asymmetric=draw({symmetric:false});check(meanDiff(asymmetric,asymmetric,(x,y)=>[255-x,y])>2,'asymmetric full circle');
  const colors=[];
  for(const colorByLevel of [false,true])for(const colorByRadius of [false,true])colors.push(hash(draw({colorByLevel,colorByRadius})));
  check(new Set(colors).size===4,'all four color combinations differ');
  const thin=draw({rayWidth:.31}),wide=draw({rayWidth:.32});check(hash(thin)!==hash(wide),'continuous Ray Width affects shader');
  const zero=draw({rayWidth:0});check(!zero.some((v,i)=>i%4!==3&&v!==0),'zero width hides rays');
  draw({twist:0});const retained=draw({twist:2,bright:0,decay:1});
  check(meanDiff(original,retained)<.1,'wrapping preserves retained ink');
  nodeGraphVideoFeedbackGlDispose(host);
  return {id,colors,mirrorDifference:meanDiff(original,original,(x,y)=>[255-x,y])};
 });
 assert.equal(result.colors.length,4);assert.deepEqual(errors,[]);
 await page.evaluate(id=>{setNodeGraphNodeSelection([id]);openNodeGraphTraceDisplaySettings(id);},result.id);
 await page.waitForTimeout(250);
 await page.screenshot({path:path.join(os.tmpdir(),'spectrum-circle-settings.png')});
 console.log('Spectrum Circle: continuous settings/patch persistence, independent colors, symmetry, full Twist rotation/wrap, retained ink and nonblank GL pass.');
}finally{await browser.close();}
