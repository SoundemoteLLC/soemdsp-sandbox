// Real gesture regression probe. Own server/free port; never starts audio.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = process.env.SANDBOX_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = process.env.REPORT === "1";
const baseline = process.argv.includes("--baseline");
const baselineRef = process.env.BASELINE_REF || "60d52088";
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});
if ([8765, 8766, 8080].includes(port)) throw new Error("Reserved port");
const server = spawn("python", ["server.py", "--port", String(port)], { cwd: root, stdio: "ignore" });
let browser;
let failures = 0;
try {
  const url = `http://127.0.0.1:${port}/`;
  for (let n = 0; n < 240; n++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('soemdsp-sandbox.ioView.v1','B'));
  await page.addInitScript(narrow => { window.__narrowTitleProbe = narrow; }, process.env.NARROW_TITLE === '1');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (baseline) {
    const changed = execFileSync('git', ['diff', '--name-only', baselineRef, '--', 'public'], {cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>p.endsWith('.js'));
    for (const file of changed) {
      const body = execFileSync('git', ['show', `${baselineRef}:${file}`], {cwd:root,encoding:'utf8'});
      await page.route(`**/${file}*`, route => route.fulfill({contentType:'text/javascript',body}));
    }
  }
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#nodeBootStartButton").click().catch(() => {});
  await page.waitForFunction(() => typeof commitNodeGraphPatch === "function" && typeof viewFrame === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => document.body.classList.contains('node-boot-ready')
    && typeof createNodeSliderReadout === 'function' && typeof nodeGraphScopeWindowSettings !== 'undefined', null, {timeout:180000});
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || !b.clientHeight; }, null, { timeout: 180000 });
  const patch = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/view-real-guitar-pluck.json"), "utf8"));
  await page.evaluate(p => {
    p.nodes.push(createNodeGraphPatchNode('flowerChildFilter', {id:'flower-probe',gx:100,gy:5}));
    if (window.__narrowTitleProbe) {
      p.nodes.at(-1).widthGu = 2;
      p.nodes.at(-1).alias = 'Flower Child Filter - deliberately fitted title';
    }
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "gesture test" });
    setNodeGraphZoom(1);
    flushNodeGraphViewportImmediate({ persist: false });
    const nodes = [...document.querySelectorAll(".dsp-node")];
    const box = nodeGraphGlGraphWorldBox(nodes[0]);
    viewFrameRect({ x: box.x - 150, y: box.y - 80, w: 1000, h: 650 });
  }, patch);
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const original = nodeGraphGlLinesText;
    window.__gesture = { text: 0, frames: [], run: false };
    nodeGraphGlLinesText = function (...args) { if(args[0]?.canvas?.id === 'nodeGlGraphCanvas') window.__gesture.text++; return original(...args); };
  });
  const begin = () => page.evaluate(() => {
    const g = window.__gesture;
    g.text = 0; g.frames = []; g.run = true;
    g.bakes = nodeGraphGlLinesTextAtlasStats().bakes;
    let previous = performance.now();
    const tick = now => { g.frames.push(now - previous); previous = now; if (g.run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const end = async name => {
    const result = await page.evaluate(() => {
      const g = window.__gesture; g.run = false;
      const times = g.frames.slice(1).sort((a,b) => a-b);
      return { textCalls: g.text, atlasBakes: nodeGraphGlLinesTextAtlasStats().bakes - g.bakes,
        frames: times.length, meanMs: times.reduce((a,b)=>a+b,0)/Math.max(1,times.length), p95Ms: times[Math.floor(times.length*.95)] || 0 };
    });
    console.log(`${name}: ${JSON.stringify(result)}`);
    if (!report && !baseline && (result.textCalls || result.atlasBakes)) failures++;
  };
  const title = page.locator(".dsp-node .node-header-title-row").first();
  const dragId = await title.evaluate(e=>e.closest('.dsp-node').dataset.node);
  const bounds = await title.boundingBox();
  if (!bounds) throw new Error("No visible title");
  if (!baseline) await page.evaluate(id => {
    window.__dragRecord = nodeGraphGlGraphState.mesh.batches[0].layers.find(l=>l.moduleRecord?.id === id);
    if (!window.__dragRecord) throw new Error('Missing movable module record');
  },dragId);
  await page.mouse.move(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
  await begin();
  await page.mouse.down();
  await page.waitForTimeout(150);
  for (let i=1; i<=40; i++) { await page.mouse.move(bounds.x + bounds.width/2 + i*2, bounds.y + bounds.height/2 + i); await page.waitForTimeout(16); }
  if (!baseline) await page.evaluate(id => {
    const records = nodeGraphGlGraphState.mesh.batches[0].layers.filter(l=>l.moduleRecord);
    const layer = records.find(l=>l.moduleRecord.id === id);
    if (layer !== window.__dragRecord) throw new Error('Drag replaced module ink');
    if (Math.hypot(layer.worldOffset.x,layer.worldOffset.y)<1) throw new Error('Retained module did not move');
    if (records.at(-1).moduleRecord.id !== id) throw new Error('Raised module did not draw in front');
    if (Math.abs(layer.camera.x - (nodeGraphGlGraphState.mesh.batches[0].camera.x - layer.worldOffset.x)) > .001) throw new Error('Module translation did not reach the GL camera');
  },dragId);
  await end("module drag");
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await begin();
  await page.keyboard.down("d"); await page.waitForTimeout(1000); await page.keyboard.up("d");
  await page.waitForTimeout(200);
  await end("WASD pan");
  await page.mouse.move(700,450);
  await page.mouse.wheel(0,-120);
  await page.waitForFunction(() => !nodeGraphGlGraphSharpenWanted() && !nodeGraphViewCamera.qualityPending, null, {timeout:30000});
  await begin();
  await page.mouse.down({button:'middle'});
  await page.waitForTimeout(200);
  await end('zoom then middle press');
  await page.mouse.up({button:'middle'});
  // Reframe real output jacks, then pull wires without committing them.
  for (const jack of ['clock-1','flower-probe']) {
  await page.evaluate(id => {
    const b = nodeGraphModuleGeometryGet(id).box;
    viewFrameRect({ x: b.x - 150, y: b.y - 80, w: 1000, h: 650 });
  },jack);
  await page.waitForTimeout(2000);
  await page.evaluate(() => { nodeGraphModuleGeometryPublishVisible(); drawNodeGraphWires(); });
  await page.waitForTimeout(1200);
  const jb = await page.evaluate(id => {
    const host = document.getElementById('nodeGraphWorkspace'); const r = host.getBoundingClientRect();
    const cam = nodeGraphWireCameraViewBox(host); const zoom = nodeGraphZoom();
    const jack = nodeGraphGlGraphState.chrome.jacks.find(j => String(j.id) === id && j.io === 'output' && j.signal);
    if (!jack) throw new Error(`No output jack for ${id}`);
    const x = r.left + (jack.x-cam.x)*zoom; const y = r.top + (jack.y-cam.y)*zoom;
    return { x, y, hit: nodeGraphGlHitTest(jack.x,jack.y)?.kind, el:document.elementFromPoint(x,y)?.className };
  }, jack);
  await page.mouse.move(jb.x, jb.y);
  await page.mouse.down();
  await page.mouse.move(jb.x + 12, jb.y + 12);
  await page.waitForTimeout(250);
  if (!await page.evaluate(() => nodeGraphMvp.wireDragging?.active || nodeGraphMvp.portConnectionMode?.movingWires)) throw new Error(`Wire drag did not start: ${jack} ${JSON.stringify(jb)}`);
  await begin();
  for (let i=0; i<120; i++) { await page.mouse.move(jb.x + 70 + (i%60)*3, jb.y + 80 + Math.sin(i*.1)*40); await page.waitForTimeout(16); }
  await end(`wire drag ${jack}`);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  }
  const audio = await page.evaluate(()=>({transport:nodeGraphLiveTransportUiState(),engine:Boolean(nodeGraphMvp.live.node)}));
  if (audio.transport !== 'stopped' || audio.engine) throw new Error(`Gesture test unexpectedly started audio: ${JSON.stringify(audio)}`);
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser?.close();
  server.kill();
}
if (failures) throw new Error(`${failures} gestures rebuilt unchanged text`);
