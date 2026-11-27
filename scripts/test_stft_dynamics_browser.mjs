import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(new URL("../../soemdsp-sandbox/package.json", import.meta.url))("playwright")); }
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto((process.env.SANDBOX_URL || "http://127.0.0.1:9447/") + "?mode=circuitbuilder", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 60000 });
  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const source = showNodeGraphModule("polyBlep", { x: 20, y: 40 }, options);
    const contrast = showNodeGraphModule("spectralContrast", { x: 260, y: 40 }, options);
    const gate = showNodeGraphModule("spectralGate", { x: 620, y: 40 }, options);
    if (!source || !contrast || !gate) throw new Error("STFT modules must be spawnable in the default product");
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes = patch.nodes.filter(n => [source, contrast, gate].includes(n.id) || n.type === "output");
    const output = patch.nodes.find(n => n.type === "output");
    patch.nodes.find(n => n.id === source).params = { waveform: 1, frequency: 187.5, amplitude: 0.2 };
    const wire = (sourceNode, sourcePort, destinationNode, destinationPort) => ({ sourceNode, sourcePort, destinationNode, destinationPort });
    patch.connections = [wire(source, "Wave", contrast, "In"), wire(contrast, "Mono", gate, "In"), wire(gate, "Mono", output.id, "Mono")];
    patch.modulations = [];
    commitNodeGraphPatch(patch, { status: "STFT browser test" });
    const plan = nodeGraphBuildLivePlan();
    if (plan.issues?.length) throw new Error(JSON.stringify(plan.issues));
    return { source, contrast, gate };
  });
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
  await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.outputLevelSmooth > 0.00001, null, { timeout: 60000 });
  assert.equal(await page.evaluate(id => Number(nodeGraphSliderForParameter(id, "kneeDb").value), ids.gate), 6);
  assert.equal(await page.evaluate(id => Number(nodeGraphSliderForParameter(id, "holdMs").value), ids.gate), 0);
  await page.evaluate(id => updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, "holdMs"), "5000"), ids.gate);
  await page.evaluate(id => {
    const slider = nodeGraphSliderForParameter(id, "kneeDb");
    slider.value = "0"; slider.dispatchEvent(new Event("input", { bubbles: true })); slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, ids.gate);
  for (const mode of [1, 2, 0]) {
    await page.evaluate(({ id, mode }) => {
      const slider = nodeGraphSliderForParameter(id, "profileMode");
      slider.value = String(mode); slider.dispatchEvent(new Event("input", { bubbles: true })); slider.dispatchEvent(new Event("change", { bubbles: true }));
    }, { id: ids.gate, mode });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(id => Number(nodeGraphSliderForParameter(id, "profileMode").value), ids.gate), mode);
  }
  const reports = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [key, id] of [["contrast", ids.contrast], ["gate", ids.gate]]) {
      await page.evaluate(id => {
        const slider = nodeGraphSliderForParameter(id, "mix"), box = slider.closest("article").getBoundingClientRect();
        const area = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
        nodeGraphMvp.pan.x += (innerWidth - box.width) / 2 - box.left;
        nodeGraphMvp.pan.y += area.top + 25 - box.top; applyNodeGraphViewportCssLight();
      }, id);
      await page.waitForTimeout(250);
      reports.push(await page.evaluate(id => {
        const node = nodeGraphPatchNode(id), slider = nodeGraphSliderForParameter(id, "mix");
        const box = slider.closest("article").getBoundingClientRect();
        return { type: node.type, width: box.width, height: box.height, renderer: nodeGraphModuleDisplayRendererForNode(node),
          profile: node.params.profileMode, knee: node.params.kneeDb, hold: node.params.holdMs,
          holdMax: node.paramMeta?.holdMs?.max, peak: nodeGraphMvp.live.outputLevelSmooth };
      }, id));
      await page.screenshot({ path: path.join(os.tmpdir(), "stft-" + key + "-" + viewport.width + ".png"), timeout: 15000 });
    }
  }
  assert.ok(reports.every(r => r.width > 0 && r.height > 0 && r.renderer === "spectralStyle"));
  assert.ok(reports.filter(r => r.type === "spectralGate").every(r => Number(r.knee) === 0), "hard knee persists through the normal control path");
  assert.ok(reports.filter(r => r.type === "spectralGate").every(r => Number(r.hold) === 5000 && Number(r.holdMax) === 5000), "Hold accepts 5000 ms and expands its UI range");
  assert.deepEqual(errors, []); console.log(JSON.stringify({ reports, errors }));
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(false));
} finally { await browser.close(); }
