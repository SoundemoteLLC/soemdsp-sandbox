// PASTE-8 item 3: the Gradient module and the Pitch Mutator are not in the module store: no department page, no department search and
// no Command Center search lists them (not even as a disabled card). Patches that already hold them still load. (Placing them from the
// 🌈 page and the Mutator page: scripts/test_gradient_drag_grip.mjs.) Real page on its own server.py port unless SANDBOX_URL.
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const TYPES = ["gradient", "pitchMutator"];
    // The two labels exactly (a card's aria-label is "Label. ..." or "Label under construction. ..."; Gradient Vectorscope is another module).
    const LABELS = /^(Gradient|Pitch Mutator)(\.|\s+under construction|\s*$)/;
    const out = { entries: {}, departments: [], deptSearch: {}, ccSearch: {} };
    for (const e of nodeGraphModuleStoreEntries()) {
      if (TYPES.includes(e.type)) out.entries[e.type] = { visible: e.visible, home: e.homeVisible, developer: e.developerVisible, shop: e.shopVisible };
    }
    const offenders = (scope) => [...(scope || document).querySelectorAll(".scene-context-store-card")]
      .filter((c) => TYPES.includes(c.dataset.contextModule) || LABELS.test(String(c.getAttribute("aria-label") || "")))
      .map((c) => c.getAttribute("aria-label"));
    openNodeGraphUnifiedWindowPage("moduleBrowser");
    await wait(300);
    for (const id of nodeGraphModuleStoreDepartmentIds) {
      setNodeGraphModuleStoreDepartment(id);
      await wait(60);
      const bad = offenders();
      if (bad.length) out.departments.push({ id, bad });
    }
    const field = document.getElementById("nodeModuleDepartmentSearch");
    for (const q of ["gradient", "mutator", "pitch mutator"]) {
      if (field) { field.value = q; field.dispatchEvent(new Event("input", { bubbles: true })); await wait(120); }
      out.deptSearch[q] = field ? offenders() : ["no department search field"];
    }
    if (field) { field.value = ""; field.dispatchEvent(new Event("input", { bubbles: true })); }
    const cc = document.getElementById("nodeCommandCenterModuleSearchInput");
    const results = document.getElementById("nodeCommandCenterModuleSearchResults");
    for (const q of ["gradient", "mutator"]) {
      if (cc) { cc.value = q; renderNodeGraphCommandCenterModuleSearch(); await wait(60); }
      out.ccSearch[q] = cc && results
        ? [...results.querySelectorAll("[data-context-module], button, [role=option]")].filter((el) => TYPES.includes(el.dataset.contextModule) || LABELS.test(el.textContent.trim())).map((el) => el.textContent.trim())
        : ["no command center search"];
    }
    if (cc) { cc.value = ""; renderNodeGraphCommandCenterModuleSearch(); }
    return out;
  });
  for (const t of ["gradient", "pitchMutator"]) {
    const e = r.entries[t];
    assert.ok(e && !e.visible && !e.home && !e.developer && !e.shop, `${t} is not a store entry anywhere ${JSON.stringify(e)}`);
  }
  assert.deepEqual(r.departments, [], `no department page lists them ${JSON.stringify(r.departments)}`);
  for (const [q, bad] of Object.entries(r.deptSearch)) assert.deepEqual(bad, [], `department search "${q}" does not list them`);
  for (const [q, bad] of Object.entries(r.ccSearch)) assert.deepEqual(bad, [], `Command Center search "${q}" does not list them`);

  // A patch that already holds both still loads: the modules are there, the Gradient module plays its gradient.
  const loaded = await page.evaluate(async () => {
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const osc = patch.nodes.find((n) => n.type === "polyBlep");
    const meta = nodeGraphReadPatchParameterMetadata(osc, "frequency");
    patch.gradients = [{ id: "gx", name: "Old", enabled: true, position: 0.25, origin: { [osc.id]: { frequency: nodeGraphParamControlPosition(osc.params.frequency, meta) } },
      params: [{ nodeId: osc.id, key: "frequency" }], stops: [{ id: "a", pos: 0, offsets: {} }, { id: "b", pos: 1, offsets: { [osc.id]: { frequency: 0.1 } } }] }];
    const g = createNodeGraphPatchNode("gradient", { id: "gradient-7", gx: 4, gy: 30 });
    g.gradientId = "gx";
    g.params = { ...(g.params || {}), playhead: 0.25 };
    patch.nodes.push(g, createNodeGraphPatchNode("pitchMutator", { id: "pitchMutator-7", gx: 20, gy: 30 }));
    commitNodeGraphPatch(loadNodeGraphPatchFromScript(JSON.stringify(patch)), { patchDirtyState: "saved" });
    await new Promise((res) => setTimeout(res, 400));
    const gn = nodeGraphPatchNode("gradient-7");
    return { gradient: Boolean(gn && nodeGraphNodeElement("gradient-7")), bound: gn?.gradientId, mutator: Boolean(nodeGraphPatchNode("pitchMutator-7") && nodeGraphNodeElement("pitchMutator-7")) };
  });
  assert.deepEqual(loaded, { gradient: true, bound: "gx", mutator: true }, `an old patch with both still loads ${JSON.stringify(loaded)}`);

  assert.deepEqual(errors, [], "no page errors");
  console.log("test_store_hides_gradient_mutator: ok");
} finally {
  await browser?.close();
  server?.kill();
}
