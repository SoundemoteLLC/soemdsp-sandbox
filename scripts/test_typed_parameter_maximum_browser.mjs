import assert from "node:assert/strict";
import { createRequire } from "node:module";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(new URL("../../soemdsp-sandbox/package.json", import.meta.url))("playwright")); }
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto((process.env.SANDBOX_URL || "http://127.0.0.1:9447/") + "?mode=circuitbuilder", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 60000 });
  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const gate = showNodeGraphModule("spectralGate", { x: 50, y: 50 }, options);
    const osc = showNodeGraphModule("polyBlep", { x: 450, y: 50 }, options);
    return { gate, osc };
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => recordNodeGraphHistory());
  const edit = async (node, key, text, cancel = false) => {
    await page.evaluate(({ node, key, text, cancel }) => {
      const slider = nodeGraphSliderForParameter(node, key);
      const article = slider.closest(".dsp-node"), face = article.querySelector(".node-face");
      if (face) {
        const widgets = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpecForElement(article), face.offsetWidth, article);
        const wd = widgets.find(w => nodeGraphModuleFaceWidgetKeys(w).includes(key));
        const keys = nodeGraphModuleFaceWidgetKeys(wd), i = keys.indexOf(key);
        if (!beginNodeGraphModuleFaceValueEdit(article, face, wd, { x: wd.x + wd.w * (i + 0.5) / keys.length, y: wd.y + wd.h / 2 }))
          throw new Error("face edit did not open");
      } else {
        beginNodeSliderReadoutEdit(document.querySelector('.node-slider-readout[data-slider-target="' + CSS.escape(slider.id) + '"]'));
      }
      const input = document.querySelector('.node-slider-readout-input[data-slider-target="' + CSS.escape(slider.id) + '"]');
      input.value = text;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: cancel ? "Escape" : "Enter", bubbles: true }));
    }, { node, key, text, cancel });
  };
  const report = async (node, key) => page.evaluate(({ node, key }) => {
    const n = nodeGraphPatchNode(node), s = nodeGraphSliderForParameter(node, key);
    return { value: Number(n.params[key]), max: Number(n.paramMeta[key].max), domMax: Number(s.max),
      min: Number(n.paramMeta[key].min), mid: Number(n.paramMeta[key].mid), def: Number(n.paramMeta[key].def) };
  }, { node, key });
  const before = await report(ids.gate, "releaseMs");
  await page.evaluate(id => { nodeGraphMvp.metadataEditorTarget = nodeGraphSliderForParameter(id, "releaseMs").id; }, ids.gate);
  await edit(ids.gate, "releaseMs", "5000");
  const after = await report(ids.gate, "releaseMs");
  assert.deepEqual(after, { ...before, value: 5000, max: 5000, domMax: 5000 });
  const settingsMax = await page.evaluate(() => parseNodeMetadataNumber(document.getElementById("metadataMaxValue").value, NaN));
  assert.equal(settingsMax, 5000, "Parameter Settings follows the typed maximum");
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForTimeout(500);
  await page.waitForFunction(({ id, max }) => Number(nodeGraphPatchNode(id).paramMeta.releaseMs.max) === max, { id: ids.gate, max: before.max });
  assert.deepEqual(await report(ids.gate, "releaseMs"), before, "one Undo restores value and maximum");
  await page.evaluate(() => redoNodeGraphPatch());
  await page.waitForFunction(id => Number(nodeGraphPatchNode(id).params.releaseMs) === 5000, ids.gate);
  await edit(ids.gate, "releaseMs", "2 * 5000");
  assert.equal((await report(ids.gate, "releaseMs")).max, 10000);
  await edit(ids.gate, "releaseMs", "nonsense");
  await edit(ids.gate, "releaseMs", "20000", true);
  assert.equal((await report(ids.gate, "releaseMs")).max, 10000);
  await edit(ids.gate, "releaseMs", "4000");
  assert.equal((await report(ids.gate, "releaseMs")).max, 10000, "in-range edits do not shrink maximum");
  await edit(ids.osc, "frequency", "30000");
  assert.equal((await report(ids.osc, "frequency")).max, 30000, "shared across module types");
  await page.evaluate(id => {
    const s = nodeGraphSliderForParameter(id, "amplitude");
    s.displayTransform = v => ({ value: v * 100 }); s.displayInverse = v => v / 100;
  }, ids.osc);
  await edit(ids.osc, "amplitude", "200");
  assert.equal((await report(ids.osc, "amplitude")).max, 2, "save inverse-transformed parameter units");
  // HP-24: typing below the minimum extends the minimum, the same way (same path, persistence and one Undo).
  const beforeMin = await report(ids.osc, "amplitude");
  await edit(ids.osc, "amplitude", "-50");
  const afterMin = await report(ids.osc, "amplitude");
  assert.equal(afterMin.min, -0.5, "typing below min extends min");
  assert.equal(afterMin.value, -0.5, "the typed value lands");
  assert.equal(afterMin.max, beforeMin.max, "extending min leaves max");
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForFunction(({ id, min }) => Number(nodeGraphPatchNode(id).paramMeta.amplitude.min) === min, { id: ids.osc, min: beforeMin.min });
  assert.deepEqual(await report(ids.osc, "amplitude"), beforeMin, "one Undo restores value and minimum");
  await page.evaluate(() => redoNodeGraphPatch());
  await page.waitForFunction(id => Number(nodeGraphPatchNode(id).paramMeta.amplitude.min) === -0.5, ids.osc);
  const saved = await page.evaluate(() => serializeNodeGraphPatch(nodeGraphMvp.patch, { pretty: false }));
  await page.evaluate(text => loadNodeGraphPatchFromObject(JSON.parse(text)), saved);
  assert.equal((await report(ids.gate, "releaseMs")).max, 10000);
  assert.equal((await report(ids.osc, "frequency")).domMax, 30000, "saved ranges survive patch reload");
  assert.equal((await report(ids.osc, "amplitude")).min, -0.5, "a saved extended minimum survives patch reload");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, after, settingsMax, savedReload: true, errors }));
} finally { await browser.close(); }
