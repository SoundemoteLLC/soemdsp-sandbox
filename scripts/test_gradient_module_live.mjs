// HP-23: the Gradient module and the audio-rate path, in the real page with live audio (efficient native worklet). Its own server.py port
// (never 8765 / 8766 / 8080) unless SANDBOX_URL is set.
//   - dragging a gradient's name from the rainbow page into the circuit places a Gradient module bound to that gradient;
//   - its Playhead knob and the page playhead are one value (gradient.position);
//   - live: a knob drag posts one "gradientPlayhead" message per move and no setParams until the release; the engine's Gradient node
//     publishes the playhead it plays (data bus "Playhead"), and it matches; no lane errors from the worklet.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }

let server = null;
let browser = null;
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "server.py"), "--port", String(port)], { cwd: root, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(baseUrl)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  // A gradient on the oscillator's Frequency; the page open.
  const setup = await page.evaluate(async () => {
    const osc = nodeGraphMvp.patch.nodes.find((n) => n.type === "polyBlep");
    const meta = nodeGraphReadPatchParameterMetadata(osc, "frequency");
    const s0 = nodeGraphParamControlPosition(osc.params.frequency, meta);
    nodeGraphMvp.patch.gradients = NodeGraphGradients.normalize([{ id: "g1", name: "Sweep", enabled: true, position: 0,
      origin: { [osc.id]: { frequency: s0 } }, params: [{ nodeId: osc.id, key: "frequency" }],
      stops: [{ id: "s1", pos: 0, offsets: {} }, { id: "s2", pos: 1, offsets: { [osc.id]: { frequency: 0.2 } } }] }]);
    recordNodeGraphHistory();
    openNodeGraphUnifiedWindowPage("gradients");
    const panel = document.getElementById("nodeGradientsPage");
    panel.style.left = "10px";
    panel.style.top = "60px";
    await new Promise((r) => setTimeout(r, 150));
    const name = document.querySelector('#nodeGradientsBody [data-gradient-drag="g1"]');
    const r = name.getBoundingClientRect();
    return { osc: osc.id, x: r.left + r.width / 2, y: r.top + r.height / 2, nodes: nodeGraphMvp.patch.nodes.length };
  });

  // Drag the gradient's name into the circuit (real mouse).
  await page.mouse.move(setup.x, setup.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i += 1) await page.mouse.move(setup.x + i * 45, setup.y + i * 25);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const placed = await page.evaluate(() => {
    const mod = nodeGraphMvp.patch.nodes.find((n) => n.type === "gradient");
    return mod ? { id: mod.id, gradientId: mod.gradientId } : null;
  });
  assert.ok(placed && placed.gradientId === "g1", `dragging the gradient in places a Gradient module bound to it ${JSON.stringify(placed)}`);

  // The face is read-only WebGL for stops, colors, curve and playhead; its mouse path is the shared Playhead slider gesture.
  const faceVisual = await page.evaluate(({ id, oscId }) => {
    const node = nodeGraphPatchNode(id);
    const gradient = nodeGraphMvp.patch.gradients.find((g) => g.id === "g1");
    gradient.stops[0].color = "#12ab34";
    gradient.stops[0].curves = { [oscId]: { frequency: { shape: "smoothstep", skew: 0.35 } } };
    node.traceDisplaySettings = { playheadAlpha: 0.42, playheadColor: "#22aaff", playheadThickness: 5 };
    const face = document.querySelector(`.node-gradient-module-face[data-node="${CSS.escape(id)}"]`);
    const surface = face?.querySelector(".node-display-face");
    const slider = nodeGraphSliderForParameter(id, "playhead");
    const readout = slider?.closest?.(".node-slider-readout") || slider?.closest?.(".node-knob-face") || null;
    window.__gradientFacePointerDown = 0;
    face?.addEventListener("pointerdown", () => { window.__gradientFacePointerDown += 1; });
    window.__gradientFaceDblClick = 0;
    face?.addEventListener("dblclick", () => { window.__gradientFaceDblClick += 1; });
    window.__gradientFacePointerTarget = "";
    document.addEventListener("pointerdown", (event) => {
      if (event.clientX >= box.x && event.clientX <= box.right && event.clientY >= box.y && event.clientY <= box.bottom) {
        window.__gradientFacePointerTarget = String(event.target?.className || event.target?.tagName || "");
      }
    }, true);
    const rectCalls = [];
    let curves = 0;
    const rect = nodeGraphGlLinesRect;
    const line = nodeGraphGlLinesPolyline;
    nodeGraphGlLinesRect = function (batch, x, y, w, h, color, ...rest) {
      if (batch?.canvas === surface) rectCalls.push({ x, y, w, h, color: Array.isArray(color) ? color.slice() : color });
      return rect(batch, x, y, w, h, color, ...rest);
    };
    nodeGraphGlLinesPolyline = function (batch, ...args) {
      if (batch?.canvas === surface) curves += 1;
      return line(batch, ...args);
    };
    face._gradientForceDraw = true;
    drawNodeGraphGradientModuleFace(face);
    nodeGraphGlLinesRect = rect;
    nodeGraphGlLinesPolyline = line;
    const saved = loadNodeGraphPatchFromScript(serializeNodeGraphPatch(nodeGraphMvp.patch));
    const cloned = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const savedNode = saved.nodes.find((n) => n.id === id);
    const savedStop = saved.gradients.find((g) => g.id === "g1").stops[0];
    const expected = [18 / 255, 171 / 255, 52 / 255];
    const colorDrawn = rectCalls.some(({ color }) => Array.isArray(color) && expected.every((v, i) => Math.abs(color[i] - v) < 1e-6));
    const playheadExpected = [34 / 255, 170 / 255, 255 / 255, 0.42];
    const playheadDrawn = rectCalls.some(({ w, color }) => Math.abs(w - 5) < 1e-6 && Array.isArray(color)
      && playheadExpected.every((v, i) => Math.abs(color[i] - v) < 1e-6));
    const box = face.getBoundingClientRect();
    return {
      colorDrawn,
      playheadDrawn,
      curveDrawn: curves > 0,
      optionsRoundTrip: JSON.stringify(savedNode.traceDisplaySettings) === JSON.stringify(node.traceDisplaySettings)
        && JSON.stringify(cloned.nodes.find((n) => n.id === id).traceDisplaySettings) === JSON.stringify(node.traceDisplaySettings),
      colorRoundTrip: savedStop.color === "#12ab34" && cloned.gradients.find((g) => g.id === "g1").stops[0].color === "#12ab34",
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      reset: nodeSliderCtrlClickDefaultValue(nodeGraphSliderForParameter(id, "playhead")),
      hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.className || "",
      pointerEvents: getComputedStyle(face).pointerEvents,
      sliderExists: Boolean(slider),
      readout: readout ? { className: readout.className, target: readout.dataset.sliderTarget, pointerEvents: getComputedStyle(readout).pointerEvents } : null,
    };
  }, { id: placed.id, oscId: setup.osc });
  assert.ok(faceVisual.colorDrawn && faceVisual.playheadDrawn && faceVisual.curveDrawn, `the WebGL face draws the chosen stop color, playhead options and shared curve ${JSON.stringify(faceVisual)}`);
  assert.ok(faceVisual.optionsRoundTrip && faceVisual.colorRoundTrip, `display options and stop colors survive save/load/clone ${JSON.stringify(faceVisual)}`);
  const startPos = await page.evaluate(() => nodeGraphMvp.patch.gradients.find((g) => g.id === "g1").position);
  await page.mouse.move(faceVisual.box.x + faceVisual.box.width / 2, faceVisual.box.y + faceVisual.box.height / 2);
  await page.mouse.down();
  const faceDragStarted = await page.evaluate(() => ({ drag: Boolean(nodeGraphMvp.sliderDragging), pointerDown: window.__gradientFacePointerDown, target: window.__gradientFacePointerTarget }));
  await page.mouse.move(faceVisual.box.x + faceVisual.box.width / 2 + 35, faceVisual.box.y + faceVisual.box.height / 2 + 25, { steps: 6 });
  await page.mouse.up();
  const draggedPos = await page.evaluate(() => nodeGraphMvp.patch.gradients.find((g) => g.id === "g1").position);
  assert.ok(faceDragStarted.drag && Math.abs(draggedPos - startPos) > 1e-4, `dragging the WebGL face uses the existing Playhead slider path ${JSON.stringify({ faceDragStarted, startPos, draggedPos, faceVisual })}`);
  await page.mouse.dblclick(faceVisual.box.x + faceVisual.box.width / 2, faceVisual.box.y + faceVisual.box.height / 2);
  const faceReset = await page.evaluate(() => ({ position: nodeGraphMvp.patch.gradients.find((g) => g.id === "g1").position, dblclicks: window.__gradientFaceDblClick }));
  assert.ok(Math.abs(faceReset.position - faceVisual.reset) < 1e-4, `the shared slider double-press gesture resets the Playhead ${JSON.stringify({ faceReset, faceVisual })}`);

  // The knob and the page playhead are one value.
  const knob = await page.evaluate((id) => {
    const slider = nodeGraphSliderForParameter(id, "playhead");
    setNodeSliderValue(slider, 0.6, { interaction: "drag" });
    commitNodeSliderDragValue(slider);
    const g = nodeGraphMvp.patch.gradients.find((x) => x.id === "g1");
    const ph = document.querySelector('#nodeGradientsBody .node-gradient-card[data-gradient-id="g1"] .node-gradient-playhead');
    return { position: g.position, pageLeft: ph?.style.left, param: nodeGraphPatchNode(id).params.playhead };
  }, placed.id);
  assert.ok(knob.position === 0.6 && knob.param === 0.6 && Math.abs(parseFloat(knob.pageLeft) - 60) < 1e-6, `knob = page playhead ${JSON.stringify(knob)}`);

  // The binding is saved and loaded with the patch.
  const saved = await page.evaluate((id) => {
    const loaded = loadNodeGraphPatchFromScript(serializeNodeGraphPatch(nodeGraphMvp.patch));
    return { gradientId: loaded.nodes.find((n) => n.id === id)?.gradientId, cloned: cloneNodeGraphPatch(nodeGraphMvp.patch).nodes.find((n) => n.id === id)?.gradientId };
  }, placed.id);
  assert.ok(saved.gradientId === "g1" && saved.cloned === "g1", `save / load / clone keep the binding ${JSON.stringify(saved)}`);

  // Live audio.
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
  await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.usesWorklet, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const live = await page.evaluate(async (id) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const port = nodeGraphMvp.live.node.port;
    const laneErrors = [];
    port.addEventListener("message", (e) => {
      const m = e.data || {};
      if (m.type === "nativeGraphError" && /Gradient lane/.test(String(m.message))) laneErrors.push(m.message);
    });
    const sent = [];
    const post = port.postMessage.bind(port);
    port.postMessage = (m, ...rest) => { sent.push(m && m.type); return post(m, ...rest); };
    const slider = nodeGraphSliderForParameter(id, "playhead");
    for (const v of [0.31, 0.32, 0.33]) { setNodeSliderValue(slider, v, { interaction: "drag" }); await wait(40); }
    const duringDrag = sent.slice();
    commitNodeSliderDragValue(slider);
    await wait(120);
    // The engine plays what the knob says: its Gradient node publishes the playhead.
    let published = NaN;
    for (let i = 0; i < 60; i += 1) {
      const v = nodeGraphDataBus.get(nodeGraphDataBusKey(id, "Playhead"));
      published = v && v.length ? Number(v[0]) : NaN;
      if (Math.abs(published - 0.33) < 1e-3) break;
      await wait(50);
    }
    port.postMessage = post;
    return { duringDrag, published, laneErrors, lanes: (nodeGraphGradientLanesForLive() || []).map((l) => ({ source: l.sourceId, hidden: l.hidden, targets: l.targets.length })) };
  }, placed.id);
  const playheadPosts = live.duringDrag.filter((t) => t === "gradientPlayhead").length;
  assert.ok(playheadPosts === 3 && !live.duringDrag.includes("setParams"), `a knob drag moves one engine knob, no param resync ${JSON.stringify(live)}`);
  assert.ok(Math.abs(live.published - 0.33) < 1e-3, `the engine plays the knob's playhead ${JSON.stringify(live)}`);
  assert.ok(live.lanes.length === 1 && live.lanes[0].source === placed.id && !live.lanes[0].hidden && live.lanes[0].targets === 1, `one lane from the module ${JSON.stringify(live)}`);
  assert.deepEqual(live.laneErrors, [], "no lane errors");

  // What sounds: the oscillator plays the gradient's value once (base pushed, lane adds the offset), not the offset twice.
  const heard = await page.evaluate(async (oscId) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ctx = nodeGraphMvp.live.context;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32768;
    nodeGraphMvp.live.node.connect(analyser);
    const osc = nodeGraphPatchNode(oscId);
    const p = { ...osc.params };
    applyNodeGraphParamOffsets(osc, p);
    await wait(900);
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    nodeGraphMvp.live.node.disconnect(analyser);
    const at = [];
    for (let i = 1; i < buf.length; i += 1) if (buf[i - 1] < 0 && buf[i] >= 0) at.push(i - 1 + -buf[i - 1] / (buf[i] - buf[i - 1]));
    const hz = at.length > 1 ? (at.length - 1) / ((at[at.length - 1] - at[0]) / ctx.sampleRate) : 0;
    return { expected: p.frequency, base: osc.params.frequency, hz };
  }, setup.osc);
  assert.ok(Math.abs(heard.hz - heard.expected) / heard.expected < 0.03, `the oscillator sounds at the gradient's value ${JSON.stringify(heard)}`);

  // Page only (no module bound): a hidden Gradient node in the engine plays the page's playhead.
  const hiddenRun = await page.evaluate(async (id) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    nodeGraphPatchNode(id).gradientId = "";
    recordNodeGraphHistory();
    scheduleNodeGraphLiveParameterSync();
    await wait(300);
    const g = nodeGraphMvp.patch.gradients.find((x) => x.id === "g1");
    g.position = 0.7;
    nodeGraphGradientsNotifyPlayhead(g, "test");
    let published = NaN;
    for (let i = 0; i < 60; i += 1) {
      const v = nodeGraphDataBus.get(nodeGraphDataBusKey("__gradient:g1", "Playhead"));
      published = v && v.length ? Number(v[0]) : NaN;
      if (Math.abs(published - 0.7) < 1e-3) break;
      await wait(50);
    }
    const lanes = nodeGraphGradientLanesForLive() || [];
    return { published, hidden: lanes[0]?.hidden, source: lanes[0]?.sourceId };
  }, placed.id);
  assert.ok(hiddenRun.hidden && hiddenRun.source === "__gradient:g1" && Math.abs(hiddenRun.published - 0.7) < 1e-3,
    `page-only gradients play through a hidden engine node ${JSON.stringify(hiddenRun)}`);
  assert.deepEqual(errors, [], "no page errors");
  console.log(`test_gradient_module_live: ok (drag-in binds, knob = page playhead, drag = ${playheadPosts} playhead posts and no setParams, engine plays ${live.published.toFixed(3)}, heard ${heard.hz.toFixed(1)} Hz for ${heard.expected.toFixed(1)} Hz)`);
} finally {
  await browser?.close();
  server?.kill();
}
