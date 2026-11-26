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
  const encodeDb=db=>Math.pow(10,db/20); // linear |X|, full scale 1
  check(Math.abs(spectrogramGrade01(encodeDb(-40),-80,0,1)-.5)<1e-6,'level midpoint');
  check(Math.abs(spectrogramGrade01(encodeDb(-72),-80,0,1)-.075)<1e-6,'soft floor knee');
  check(Math.abs(spectrogramGrade01(encodeDb(-8),-80,0,1)-.925)<1e-6,'soft ceiling knee');
  check(spectrogramGrade01(encodeDb(-90),-80,-20,1)===0,'ceiling cannot lift below-floor detail');
  check(spectrogramGrade01(encodeDb(-40),-40,0,1)<1e-6,'raising floor removes quiet detail');
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
  const centerY=pixels=>{let sum=0,weight=0;for(let y=0;y<256;y++)for(let x=0;x<256;x++){const k=(y*256+x)*4,v=pixels[k]+pixels[k+1]+pixels[k+2];sum+=y*v;weight+=v;}return sum/weight;};
  const low=new Float32Array(64),high=new Float32Array(64);low[8]=1;high[55]=1;
  check(normalizeNodeGraphVideoFeedbackSettings().spectrumCircleReverse==='off','downward pitch sweep is default');
  check(centerY(draw({levels:high}))>centerY(draw({levels:low})),'falling pitch moves from top to bottom (GL y points up)');
  const reversed=draw({reverseFrequency:true});
  check(meanDiff(reversed,original,(x,y)=>[x,255-y])<1,'reverse frequency runs top to bottom');
  check(meanDiff(wrappedA,wrappedB)<.01,'wrap endpoints must render identically');
  const quarter=draw({twist:.5});
  check(meanDiff(quarter,original,(x,y)=>[255-y,x])<1,'Twist half-unit must rotate exactly 90 degrees');
  check(meanDiff(original,original,(x,y)=>[255-x,y])<1,'Symmetric mirror');
  const asymmetric=draw({symmetric:false});check(meanDiff(asymmetric,asymmetric,(x,y)=>[255-x,y])>2,'asymmetric full circle');
  const colors=[];
  for(const colorByLevel of [false,true])for(const colorByRadius of [false,true])colors.push(hash(draw({colorByLevel,colorByRadius})));
  check(new Set(colors).size===4,'all four color combinations differ');
  const thin=draw({rayWidth:.31}),wide=draw({rayWidth:.32});check(hash(thin)!==hash(wide),'continuous Ray Width affects shader');
  const masked=draw({inner:.3});
  let extendedPixels=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const radius=Math.hypot(x-127.5,y-127.5)/128;
   for(let c=0;c<3;c++){
    const i=(y*256+x)*4+c;
    if(radius<.25)check(masked[i]===0,'cutout center is empty');
    if(radius>.32&&masked[i]>original[i]+3)extendedPixels++;
   }
  }
  check(extendedPixels>100,'Inner relocates ray origins instead of masking away shorter rays');
  check(!nodeGraphModuleDefinitions.videoFeedback.parameters.some(p=>p.key==='cutoutCurve'),'obsolete Cutout Curve control removed');
  const zero=draw({rayWidth:0});check(!zero.some((v,i)=>i%4!==3&&v!==0),'zero width hides rays');
  draw({twist:0});const retained=draw({twist:2,bright:0,decay:1});
  check(meanDiff(original,retained)<.1,'wrapping preserves retained ink');
  nodeGraphVideoFeedbackGlDispose(host);
  const circular=showNodeGraphModule('circularSpectrogram',{x:400,y:80},options);
  setNodeGraphNodeSelection([circular]);openNodeGraphTraceDisplaySettings(circular);
  const circularRoot=nodeGraphTraceDisplaySettingsRoot();
  check(!nodeGraphModuleDefinitions.circularSpectrogram.face.some(row=>row.param==='reverseFrequency'),'reverse is not on module face');
  const reverseInput=circularRoot.querySelector('[data-trace-display-toggle="reverseFrequency"]');
  check(reverseInput,'Circular Spectrogram reverse in Display Settings');reverseInput.checked=true;
  const headSelect=circularRoot.querySelector('[data-trace-display-choice="circularHeadMode"]');
  check(headSelect,'head mode in Display Settings');headSelect.value='moving';
  circularRoot.querySelector('[data-trace-display-field="circularAfterglow"]').value='.35';
  circularRoot.querySelector('[data-trace-display-field="circularHangTurns"]').value='2.5';
  circularRoot.querySelector('[data-trace-display-field="circularSweepFade"]').value='.4';
  circularRoot.querySelector('[data-trace-display-field="frequencyCurve"]').value='.37';
  markNodeGraphTraceDisplaySettingsDirty(['reverseFrequency','circularHeadMode','circularAfterglow','circularHangTurns','circularSweepFade','frequencyCurve']);
  applyNodeGraphTraceDisplaySettingsForm({persist:'immediate',record:false});
  const circularSettings=spectrogramSettingsForNode(nodeGraphPatchNode(circular));
  check(circularSettings.reverseFrequency&&circularSettings.frequencyCurve===.37,'reverse and frequency curve persist together');
  check(circularSettings.circularHeadMode==='moving','moving head persists');
  check(circularSettings.circularAfterglow===.35&&circularSettings.circularHangTurns===2.5,'sweep retention persists independently');
  check(circularSettings.circularSweepFade===.4,'Sweep fade persists');
  check(normalizeNodeGraphSpectrogramSettings({},nodeGraphPatchNode(circular)).circularSweepFade===0,'hard sweep is default');
  for(const key of ['circularAfterglow','circularHangTurns','circularSweepFade'])
   check(circularRoot.querySelector('[data-trace-display-field="'+key+'"]'),'sweep retention setting '+key);
  const circularControls=nodeGraphTraceDisplayActiveControlsForType('spectrogramBurn');
  check(circularSettings.frequencyCurve===.37&&!circularControls.choices.includes('freqScale'),'continuous curve persists and replaces named-scale dropdown');
  check(!circularControls.fields.includes('ghost')&&!circularControls.fields.includes('trail'),'circular retention no longer inherits phosphor controls');
  check(nodeGraphModuleDefinitions.circularSpectrogram.face.some(row=>row.params?.some(pair=>pair[0]==='spinHz')),'Spin replaces History on circular face');
  const spinInput=nodeGraphSliderForParameter(circular,'spinHz'),article=spinInput.closest('.dsp-node');
  const face=article.querySelector(':scope > .dsp-node-body > .node-face');
  const faceSpec=nodeGraphModuleFaceSpecForElement(article);
  const capture=nodeGraphModuleFaceCapture,setFaceValue=setNodeGraphModuleFaceValue,transform=face.style.transform;
  const dragged=[],expectedDrag=[];
  try {
   setNodeGraphModuleFaceValue=(_input,value)=>dragged.push(value);
   nodeGraphModuleFaceCapture=(_face,event,move)=>move(new PointerEvent('pointermove',{clientX:event.clientX+22,clientY:event.clientY}),true);
   for(const scale of [.5,1,2]) {
    face.style.transform='scale('+scale+')';face._faceLastDown=null;
    const widget=nodeGraphModuleFaceWidgets(faceSpec,face.offsetWidth,article).find(w=>w.type==='cell'&&w.param==='spinHz');
    check(widget,'Spin numeric cell exists');
    const rect=face.getBoundingClientRect();
    expectedDrag.push(nodeSliderValueFromRelativeTravel(spinInput,
     nodeGraphModuleFaceTravel(spinInput)+22/(widget.w*rect.width/face.offsetWidth)));
    beginNodeGraphModuleFaceGesture(article,face,faceSpec,new PointerEvent('pointerdown',{
     button:0,clientX:rect.left+(widget.x+widget.w*.5)*rect.width/face.offsetWidth,
     clientY:rect.top+(widget.y+widget.h*.5)*rect.height/face.offsetHeight}));
   }
  } finally {nodeGraphModuleFaceCapture=capture;setNodeGraphModuleFaceValue=setFaceValue;face.style.transform=transform;}
  check(dragged.length===3&&dragged.every((v,i)=>Math.abs(v-expectedDrag[i])<1e-6),'Spin handle follows visible lane travel at every zoom');
  for(const type of ['spectrogram','spectrum1d']) {
   const moduleId=showNodeGraphModule(type,{x:700,y:80},options);
   setNodeGraphNodeSelection([moduleId]);openNodeGraphTraceDisplaySettings(moduleId);
   const form=nodeGraphTraceDisplaySettingsRoot(),field=form.querySelector('[data-trace-display-field="frequencyCurve"]');
   check(field,type+' exposes Frequency curve');field.value='.43';
   markNodeGraphTraceDisplaySettingsDirty(['frequencyCurve']);applyNodeGraphTraceDisplaySettingsForm({persist:'immediate',record:false});
   check(nodeGraphPatchNode(moduleId).traceDisplaySettings.frequencyCurve===.43,type+' preserves fractional curve');
   const controls=nodeGraphTraceDisplayActiveControlsForType(type==='spectrogram'?'spectrogramBurn':'spectrumLine');
   check(!controls.choices.includes('freqScale')&&!controls.choices.includes('spectrumAxis'),type+' removes named-scale dropdown');
   if(type==='spectrum1d') {
    for(const [key,value] of Object.entries({spectrumSmoothMs:120,spectrumBarCount:16,spectrumBarWidth:.5,spectrumMinBarPx:3,spectrumMinGapPx:2})) {
     const input=form.querySelector('[data-trace-display-field="'+key+'"]');check(input,key+' control exists');input.value=String(value);
    }
    form.querySelector('[data-trace-display-choice="spectrumDrawStyle"]').value='bars';
    form.querySelector('[data-trace-display-choice="spectrumPeakHold"]').value='fall';
    markNodeGraphTraceDisplaySettingsDirty(['spectrumSmoothMs','spectrumBarCount','spectrumBarWidth','spectrumDrawStyle','spectrumMinBarPx','spectrumMinGapPx','spectrumPeakHold']);
    applyNodeGraphTraceDisplaySettingsForm({persist:'immediate',record:false});
    const settings=nodeGraphSpectrumLineSettingsForNode(nodeGraphPatchNode(moduleId));
    check(settings.spectrumSmoothMs===120&&settings.spectrumBarWidth===.5&&settings.spectrumBarCount===16&&settings.spectrumDrawStyle==='bars','Bars and live smoothing persist');
    check(settings.spectrumMinBarPx===3&&settings.spectrumMinGapPx===2&&settings.spectrumPeakHold==='fall','adaptive density and Fall mode persist');
    const smoothSpec=nodeGraphDisplaySettingsFieldSpec('spectrumSmoothMs','spectrumLine');
    check(smoothSpec.taper==='power'&&Math.abs(nodeGraphDisplaySettingsControlToValue(smoothSpec,.1)-5)<1e-6,'Smooth ms has fine sensitivity near zero');
   }
  }
  for(const curve of [0,.37,1]) {
   const expected=(20+.5*(20000-20))*(1-curve)+Math.sqrt(20*20000)*curve;
   check(Math.abs(nodeGraphSpectrumLineTToHz(.5,curve,20,20000)-expected)<1e-6,'1D Spectrum uses the same continuous frequency curve');
  }
  const smoothA={},smoothB={},zeroHeight=new Float32Array([0]),fullHeight=new Float32Array([1]);
  nodeGraphSpectrumLineSmoothColumns(smoothA,zeroHeight,100,0);nodeGraphSpectrumLineSmoothColumns(smoothB,zeroHeight,100,0);
  const once=nodeGraphSpectrumLineSmoothColumns(smoothA,fullHeight,100,.1)[0];
  nodeGraphSpectrumLineSmoothColumns(smoothB,fullHeight,100,.05);
  const twice=nodeGraphSpectrumLineSmoothColumns(smoothB,fullHeight,100,.05)[0];
  check(Math.abs(once-(1-Math.exp(-1)))<1e-6&&Math.abs(once-twice)<1e-6,'live smoothing is time based, independent of frame cadence');
  check(nodeGraphSpectrumLineSmoothColumns(smoothA,zeroHeight,0,.1)===zeroHeight,'live smoothing zero is exact bypass');
  const rectDraw=nodeGraphGlLinesRect,rectangles=[];
  try {
   nodeGraphGlLinesRect=(_batch,x,y,w,h)=>rectangles.push({x,y,w,h});
   const heights=new Float32Array(128).fill(.5);
   check(nodeGraphSpectrumLineDrawBars({},heights,128,64,8,0,[1,1,1,1])===0,'zero bar width disappears');
   nodeGraphSpectrumLineDrawBars({},heights,128,64,8,1,[1,1,1,1]);
   check(rectangles.length===8&&rectangles.every((r,i)=>r.x===16*i&&r.w===16),'full-width bars touch without overlap');
   rectangles.length=0;nodeGraphSpectrumLineDrawBars({},heights,128,64,8,.5,[1,1,1,1]);
   check(rectangles.every((r,i)=>r.x===16*i+4&&r.w===8),'half-width bars leave centered gaps');
   rectangles.length=0;const uneven=new Float32Array(131).fill(.373);
   nodeGraphSpectrumLineDrawBars({},uneven,131,67,8,.37,[1,1,1,1]);
   const liveBars=rectangles.slice();
   check(liveBars.length===8&&liveBars.every(r=>Number.isInteger(r.x)&&Number.isInteger(r.y)&&Number.isInteger(r.w)&&Number.isInteger(r.h)),'bar edges align to device pixels at non-divisible widths');
   check(liveBars.every((r,i)=>r.w===liveBars[0].w&&(!i||r.x-liveBars[i-1].x-liveBars[i-1].w===16-liveBars[0].w)),'all bars have identical width and gaps');
   check(liveBars[0].x>0&&liveBars.at(-1).x+liveBars.at(-1).w<131,'remainder stays in outside margins');
   rectangles.length=0;nodeGraphSpectrumLineDrawBars({},uneven,131,67,8,.37,[1,1,1,1],1.25);
   check(rectangles.every((r,i)=>r.x===liveBars[i].x&&r.w===liveBars[i].w)&&rectangles.some(r=>!Number.isInteger(r.y)),'peak markers share exact horizontal geometry while falling subpixel');
  } finally {nodeGraphGlLinesRect=rectDraw;}
  const barsCanvas=nodeGraphDisplayCanvasCreate('spectrum-bars-test');barsCanvas.width=128;barsCanvas.height=64;
  const barEnergy=[];
  for(const width of [0,.5,1]) {
   const batch=nodeGraphGlLinesBegin(barsCanvas,[0,0,0,1]);check(batch,'bar GL batch');
   nodeGraphSpectrumLineDrawBars(batch,new Float32Array(128).fill(.5),128,64,8,width,[1,1,1,1]);
   check(nodeGraphGlLinesEnd(batch),'bar GL present');
   const g=nodeGraphPictureDevice().gl,pixels=new Uint8Array(128*64*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,128,64,g.RGBA,g.UNSIGNED_BYTE,pixels);
   barEnergy.push(pixels.reduce((sum,v,i)=>sum+(i%4!==3?v:0),0));
  }
  check(barEnergy[0]===0&&barEnergy[1]>0&&barEnergy[2]>barEnergy[1]*1.8,'bar spacing renders correctly in WebGL');
  const zoomScreen=document.createElement('div'),zoomFace=nodeGraphDisplayCanvasCreate('adaptive-bars-test');
  Object.assign(zoomScreen.style,{position:'fixed',left:'0',top:'0',width:'256px',height:'128px',transformOrigin:'0 0'});
  document.body.append(zoomScreen);zoomScreen.append(zoomFace);
  const zoomCounts=[];
  try {
   for(const scale of [1,.5,.25,1]) {
    zoomScreen.style.transform='scale('+scale+')';
    check(nodeGraphSpectrumLineSyncCanvas(zoomFace,zoomScreen,{spectrumDrawStyle:'bars'},1),'adaptive screen sizing');
    check(zoomFace.width===Math.round(256*scale),'bar raster follows compositor pixels rather than monitor DPR');
    const layout=nodeGraphSpectrumLineBarLayout(zoomFace.width,zoomFace.width,64,.5,2,1);
    check(layout&&layout.barWidth>=2&&layout.slot-layout.barWidth>=1,'zoom preserves minimum integer bar size and gap');
    zoomCounts.push(layout.count);
   }
  } finally {zoomScreen.remove();}
  check(zoomCounts[0]>zoomCounts[1]&&zoomCounts[1]>zoomCounts[2]&&zoomCounts[0]===zoomCounts[3],'zoom sacrifices bars and restores them when zooming in');
  const dprDescriptor=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');
  try {
   Object.defineProperty(window,'devicePixelRatio',{value:2,configurable:true});
   document.body.append(zoomScreen);zoomScreen.style.transform='scale(.5)';
   check(nodeGraphSpectrumLineSyncCanvas(zoomFace,zoomScreen,{spectrumDrawStyle:'bars'},2)&&zoomFace.width===128,'high-DPI does not create a second bar downscale');
   check(zoomFace.dataset.pixelSnap==='1','bar texture opts into final-compositor pixel snap');
  } finally {
   if(dprDescriptor)Object.defineProperty(window,'devicePixelRatio',dprDescriptor);else delete window.devicePixelRatio;
   zoomScreen.remove();
  }
  const composite=nodeGraphDisplayCanvasCreate('bars-composite-test');composite.width=composite.height=256;
  barsCanvas.dataset.pixelSnap='1';
  for(const zoom of [.37,.61,.93,1.31]) {
   const sourceW=Math.round(131.25*zoom),sourceH=Math.round(67.75*zoom);
   barsCanvas.width=sourceW;barsCanvas.height=sourceH;
   const layout=nodeGraphSpectrumLineBarLayout(sourceW,sourceW,64,.6,2,1);
   let batch=nodeGraphGlLinesBegin(barsCanvas,[0,0,0,1]);
   nodeGraphSpectrumLineDrawBars(batch,new Float32Array(sourceW).fill(.5),sourceW,sourceH,64,.6,[1,1,1,1],0,2,1);
   check(nodeGraphGlLinesEnd(batch),'bar source render');
   const camera={x:.12,y:.11,zoom};
   batch=nodeGraphGlLinesBegin(composite,[0,0,0,1],{camera,scale:1});
   nodeGraphGlLinesImage(batch,barsCanvas,7.37,7.29,131.25,67.75,{nearest:true});
   check(nodeGraphGlLinesEnd(batch),'bar final image render');
   const g=nodeGraphPictureDevice().gl,pixels=new Uint8Array(256*256*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,256,256,g.RGBA,g.UNSIGNED_BYTE,pixels);
   const row=255-(Math.round((7.29-camera.y)*zoom)+Math.floor(sourceH*.75));
   const runs=[],gaps=[];let start=-1,lastEnd=-1;
   for(let x=0;x<=256;x++) {
    const lit=x<256&&pixels[(row*256+x)*4]>128;
    if(lit&&start<0){start=x;if(lastEnd>=0)gaps.push(x-lastEnd);}
    if(!lit&&start>=0){runs.push(x-start);start=-1;lastEnd=x;}
   }
   check(runs.length===layout.count&&runs.every(w=>w===layout.barWidth),'final compositor preserves equal bar widths at zoom '+zoom);
   check(gaps.every(w=>w===layout.slot-layout.barWidth),'final compositor preserves every bar gap at zoom '+zoom);
  }
  const peakState=nodeGraphSpectrumLineResizeState(null,4);
  nodeGraphSpectrumLineUpdatePeaks(peakState,new Float32Array([1,0,0,0]),'hold',0,0,1);
  nodeGraphSpectrumLineUpdatePeaks(peakState,new Float32Array(4),'hold',100,.1,1);
  check(peakState.peak[0]===1,'Hold waits before falling');
  nodeGraphSpectrumLineUpdatePeaks(peakState,new Float32Array(4),'fall',100,.1,1);
  check(Math.abs(peakState.peak[0]-.9)<1e-6,'Fall has no hold delay');
  nodeGraphSpectrumLineUpdatePeaks(peakState,new Float32Array([1,0,0,0]),'fall',110,.01,1);
  check(peakState.peak[0]===1,'Fall rises immediately');
  nodeGraphSpectrumLineResizeState(peakState,2);
  check(peakState.peak[0]===1&&peakState.holdUntil[0]>0,'zoom preserves held peak data');
  const ring=spectrogramGlRingCreate(32,lut),spectrum=new Float32Array(128);spectrum[4]=1;
  spectrogramGlRingPool(ring,spectrum,128);
  spectrogramGlRingWrite(ring,32,{lutRgb:lut,minFreq:20,maxFreq:24000,nyquist:24000,freqScale:3,floorDb:-80,ceilingDb:0});
  const head=ring.head,canvas=nodeGraphDisplayCanvasCreate('circular-reverse-test');canvas.width=canvas.height=256;
  const ctx=nodeGraphSharedGlPresentTarget(canvas);
  for(const reverseFrequency of [false,true])for(const movingHead of [false,true])
   check(spectrogramGlRingPresentPolar(ring,256,256,ctx,256,256,0,[0,0,0],1,{mirror:true,inner:.12,reverseFrequency,movingHead,sweepPhase:.25}),'polar shader renders frequency and head modes');
  check(ring.head===head,'frequency reverse preserves history');
  const curveImages=[],waterfallImages=[];
  for(const frequencyCurve of [0,.37,1]) {
   spectrogramGlRingPool(ring,spectrum,128);
   spectrogramGlRingWrite(ring,32,{lutRgb:lut,minFreq:20,maxFreq:24000,nyquist:24000,frequencyCurve,floorDb:-80,ceilingDb:0});
   check(Math.abs(ring.meta[2]-(4+frequencyCurve))<1e-6,'continuous curve is not rounded');
   check(spectrogramGlRingPresentPolar(ring,256,256,ctx,256,256,0,[0,0,0],1,{mirror:true,inner:.12,reverseFrequency:true}),'continuous radial mapping shader');
   const g=nodeGraphPictureDevice().gl,pixels=new Uint8Array(256*256*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,256,256,g.RGBA,g.UNSIGNED_BYTE,pixels);curveImages.push(hash(pixels));
   check(spectrogramGlRingPresent(ring,32,128,ctx,256,256,0,[0,0,0],1),'standard spectrogram continuous mapping shader');
   const waterfall=new Uint8Array(32*128*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,32,128,g.RGBA,g.UNSIGNED_BYTE,waterfall);waterfallImages.push(hash(waterfall));
  }
  check(new Set(curveImages).size===3,'linear, intermediate and logarithmic mappings render differently with reverse enabled');
  check(new Set(waterfallImages).size===3,'standard spectrogram renders all curve positions differently');
  const retainedLut=new Uint8Array(768);for(let i=0;i<256;i++)retainedLut.fill(i,i*3,i*3+3);
  const ink={lutRgb:retainedLut,minFreq:20,maxFreq:24000,nyquist:24000,freqScale:0,floorDb:-80,ceilingDb:0};
  spectrum.fill(Math.log10(101));spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  const polar={mirror:true,up:false,rotate:0,inner:.12,sweepPhase:.25};
  const retention={circularAfterglow:.2,circularHangTurns:1};
  const readPresent=()=>{const g=nodeGraphPictureDevice().gl,pixels=new Uint8Array(256*256*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,256,256,g.RGBA,g.UNSIGNED_BYTE,pixels);check(g.getError()===g.NO_ERROR,'retained GL errors');return pixels;};
  const retainedDraw=(columns,turns,settings=retention)=>{check(spectrogramGlRingPresentPolarRetained(ring,canvas,[0,0,0],1,polar,settings,columns,turns),'retained polar pass');return readPresent();};
  const energy=p=>p.reduce((sum,v,i)=>sum+(i%4!==3?v:0),0);
  const deposited=retainedDraw(32,1);check(energy(deposited)>0,'current revolution is visible');
  const softened=retainedDraw(0,0,{...retention,circularSweepFade:.5});
  check(energy(softened)<energy(deposited)*.9,'Sweep fade softens only when requested');
  check(meanDiff(retainedDraw(0,0,{...retention,circularSweepFade:0}),deposited)<.01,'Sweep fade zero restores hard edge without clearing or changing ink');
  spectrum.fill(0);spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  const retired=retainedDraw(32,1);
  check(energy(retired)>energy(deposited)*.05&&energy(retired)<energy(deposited)*.3,'old sweep moves to dim afterglow rather than stacking at full brightness');
  check(energy(retainedDraw(0,0,{...retention,circularAfterglow:0}))===0,'Afterglow zero leaves only the clean current sweep');
  const held=retainedDraw(0,0);check(meanDiff(held,retired)<.01,'zero turns holds the image');
  spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  const faded=retainedDraw(32,1);
  check(energy(faded)<energy(retired)*.03,'Hang one turn fades older ink to one percent per revolution');
  nodeGraphResidualFaceGlDrop(canvas);polar.movingHead=false;
  spectrum.fill(Math.log10(101));spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  const fixedCurrent=retainedDraw(32,1);
  check(energy(retainedDraw(0,0,{...retention,circularSweepFade:.5}))<energy(fixedCurrent)*.9,'Fixed Head responds to Sweep fade');
  spectrum.fill(0);spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  const fixedGhost=retainedDraw(32,1);
  check(energy(fixedGhost)>0&&energy(fixedGhost)<energy(fixedCurrent)*.3,'Fixed Head retires older ink into afterglow');
  check(energy(retainedDraw(0,0,{...retention,circularAfterglow:0}))===0,'Fixed Head responds to Afterglow');
  spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  check(energy(retainedDraw(32,1))<energy(fixedGhost)*.03,'Fixed Head responds to Hang');
  nodeGraphResidualFaceGlDrop(canvas);
  spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  spectrum.fill(Math.log10(101));spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,8,ink);
  retainedDraw(8,.25);
  spectrum.fill(0);spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,32,ink);
  const scrollingGhost=retainedDraw(32,1,{...retention,circularAfterglow:1,circularHangTurns:30});
  spectrogramGlRingPool(ring,spectrum,128);spectrogramGlRingWrite(ring,4,ink);
  const advancedGhost=retainedDraw(4,.125,{...retention,circularAfterglow:1,circularHangTurns:30});
  check(centerY(advancedGhost)<centerY(scrollingGhost)-5,'Fixed Head scrolls retained afterglow with the spectrum instead of leaving it stuck');
  const pauseState={ring,spinHz:0,pendingTurns:0,pendingColumns:0,historySeconds:2,scrollDebtSec:0,sweepPhase:.25};
  circularSpectrogramAdvance(pauseState,spectrum,128,512/48000,ink);
  check(pauseState.sweepPhase===.25&&pauseState.pendingColumns===0&&pauseState.pendingTurns===0&&!ring.pendingValid,'0 Hz holds painting and afterglow without pooling paused audio');
  const bySpeed=[];
  for(const hz of [1,4]) {
   const st={ring,spinHz:hz,pendingTurns:0,pendingColumns:0,historySeconds:1/hz,scrollDebtSec:0,sweepPhase:0};
   circularSpectrogramAdvance(st,spectrum,128,1/(8*hz),ink);
   bySpeed.push(st.pendingTurns);
  }
  check(bySpeed[0]===.125&&bySpeed[1]===.125,'equal angular travel has equal decay time at different spin rates');
  const phaseFor=(times,packets)=>{
   const r=spectrogramGlRingCreate(32,retainedLut),source={};
   const st={ring:r,spinHz:.375,historySeconds:1/.375,scrollDebtSec:0,sweepPhase:0,pendingColumns:0,pendingTurns:0};
   for(let i=0;i<times.length;i++) {
    const dt=circularSpectrogramElapsed(st,times[i],source,true),n=Math.max(1,packets[i%packets.length]);
    for(let c=0;c<n;c++)circularSpectrogramAdvance(st,spectrum,128,dt/n,ink);
   }
   const phase=(st.sweepPhase+circularSpectrogramSubColumn(st)/r.w)%1;
   spectrogramGlRingRelease(r);return phase;
  };
  const regular=phaseFor(Array.from({length:61},(_,i)=>i/60),[1]);
  const irregular=phaseFor([0,.016,.1,.107,.28,.52,.53,.8,1],[0,8,1,64,0]);
  check(Math.abs(regular-.375)<1e-6&&Math.abs(irregular-regular)<1e-6,'Spin follows elapsed audio time across frame stalls, skipped packets and bursts');
  const clockState={},clockA={},clockB={};
  circularSpectrogramElapsed(clockState,10,clockA,true);
  check(circularSpectrogramElapsed(clockState,10.1,clockA,true)>.099,'audio clock advances');
  check(circularSpectrogramElapsed(clockState,20,clockA,false)===0,'paused clock does not paint');
  check(Math.abs(circularSpectrogramElapsed(clockState,20.1,clockA,true)-.1)<1e-6,'resume does not catch up paused time');
  check(circularSpectrogramElapsed(clockState,500,clockB,true)===0,'clock replacement rebases without jump');
  spectrogramGlRingRelease(ring);
  return {id,colors,mirrorDifference:meanDiff(original,original,(x,y)=>[255-x,y])};
 });
 assert.equal(result.colors.length,4);assert.deepEqual(errors,[]);
 await page.evaluate(id=>{setNodeGraphNodeSelection([id]);openNodeGraphTraceDisplaySettings(id);},result.id);
 await page.waitForTimeout(250);
 await page.screenshot({path:path.join(os.tmpdir(),'spectrum-circle-settings.png')});
 console.log('Spectrum Circle: continuous settings/patch persistence, independent colors, symmetry, full Twist rotation/wrap, retained ink and nonblank GL pass.');
}finally{await browser.close();}
