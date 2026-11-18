import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(new URL("../../soemdsp-sandbox/package.json", import.meta.url))("playwright")); }
const base = process.env.SANDBOX_URL || "http://127.0.0.1:9447/";
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto(`${base}?mode=circuitbuilder`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof showNodeGraphModule === "function"
    && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 60000 });
  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const mod = showNodeGraphModule("polyBlep", { x: 20, y: 40 }, options);
    const car = showNodeGraphModule("polyBlep", { x: 20, y: 300 }, options);
    const vocoder = showNodeGraphModule("vocoder", { x: 400, y: 40 }, options);
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    if (![mod, car, vocoder].every(id => id && patch.nodes.some(n => n.id === id)))
      throw new Error(JSON.stringify({ mod, car, vocoder, nodes: patch.nodes.map(n => [n.id, n.type]) }));
    patch.nodes = patch.nodes.filter(n => [mod, car, vocoder].includes(n.id) || n.type === "output");
    const output = patch.nodes.find(n => n.type === "output");
    if (!output) throw new Error("test requires default Output");
    patch.nodes.find(n => n.id === mod).params = { waveform: 1, frequency: 187.5, amplitude: 0.2 };
    patch.nodes.find(n => n.id === car).params = { waveform: 1, frequency: 110, amplitude: 0.2 };
    const wire = (sourceNode, sourcePort, destinationNode, destinationPort) =>
      ({ sourceNode, sourcePort, destinationNode, destinationPort });
    patch.connections = [wire(mod, "Wave", vocoder, "Voice L"), wire(car, "Wave", vocoder, "Synth L"),
      wire(vocoder, "Left", output.id, "Left"), wire(vocoder, "Right", output.id, "Right")];
    patch.modulations = [];
    commitNodeGraphPatch(patch, { status: "Vocoder browser test" });
    const plan = nodeGraphBuildLivePlan();
    if (plan.issues?.length) throw new Error(JSON.stringify(plan.issues));
    return { mod, car, vocoder };
  });
  assert.ok(ids.vocoder);
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
  await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.outputLevelSmooth > 0.00001,
    null, { timeout: 60000 });
  const originalWorklet = await page.evaluate(() => {
    globalThis.vocoderTestOriginalWorklet = nodeGraphMvp.live.node;
    return Boolean(vocoderTestOriginalWorklet);
  });
  assert.ok(originalWorklet);
  for (const count of [5, 64, 100]) {
    await page.evaluate(({ id, count }) => {
      const slider = nodeGraphSliderForParameter(id, "bands");
      slider.value = String(count);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    }, { id: ids.vocoder, count });
    await page.waitForTimeout(200);
    const actual = await page.evaluate(id => Number(nodeGraphPatchNode(id).params.bands), ids.vocoder);
    assert.equal(actual, count, "Bands uses the normal parameter control path");
  }
  const reports = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(id => {
      const slider = nodeGraphSliderForParameter(id, "bandWidth");
      const box = slider.closest("article").getBoundingClientRect();
      const workspace = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
      nodeGraphMvp.pan.x += (innerWidth - box.width) / 2 - box.left;
      nodeGraphMvp.pan.y += workspace.top + 25 - box.top;
      applyNodeGraphViewportCssLight();
    }, ids.vocoder);
    await page.waitForTimeout(300);
    reports.push(await page.evaluate(id => {
      const node = nodeGraphPatchNode(id), slider = nodeGraphSliderForParameter(id, "bandWidth");
      const box = slider.closest("article").getBoundingClientRect();
      const bands = nodeGraphSliderForParameter(id, "bands");
      return { width: box.width, height: box.height, scope: nodeGraphModuleDisplayRendererForNode(node),
        min: slider.min, peak: nodeGraphMvp.live.outputLevelSmooth,
        bands: Number(node.params.bands), bandLimit: Number(bands.max),
        sameWorklet: nodeGraphMvp.live.node === vocoderTestOriginalWorklet,
        inputs: nodeGraphModuleDefinitions.vocoder.inputs };
    }, ids.vocoder));
    await page.screenshot({ path: path.join(os.tmpdir(), `vocoder-${viewport.width}.png`), timeout: 15000 });
  }
  assert.ok(reports.every(r => r.width > 0 && r.height > 0 && r.scope === "scope1dTrace"));
  assert.ok(reports.every(r => r.bands === 100 && r.bandLimit === 100 && r.sameWorklet && r.peak > 0.00001),
    "100 bands remain live without replacing the AudioWorklet");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ reports, errors }));
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(false));
} catch (error) {
  console.error(await page?.evaluate(() => ({ enabled: nodeGraphMvp.live.outputEnabled,
    context: nodeGraphMvp.live.context?.state, node: Boolean(nodeGraphMvp.live.node),
    peak: nodeGraphMvp.live.outputLevelSmooth,
    status: document.getElementById("nodeLiveScheduleStatus")?.textContent,
    evidence: nodeGraphMvp.live.evidence,
    debug: document.body.innerText.slice(-4000) })));
  throw error;
} finally { await browser.close(); }
