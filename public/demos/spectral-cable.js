// Isolated appearance proof. No audio graph, module registration or STFT engine.
(() => {
  const defaults = nodeGraphSpectralWireDefaults;
  const settings = { ...defaults };
  const specs = [
    ["width", "Overall width", 1, 128, .01, "px", "World-pixel tube width. At zoom 1, width 64 exposes all 32 inward pixels."],
    ["brightPoint", "Bright point", 0, 128, .1, "px", "Distance inward from the edge before fading starts. Independent of cable width; zero starts fading immediately."],
    ["edgeBrightness", "Edge brightness", 0, 300, 1, "%", "100% is colour; higher values lift the edge toward white.", 100],
    ["centerAlpha", "Center alpha", 0, 100, 1, "%", "Minimum opacity in the hollow centre, before inward glow.", 100],
    ["bend", "Hyperbolic bend", 0, 99999, .01, "", "Hyperbolic curvature: 999 matches a start/end ratio of 1 to 0.001 in the reference decay. Higher values sharpen the rim; 0 is linear before Shape."],
    ["shape", "Shape w", -12, 12, .01, "", "Reference hyperbolic decay time warp: (exp(w*t)-1)/(exp(w)-1). Negative sharpens the initial drop, zero leaves time linear, positive holds brightness longer before dropping."],
    ["dimPoint", "Dim point", 0, 128, .1, "px", "Distance inward where the glow reaches the floor. Fixed screen-pixel reach: narrowing the cable brings the edge profiles together without stretching them."],
    ["iridescence", "Iridescence", 0, 100, 1, "%", "Oil-slick colour mixed with the jack-tinted glass.", 100],
    ["hueSpread", "Hue spread", 0, 100, 1, "%", "Share of the pink, teal, gold and violet palette." , 100],
    ["sheenLength", "Sheen length", 10, 2000, 1, "px", "World distance of one palette pass."],
    ["shimmerSpeed", "Shimmer speed", -400, 400, 1, "px/s", "Positive flows OUT to IN. Zero leaves the renderer idle."],
    ["baseTint", "Base tint", 0, 100, 1, "%", "Amount of the IN jack's reserved magenta in the glass.", 100],
    ["zoom", "Zoom", .05, 4, .01, "×", "Below the hollow size the tube becomes one anti-aliased solid line."],
  ];
  const canvas=document.getElementById("preview"),scene=canvas.parentElement;
  const controls=document.getElementById("controls"),hint=document.getElementById("hint");
  const route=document.getElementById("route"),selected=document.getElementById("selected");
  const nodes=[{x:95,y:155},{x:745,y:310}],inputs=new Map();
  let frame=0,lastTime=null,dragging=null,W=1,H=1,ratio=1,visible=true;
  const format=value=>String(Number(value.toFixed(6)));
  const debug={settings,draws:0,spectralVertices:0,ordinaryVertices:0};
  window.spectralCableDemo=debug;
  const pixelProfile=new Float32Array(32);
  pixelProfile.set([1,.29,.22,.18,.14,.13,.11,.09,.09,.09]);
  settings.pixelProfile=pixelProfile;
  settings.width=64;
  settings.zoom=1;
  const pixelMode=document.getElementById("pixel-mode"),pixelControls=document.getElementById("pixel-controls");
  const storageKey="soundemote:spectral-cable-preview:v1";
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||"null");
    if(saved){
      for(const[key,,min,max,,,,factor=1]of specs){
        const value=saved.settings?.[key];
        if(Number.isFinite(value))settings[key]=Math.max(min,Math.min(max,value*factor))/factor;
      }
      if(saved.profileUnits!=="css-px"){
        const halfWidth=settings.width*settings.zoom/2;
        for(const key of["brightPoint","dimPoint"]){
          if(Number.isFinite(saved.settings?.[key]))settings[key]=Math.max(0,Math.min(128,saved.settings[key]*halfWidth));
        }
      }
      if(Array.isArray(saved.pixels)&&saved.pixels.length===32&&saved.pixels.every(v=>Number.isFinite(v)&&v>=0&&v<=1))pixelProfile.set(saved.pixels);
      if(typeof saved.customFalloff==="boolean")pixelMode.checked=saved.customFalloff;
      if(typeof saved.selected==="boolean")selected.checked=saved.selected;
      if(["ribbon","trace"].includes(saved.route))route.value=saved.route;
      if(Array.isArray(saved.nodes)&&saved.nodes.length===2&&saved.nodes.every(n=>Number.isFinite(n?.x)&&Number.isFinite(n?.y)))saved.nodes.forEach((n,i)=>Object.assign(nodes[i],n));
    }
  }catch(error){console.warn("[spectral-cable] Could not restore preview settings",error);}
  function saveSettings(){
    try{
      const values=Object.fromEntries(specs.map(([key])=>[key,settings[key]]));
      localStorage.setItem(storageKey,JSON.stringify({profileUnits:"css-px",settings:values,pixels:Array.from(pixelProfile),customFalloff:pixelMode.checked,selected:selected.checked,route:route.value,nodes}));
    }catch(error){hint.textContent="Settings could not be saved in this browser.";console.warn("[spectral-cable] Could not save preview settings",error);}
  }
  for(const event of["input","change"])controls.parentElement.addEventListener(event,saveSettings);
  const pixelInputs=[];
  for(let i=0;i<32;i++){
    const row=document.createElement("div");row.className="row";
    const label=document.createElement("label");label.htmlFor=`pixel-${i}`;label.textContent=`Pixel ${i+1}`;
    const number=document.createElement("input");number.type="number";number.min=0;number.max=100;number.step=1;number.setAttribute("aria-label",`Pixel ${i+1} brightness`);
    const slider=document.createElement("input");slider.type="range";slider.id=label.htmlFor;slider.min=0;slider.max=100;slider.step=1;
    for(const input of[number,slider])input.addEventListener("input",()=>{
      if(!Number.isFinite(input.valueAsNumber))return;
      pixelProfile[i]=Math.max(0,Math.min(100,input.valueAsNumber))/100;
      number.value=slider.value=String(Math.round(pixelProfile[i]*100));requestDraw();
    });
    number.value=slider.value=String(Math.round(pixelProfile[i]*100));
    pixelInputs.push({number,slider});row.append(label,number,slider);pixelControls.append(row);
  }
  function syncPixelMode(){
    settings.pixelProfile=pixelMode.checked?pixelProfile:null;
    document.getElementById("pixel-editor").hidden=!pixelMode.checked;
    for(const key of["brightPoint","dimPoint","bend","shape"]){const input=inputs.get(key);if(input)input.slider.closest(".row").hidden=pixelMode.checked;}
    hint.textContent=pixelMode.checked?"Your custom falloff, with colour, brightness and centre alpha controls active.":"Hyperbolic curve mode";
    requestDraw();
  }
  pixelMode.addEventListener("change",syncPixelMode);
  document.getElementById("pixel-isolate").addEventListener("click",()=>{
    pixelProfile.fill(0);pixelProfile[0]=1;pixelMode.checked=true;
    pixelInputs.forEach(({number,slider},i)=>{number.value=slider.value=i===0?"100":"0";});syncPixelMode();saveSettings();
  });
  syncPixelMode();

  for(const [key,label,min,max,step,unit,help,factor=1] of specs){
    const row=document.createElement("div");row.className="row";
    const name=document.createElement("label");name.htmlFor=`slider-${key}`;name.textContent=`${label}${unit?` (${unit})`:""}`;
    const number=document.createElement("input");number.type="number";number.min=min;number.max=max;number.step=step;number.setAttribute("aria-label",label);
    const slider=document.createElement("input");slider.type="range";slider.id=name.htmlFor;slider.min=min;slider.max=max;slider.step=step;
    const toSlider=value=>key==="bend"?Math.log1p(value)/Math.log1p(max):value;
    const fromSlider=value=>key==="bend"?Math.expm1(value*Math.log1p(max)):value;
    if(key==="bend"){slider.min=0;slider.max=1;slider.step=.0001;}
    for(const input of [number,slider]){
      input.addEventListener("input",()=>{
        const value=input===slider?fromSlider(input.valueAsNumber):input.valueAsNumber;if(!Number.isFinite(value)||value<min||value>max)return;
        settings[key]=value/factor;slider.value=format(toSlider(value));
        syncCurvePoints(key);
        if(input===slider)number.value=format(value);
        hint.textContent=help;requestDraw();
      });
      input.addEventListener("change",()=>{
        const value=input===slider?fromSlider(input.valueAsNumber):input.valueAsNumber;
        if(Number.isFinite(value))settings[key]=Math.max(min,Math.min(max,value))/factor;
        syncCurvePoints(key);
        number.value=format(settings[key]*factor);slider.value=format(toSlider(settings[key]*factor));requestDraw();
      });
      input.addEventListener("focus",()=>{hint.textContent=help;});
      input.addEventListener("pointerenter",()=>{hint.textContent=help;});
    }
    inputs.set(key,{number,slider,factor,toSlider});row.append(name,number,slider);
    (key==="width"||key==="zoom"?document.getElementById("geometry-controls"):controls).append(row);
  }
  syncPixelMode();
  function syncControls(){for(const[key,{number,slider,factor,toSlider}]of inputs){number.value=format(settings[key]*factor);slider.value=format(toSlider(settings[key]*factor));}}
  function syncCurvePoints(key){
    if(key==="brightPoint"&&settings.brightPoint>settings.dimPoint)settings.dimPoint=settings.brightPoint;
    if(key==="dimPoint"&&settings.dimPoint<settings.brightPoint)settings.brightPoint=settings.dimPoint;
    if(key!=="brightPoint"&&key!=="dimPoint")return;
    const other=inputs.get(key==="brightPoint"?"dimPoint":"brightPoint");
    const value=settings[key==="brightPoint"?"dimPoint":"brightPoint"]*other.factor;
    other.number.value=other.slider.value=format(value);
  }
  function resize(){
    W=scene.clientWidth;H=scene.clientHeight;
    const limit=nodeGraphPictureDevice()?.canvas.width||4096;
    ratio=Math.min(3,window.devicePixelRatio||1,limit/Math.max(1,W,H));
    canvas.width=Math.max(1,Math.round(W*ratio));canvas.height=Math.max(1,Math.round(H*ratio));
    if(!Number.isFinite(settings.zoom))settings.zoom=Math.min(1,W/1000,H/620);
    syncControls();requestDraw();
  }
  function curve(a,b){
    if(route.value==="trace")return new Float32Array([a.x,a.y,(a.x+b.x)/2,a.y,(a.x+b.x)/2,b.y,b.x,b.y]);
    const points=new Float32Array(130),reach=Math.max(70,Math.abs(b.x-a.x)*.55);
    for(let i=0;i<=64;i++){
      const t=i/64,u=1-t;
      points[i*2]=u*u*u*a.x+3*u*u*t*(a.x+reach)+3*u*t*t*(b.x-reach)+t*t*t*b.x;
      points[i*2+1]=u*u*u*a.y+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*b.y;
    }
    return points;
  }
  function requestDraw(){if(!frame&&!document.hidden&&visible)frame=requestAnimationFrame(draw);}
  function draw(time){
    frame=0;if(document.hidden||!visible){lastTime=null;return;}
    if(lastTime!==null)settings.phase+=settings.shimmerSpeed*(time-lastTime)/1000/settings.sheenLength;
    lastTime=time;
    const zoom=settings.zoom,camera={x:500-W/(2*zoom),y:300-H/(2*zoom),zoom};
    const appearance=selected.checked?{...settings,edgeBrightness:1}:settings;
    const batch=nodeGraphGlLinesBegin(canvas,[.035,.045,.055,1],{edge:"chrome",camera,scale:ratio,spectralWire:appearance});
    if(!batch){hint.textContent="WebGL2 unavailable";return;}
    const text=(s,x,y,px=15,rgba=[.88,.9,.88,1])=>nodeGraphGlLinesText(batch,s,x,y,{px,family:"monospace",rgba});
    for(let x=0;x<=1000;x+=28)nodeGraphGlLinesSegment(batch,x,-120,x,740,.15,1,[.18,.24,.26,.35]);
    for(let y=-120;y<=740;y+=28)nodeGraphGlLinesSegment(batch,0,y,1000,y,.15,1,[.18,.24,.26,.35]);
    const jack=nodeGraphGlLinesCss(nodeGraphJackChannelCssColor("magenta"));
    const a={x:nodes[0].x+160,y:nodes[0].y+65},b={x:nodes[1].x,y:nodes[1].y+65};
    const before=batch.n;
    nodeGraphGlLinesRibbon(batch,curve({x:255,y:540},{x:745,y:540}),1.5,2,[.89,.65,.4,1],.35,.5);
    debug.ordinaryVertices=(batch.n-before)/12;
    const start=batch.n;
    nodeGraphGlLinesRibbon(batch,new Float32Array([300,80,700,80]),settings.width/2,2,jack,0,.5,{spectral:true});
    text("Edge profile reference",300,25,13);
    nodeGraphGlLinesRibbon(batch,curve(a,b),settings.width/2,2,jack,0,.5,{spectral:true});
    debug.spectralVertices=(batch.n-start)/12;
    for(let i=0;i<2;i++){
      const n=nodes[i];nodeGraphGlLinesRect(batch,n.x,n.y,160,112,[.22,.29,.32,1]);nodeGraphGlLinesRect(batch,n.x+1,n.y+1,158,110,[.025,.035,.045,1]);
      text(i?"STFT Out":"STFT In",n.x+18,n.y+25,18);text("Spectral",n.x+18,n.y+87,13,jack);
    }
    for(const p of[a,b]){nodeGraphGlLinesDot(batch,p.x,p.y,5.5,1,jack);nodeGraphGlLinesDot(batch,p.x,p.y,3.5,1,[.055,.07,.085,1]);}
    text("Audio / parameter comparison",320,580,13,[.62,.68,.69,1]);
    if(!nodeGraphGlLinesEnd(batch))hint.textContent="WebGL2 render failed";
    debug.draws++;
    if(settings.shimmerSpeed!==0)requestDraw();else lastTime=null;
  }
  function world(event){const r=canvas.getBoundingClientRect(),z=settings.zoom;return{x:500+(event.clientX-r.left-W/2)/z,y:300+(event.clientY-r.top-H/2)/z};}
  canvas.addEventListener("pointerdown",event=>{
    const p=world(event),node=nodes.find(n=>p.x>=n.x&&p.x<=n.x+160&&p.y>=n.y&&p.y<=n.y+112);
    if(!node)return;dragging={node,x:p.x-node.x,y:p.y-node.y};canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove",event=>{if(!dragging)return;const p=world(event);dragging.node.x=p.x-dragging.x;dragging.node.y=p.y-dragging.y;requestDraw();});
  for(const event of["pointerup","pointercancel","lostpointercapture"])canvas.addEventListener(event,()=>{dragging=null;});
  route.addEventListener("change",requestDraw);selected.addEventListener("change",requestDraw);
  document.getElementById("reset").addEventListener("click",()=>{Object.assign(settings,defaults,{zoom:Math.min(1,W/1000,H/620)});syncControls();syncPixelMode();requestDraw();});
  document.getElementById("reset").addEventListener("click",saveSettings);
  canvas.addEventListener("pointerup",saveSettings);
  document.addEventListener("visibilitychange",()=>{lastTime=null;if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else requestDraw();});
  new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;lastTime=null;
    if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else requestDraw();
  }).observe(canvas);
  new ResizeObserver(resize).observe(scene);
})();
