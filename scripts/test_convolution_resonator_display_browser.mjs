import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(new URL("../../soemdsp-sandbox/package.json", import.meta.url))("playwright")); }
const base = process.env.SANDBOX_URL || "http://127.0.0.1:9447/";
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", message => { if (message.type() === "error" && message.text().includes("convolution")) errors.push(message.text()); });
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto(`${base}?mode=circuitbuilder`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof createNodeGraphConvolutionResonatorDisplay === "function"
    && typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 60000 });
  const id = await page.evaluate(() => showNodeGraphModule("convolutionResonator", { x: 40, y: 40 }, { status: "display test" }));
  assert.ok(id);
  const selector = `.node-convolution-resonator-display[data-node="${id}"]`;
  await page.waitForFunction(s => Boolean(document.querySelector(s)?._convolutionPacket), selector, { timeout: 30000 });
  const reports = [];
  for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }], ["compact", { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    if (name === "compact") await page.evaluate(s => {
      const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
      const id = document.querySelector(s).dataset.node;
      const node = patch.nodes.find(node => node.id === id);
      node.ui = { ...(node.ui || {}), displayHeightGu: 1 };
      commitNodeGraphPatch(patch, { status: "display test compact" });
    }, selector);
    await page.waitForFunction(s => Boolean(document.querySelector(s)?._convolutionPacket), selector, { timeout: 15000 });
    await page.evaluate(s => {
      const box = document.querySelector(s).getBoundingClientRect();
      const workspace = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
      nodeGraphMvp.pan.x += (innerWidth - box.width) / 2 - box.left;
      nodeGraphMvp.pan.y += workspace.top + 85 - box.top;
      applyNodeGraphViewportCssLight();
      nodeGraphGlGraphPresentDisplaysSoon();
    }, selector);
    await page.waitForTimeout(300);
    const report = await page.evaluate(s => {
      const section = document.querySelector(s);
      section._convolutionForce = true; section.syncFromParameters();
      const face = section.querySelector(".node-display-face");
      const pixels = nodeGraphSharedGlFacePixels(face);
      let lit = 0;
      if (pixels) for (let i = 0; i < pixels.data.length; i += 4)
        if (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2] > 80) ++lit;
      const rect = section.getBoundingClientRect();
      return { width: rect.width, height: rect.height, lit, canvasTags: section.querySelectorAll("canvas").length,
        obsoleteControls: ["vocoderModel", "bankWidth", "bankFollowerMs"].some(key => Boolean(nodeGraphSliderForParameter(section.dataset.node, key))),
        schema: nodeGraphModuleDisplaySettingsSchemaForNode(nodeGraphPatchNode(section.dataset.node)),
        key: section._convolutionRequestKey, length: section._convolutionPacket.length };
    }, selector);
    assert.ok(report.width > 0 && report.height > 0 && report.lit > 100, `${name}: nonblank GL face`);
    assert.equal(report.canvasTags, 0, "face uses the shared GL texture, not a private canvas");
    assert.equal(report.schema, "", "no inherited Trace settings");
    assert.equal(report.obsoleteControls, false, "comparison controls are removed");
    if (name === "compact") assert.ok(report.height < 48, "compact IR-only view fits small display heights");
    const screenshot = path.join(os.tmpdir(), `convolution-resonator-${name}.png`);
    await page.screenshot({ path: screenshot, timeout: 10000 });
    reports.push({ name, ...report, screenshot });
  }
  const invariant = await page.evaluate(s => {
    const el = document.querySelector(s), node = nodeGraphPatchNode(el.dataset.node);
    const key = el._convolutionRequestKey;
    node.params.mix = 0.2; node.params.vocoderMix = 1;
    el._convolutionForce = true; el.syncFromParameters();
    return key === el._convolutionRequestKey;
  }, selector);
  assert.ok(invariant, "unrelated audio mix does not resample or move the pinned plots");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ reports, invariant, errors }));
} finally { await browser.close(); }
