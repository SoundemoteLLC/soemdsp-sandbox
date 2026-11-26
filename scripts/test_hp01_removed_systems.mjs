// HP-01 / Stage 1 removal: broom circuit presets, Trigger Patch, the Pages list and the orphan localStorage presets are gone.
// Old patches that carry them still load: a keyboard saved in "triggerPatch" mode plays as "slide", and circuitPatches data is dropped on
// the next save. The broom (Ready) page and the 📄 Presets page still open. Real page on its own server.py port (never 8765 / 8766 /
// 8080) unless SANDBOX_URL is set.
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
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const file of ["", "perform.html"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(baseUrl + file + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
    const r = await page.evaluate(() => {
      const out = {};
      out.gone = ["nodeGraphApplyCircuitPatchSlot", "nodeGraphRenderCircuitPatchList", "nodeGraphWriteActiveCircuitPatchParam",
        "nodeGraphEnsureCircuitPatches", "nodeGraphTriggerPatchGhostKey", "setNodeGraphPagesPageOpen", "renderNodeGraphPatchPresetControls"]
        .filter((name) => typeof window[name] !== "undefined");
      out.modes = Array.from(nodeGraphKeyboardModes);
      // An old patch: a keyboard in Trigger Patch mode and circuit patch slots.
      const text = serializeNodeGraphPatch(nodeGraphMvp.patch);
      const old = JSON.parse(text);
      old.nodes.push({ id: "keyboardController-99", type: "keyboardController", x: 0, y: 0, params: {}, traceDisplaySettings: { mode: "triggerPatch" } });
      old.circuitPatches = { 60: { values: { "osc-1": { freq: 220 } } } };
      old.activeCircuitPatch = 60;
      old.defaultCircuitPatch = { values: {} };
      const loaded = loadNodeGraphPatchFromScript(JSON.stringify(old));
      out.loadedKeyboard = Boolean(loaded.nodes.find((n) => n.id === "keyboardController-99"));
      commitNodeGraphPatch(loaded, { status: "hp01 test" });
      out.mode = nodeGraphKeyboardModeForNode("keyboardController-99");
      const saved = JSON.parse(serializeNodeGraphPatch(nodeGraphMvp.patch));
      out.savedKeys = ["circuitPatches", "activeCircuitPatch", "defaultCircuitPatch"].filter((k) => k in saved);
      // The broom (Ready) page and the Presets page still open, empty of the removed parts.
      openNodeGraphUnifiedWindowPage("patchDefaults");
      const broom = document.getElementById("nodePatchDefaultsPanel");
      out.broomOpen = Boolean(broom && !broom.hidden);
      out.broomHasCircuit = Boolean(document.querySelector("#nodeCircuitPatchList, .node-circuit-patch-tools"));
      out.bankField = Boolean(document.getElementById("nodePatchDefaultsBank"));
      openNodeGraphUnifiedWindowPage("presets");
      const presets = document.getElementById("nodePresetsPage");
      out.presetsOpen = Boolean(presets && !presets.hidden);
      out.pagesPanel = Boolean(document.getElementById("nodePagesPage"));
      return out;
    });
    const where = file || "index.html";
    assert.deepEqual(r.gone, [], `${where}: removed functions are gone`);
    assert.ok(!r.modes.includes("triggerPatch"), `${where}: Trigger Patch is no longer a keyboard mode`);
    assert.ok(r.loadedKeyboard, `${where}: an old patch with a triggerPatch keyboard loads`);
    assert.equal(r.mode, "slide", `${where}: a saved triggerPatch mode plays as slide`);
    assert.deepEqual(r.savedKeys, [], `${where}: circuitPatches data is dropped on the next save`);
    assert.ok(r.broomOpen && !r.broomHasCircuit && r.bankField, `${where}: broom page opens without circuit presets, bank fields kept`);
    assert.ok(r.presetsOpen && !r.pagesPanel, `${where}: the 📄 page opens as the empty Presets page`);
    assert.deepEqual(errors, [], `${where}: no page errors`);
    console.log(`ok   ${where}: ${JSON.stringify(r)}`);
    await page.close();
  }
  console.log("HP-01 removal: old patches load, Trigger Patch reads as slide, circuit data dropped on save, pages open, no errors.");
} finally {
  await browser?.close();
  server?.kill();
}
