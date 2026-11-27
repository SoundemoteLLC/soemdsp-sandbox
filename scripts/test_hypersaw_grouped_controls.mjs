import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.on("error", reject);
  socket.listen(0, "127.0.0.1", () => { const p = socket.address().port; socket.close(() => resolve(p)); });
});
assert(![8765, 8766, 8080].includes(port));
const server = spawn("python", ["server.py", "--port", String(port)], { cwd: root, stdio: "ignore" });
let browser;
try {
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#nodeBootStartButton").click().catch(() => {});
  await page.waitForFunction(() => document.body.classList.contains("node-boot-ready")
    && typeof createNodeGraphPatchNode === "function", null, { timeout: 180000 });
  for (const [name, width] of [["desktop", 1400], ["mobile", 390]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async () => {
      const node = createNodeGraphPatchNode("hypersaw2", { id: "hs", gx: 3, gy: 3 });
      const magnet = createNodeGraphPatchNode("analogDistortion", { id: "mag", gx: 15, gy: 3 });
      const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
      commitNodeGraphPatch({ ...base, nodes: [node, magnet], cables: [] }, { status: "grouped controls test" });
      setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false });
      await new Promise(requestAnimationFrame);
      const box = nodeGraphModuleGeometryGet("hs").box;
      viewFrameRect({ x: box.x - 12, y: box.y - 12, w: box.w + 24, h: box.h + 24 });
    });
    await page.waitForTimeout(1800);
    const result = await page.evaluate(() => {
      const el = nodeGraphNodeElement("hs");
      const face = el.querySelector(".node-face");
      const spec = nodeGraphModuleFaceSpecForElement(el);
      const widgets = nodeGraphModuleFaceWidgets(spec, face.offsetWidth, el);
      const pads = widgets.filter(w => w.type === "xyPad");
      const calls = [];
      const original = nodeGraphGlLinesText;
      nodeGraphGlLinesText = function(batch, text, x, y, options) {
        calls.push({ text: String(text), x, y, px: options.px, maxWidth: options.maxWidth });
        return original.apply(this, arguments);
      };
      const canvas = document.createElement("canvas");
      canvas.width = face.offsetWidth; canvas.height = face.offsetHeight;
      const batch = nodeGraphGlLinesBegin(canvas, [0,0,0,0], { transparent: true, scale: 1 });
      try { nodeGraphModuleFaceDrawGl(batch, el, face.offsetWidth, 0, 0, 1); }
      finally { nodeGraphGlLinesText = original; }
      const drawn = nodeGraphGlLinesEnd(batch, "alpha");
      const values = pads.map(pad => {
        const box = nodeGraphModuleFaceXyBox(pad);
        const rowCalls = calls.filter(c => c.y >= pad.y && c.y <= pad.y + pad.h
          && c.x < widgets.find(w=>w.row === pad.row && w.type === "cell").x);
        return { texts: rowCalls.map(c=>c.text), inside: rowCalls.every(c=>c.x >= box.x && c.x <= box.x+box.w && c.y >= box.y && c.y <= box.y+box.h), expected: [pad.param,pad.py].map(key=>nodeGraphModuleFaceValueParts(nodeGraphModuleFaceInput(el,key)).text) };
      });
      const point = wd => {
        const r = face.getBoundingClientRect();
        return { x: r.left + (wd.x + wd.w/2)*r.width/face.offsetWidth, y: r.top + (wd.y + wd.h/2)*r.height/face.offsetHeight };
      };
      const localBox = nodeGraphModuleFaceXyBox(pads[0]);
      const faceRect = face.getBoundingClientRect();
      const xyBounds = { x: faceRect.left + localBox.x*faceRect.width/face.offsetWidth, y: faceRect.top + localBox.y*faceRect.height/face.offsetHeight, w:localBox.w*faceRect.width/face.offsetWidth, h:localBox.h*faceRect.height/face.offsetHeight };
      const mag = nodeGraphNodeElement("mag");
      const magTexts = [];
      const magCanvas = document.createElement("canvas");
      magCanvas.width = 224; magCanvas.height = nodeGraphModuleFaceHeightPx("analogDistortion");
      const magBatch = nodeGraphGlLinesBegin(magCanvas,[0,0,0,0],{transparent:true,scale:1});
      nodeGraphGlLinesText = function(batch,text) { magTexts.push(String(text)); return original.apply(this,arguments); };
      try { nodeGraphModuleFaceDrawGl(magBatch,mag,224,0,0,1); }
      finally { nodeGraphGlLinesText = original; }
      const magDrawn = nodeGraphGlLinesEnd(magBatch,"alpha");
      const ghostCases = [];
      const xi = nodeGraphModuleFaceInput(el,"jitterDistance");
      const yi = nodeGraphModuleFaceInput(el,"jitterSpeed");
      const readouts = [xi,yi].map(input=>input.closest('label').querySelector('.node-slider-readout'));
      const originalDot = nodeGraphGlLinesDot;
      const originalRing = nodeGraphGlLinesRing;
      const ghostInk = nodeGraphModuleFaceRgba(NodeGraphFaceInk.ghost);
      const xyBox = nodeGraphModuleFaceXyBox(pads[0]);
      for (const enabled of [[false,false],[true,false],[false,true],[true,true]]) {
        const targets = [.8,.3];
        [xi,yi].forEach((input,i)=>{
          readouts[i].classList.toggle('has-ghost-slider',enabled[i]);
          if (enabled[i]) input.dataset.sentDomainValue = String(nodeSliderValueFromTravel(input,targets[i]));
          else delete input.dataset.sentDomainValue;
        });
        const dots = [];
        const paintOrder = [];
        const rings = [];
        nodeGraphGlLinesRing = function(batch,x,y,radius,stroke,feather,rgba) {
          rings.push({radius,ghost:rgba.every((v,i)=>Math.abs(v-ghostInk[i])<1e-6)});
          return originalRing.apply(this,arguments);
        };
        nodeGraphGlLinesDot = function(batch,x,y,radius,feather,rgba) {
          if (rgba.every((v,i)=>Math.abs(v-ghostInk[i])<1e-6)) {
            dots.push({x,y});
            paintOrder.push('ghost');
          } else if (Math.abs(radius-3)<.001) paintOrder.push('base');
          return originalDot.apply(this,arguments);
        };
        const probe = nodeGraphGlLinesBegin(canvas,[0,0,0,0],{transparent:true,scale:1});
        try { nodeGraphModuleFaceDrawGl(probe,el,face.offsetWidth,0,0,1); }
        finally { nodeGraphGlLinesDot = originalDot; nodeGraphGlLinesRing = originalRing; }
        nodeGraphGlLinesEnd(probe,'alpha');
        const travels = [xi,yi].map((input,i)=>enabled[i]?nodeGraphModuleFaceGhostTravel(input):nodeGraphModuleFaceTravel(input));
        ghostCases.push({ enabled, dots, paintOrder, rings, expected:{x:xyBox.x+travels[0]*xyBox.w,y:xyBox.y+(1-travels[1])*xyBox.h} });
      }
      [xi,yi].forEach((input,i)=>{readouts[i].classList.remove('has-ghost-slider'); delete input.dataset.sentDomainValue;});
      window.__hsProbe = { el, face, widgets };
      return { drawn, values, pads: pads.map(p=>({x:p.param,y:p.py,h:p.h})),
        ghostCases, railLabels:['jitterDistance','jitterSpeed','jitterFilter','vibratoDistance','vibratoSpeed'].map(key=>[key,el.querySelector(`.node-parameter-row[data-param="${key}"] > .node-param-port`).dataset.railLabel]),
        xyBounds, magDrawn, magTexts, magExpected: ['magX','magY'].map((key,i)=>`${i?'Y':'X'} ${nodeGraphModuleFaceValueText(nodeGraphModuleFaceInput(mag,key))}`),
        sectionHeight: spec.filter(r=>r.kind === "group" || r.kind === "xy").reduce((sum,r)=>sum+nodeGraphModuleFaceRowHeight(r),0),
        headerHeights: spec.filter(r=>r.kind === "group").map(r=>nodeGraphModuleFaceRowHeight(r)),
        railHeights: [...el.querySelectorAll('.node-parameter-row[data-param^="jitter"] > .node-param-port')].map(port=>Number.parseFloat(port.style.height)),
        choice: point(widgets.find(w=>w.param === "jitterSteps" && w.index === 1)),
        xy: point(pads[0]),
        filter: point(widgets.find(w=>w.param === "jitterFilter")),
        phase: point(widgets.find(w=>w.param === "vibratoPhaseVary")),
        magnet: nodeGraphModuleFaceSpec("analogDistortion").some(r=>r.kind === "xy" && r.x === "magX" && r.h === 124),
      };
    });
    assert.equal(result.drawn, true, `${name}: shared GL renders the face`);
    assert.equal(result.sectionHeight, 157);
    assert.deepEqual(result.headerHeights,[20,20],"both headers use the same single row height");
    assert(result.railHeights.every(h=>h>=17),"header/body group preserves readable rail slots");
    assert.deepEqual(result.pads.map(p=>[p.x,p.y]), [["jitterDistance","jitterSpeed"],["vibratoDistance","vibratoSpeed"]]);
    for (const value of result.values) {
      assert(value.inside,"both axis labels and values stay inside the pad");
      for (const text of ["Distance","Speed","Hz",...value.expected]) assert(value.texts.includes(text), `${name}: XY prints ${text}`);
    }
    assert(result.magnet, "Magnet still uses its unchanged shared XY row");
    assert(result.magDrawn && result.magExpected.every(text=>result.magTexts.includes(text)),"Magnet prints both values through the same shared XY painter");
    assert.deepEqual(result.railLabels.map(item=>item[1]),['Dist','Spd','Filt','Dist','Spd']);
    for (const ghost of result.ghostCases) {
      assert.equal(ghost.dots.length,ghost.enabled.some(Boolean)?1:0,`ghost dot for ${ghost.enabled}`);
      assert(!ghost.paintOrder.includes('base'),'shared XY handle is hollow, without a white center dot');
      assert.equal(ghost.rings.length,2,'one blue ring per pad, no additional ghost ring');
      assert(ghost.rings.every(ring=>!ring.ghost&&ring.radius===4.5),'shared XY rings use the smaller radius');
      if (ghost.dots.length) {
        assert(Math.hypot(ghost.dots[0].x-ghost.expected.x,ghost.dots[0].y-ghost.expected.y)<.001,"unmodulated ghost axis stays at its knob position");
      }
    }
    await page.mouse.click(result.choice.x, result.choice.y);
    assert.equal(await page.evaluate(()=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,"jitterSteps"))),1);
    const before = await page.evaluate(()=>["jitterDistance","jitterSpeed"].map(k=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,k))));
    await page.mouse.move(result.xy.x,result.xy.y); await page.mouse.down();
    assert.deepEqual(await page.evaluate(()=>["jitterDistance","jitterSpeed"].map(k=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,k)))),before,"plain XY press does not jump");
    await page.mouse.move(result.xy.x+12,result.xy.y-12,{steps:4}); await page.mouse.up();
    const after = await page.evaluate(()=>["jitterDistance","jitterSpeed"].map(k=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,k))));
    assert(after.every((value,i)=>value !== before[i]),"XY drag edits both axes");
    await page.keyboard.down("Alt");
    await page.mouse.click(result.xyBounds.x+result.xyBounds.w*.7,result.xyBounds.y+result.xyBounds.h*.3);
    await page.keyboard.up("Alt");
    const travel = await page.evaluate(()=>['jitterDistance','jitterSpeed'].map(key=>nodeGraphModuleFaceTravel(nodeGraphModuleFaceInput(__hsProbe.el,key))));
    assert(travel.every(t=>Math.abs(t-.7)<.04),"Alt jump uses the rectangular pad's true X/Y dimensions");
    await page.waitForTimeout(350);
    await page.keyboard.down("Control"); await page.mouse.click(result.xy.x,result.xy.y); await page.keyboard.up("Control");
    const reset = await page.evaluate(()=>['jitterDistance','jitterSpeed'].map(key=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,key))));
    assert(reset.every((value,i)=>Math.abs(value-before[i])<1e-5),"Ctrl click resets both XY parameters");
    for (const [key,point] of [["jitterFilter",result.filter],["vibratoPhaseVary",result.phase]]) {
      const before = await page.evaluate(k=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,k)),key);
      await page.mouse.move(point.x,point.y); await page.mouse.down();
      await page.mouse.move(point.x,point.y-16,{steps:4}); await page.mouse.up();
      assert.notEqual(await page.evaluate(k=>nodeGraphModuleFaceValue(nodeGraphModuleFaceInput(__hsProbe.el,k)),key),before,`${key} vertical slider changes`);
    }
    await page.waitForTimeout(400);
    await page.mouse.move(5,200);
    await page.evaluate(()=>{ if(typeof setNodeInteractionHelp === 'function') setNodeInteractionHelp(''); });
    await page.waitForTimeout(100);
    fs.mkdirSync(path.join(root,"test-results"),{recursive:true});
    await page.screenshot({ path:path.join(root,"test-results",`hypersaw-grouped-${name}.png`) });
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>nodeGraphLiveTransportUiState()),"stopped");
    console.log(`ok ${name}: 157px, single-row headers, shared GL XY values/units inside, relative drag and vertical cells`);
  }
  await page.close();
} finally { await browser?.close(); server.kill(); }
