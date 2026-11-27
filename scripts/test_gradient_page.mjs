// HP-04 / Stage A3, HP-22: the Gradients page (its own 🌈 page; the 🧹 page keeps only the Ready controls). Real page on its own server.py port (never 8765 / 8766 / 8080) unless
// SANDBOX_URL is set; runs on index.html and perform.html.
// Create from a snapshot, move sliders on two modules, snapshot: both register. Dragging the playhead glides the effective value while
// the saved base never changes, and the release is exactly one undo step. Rename, Delete stop, Set start, On / Off and tap-to-add each
// record one step. Deleting a module drops its params from the gradient in the same step (D-G1). Save / load round trips the gradient.
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
    // Phone width: one column, 44 px rows.
    const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(baseUrl + file + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
    // Boot can still restore the working patch just after interface-ready; let it land first.
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const out = {};
      const opt = { record: false, autosaveWorkingPatch: false };
      const a = showNodeGraphModule("polyBlep", { x: 100, y: 100 }, opt);
      const b = showNodeGraphModule("spectrum1d", { x: 600, y: 100 }, opt);
      delete nodeGraphMvp.patch.gradients;
      // HP-22: the 🧹 page holds only the Ready controls and patch info; the gradients live on the 🌈 page.
      openNodeGraphUnifiedWindowPage("patchDefaults");
      await wait(30);
      const broom = document.getElementById("nodePatchDefaultsPanel");
      out.broomHasGradients = Boolean(broom.querySelector("#nodeGradientsBody"));
      out.broomLabels = [...broom.querySelectorAll(".node-patch-defaults-actions button")].map((x) => x.getAttribute("aria-label") || x.textContent.trim());
      out.broomTitles = broom.querySelectorAll("[title]").length;
      out.navIcons = (typeof nodeGraphUnifiedWindowPages === "object")
        ? [nodeGraphUnifiedWindowPages.gradients?.icon, nodeGraphUnifiedWindowPages.patchDefaults?.icon] : [];
      openNodeGraphUnifiedWindowPage("gradients");
      const panel = document.getElementById("nodeGradientsPage");
      out.broomClosedOnSwitch = broom.hidden;
      out.gradientsOpen = !panel.hidden;
      panel.style.width = "370px";
      panel.style.left = "10px";
      await wait(50);
      // perform.html hides the whole circuit-builder panel by design: data checks only there.
      out.visible = panel.getBoundingClientRect().width > 0;
      const btn = (text, scope = "#nodeGradientsBody") => [...document.querySelectorAll(`${scope} button`)].find((x) => x.textContent === text);
      const card = "#nodeGradientsBody .node-gradient-card";
      let h = nodeGraphMvp.historyIndex;
      const steps = () => { const d = nodeGraphMvp.historyIndex - h; h = nodeGraphMvp.historyIndex; return d; };
      btn("Snapshot").click();
      out.created = (nodeGraphMvp.patch.gradients || []).map((g) => g.name);
      out.createSteps = steps();
      const p = cloneNodeGraphPatch(nodeGraphMvp.patch);
      p.nodes.find((n) => n.id === a).params.frequency *= 2;
      const nb = p.nodes.find((n) => n.id === b);
      nb.params.floorDb = Number(nb.params.floorDb) + 40;
      commitNodeGraphPatch(p, { status: "test moves" });
      out.clonedKeepsGradients = (cloneNodeGraphPatch(nodeGraphMvp.patch).gradients || []).length === 1;
      steps();
      btn("Snapshot", card).click();
      const g = () => nodeGraphMvp.patch.gradients[0];
      out.registered = g().params.map((x) => x.nodeId === a ? "a." + x.key : x.nodeId === b ? "b." + x.key : x.key).sort();
      out.snapshotSteps = steps();
      out.rows = [...document.querySelectorAll(".node-gradient-param")].map((x) => x.textContent);
      // Playhead drag: many moves, one release.
      const strip = document.querySelector(".node-gradient-strip");
      const rect = strip.getBoundingClientRect();
      if (!out.visible) {
        // No layout: drive the same model edits the strip makes on release.
        g().position = 0.8;
        nodeGraphGradientsNotifyChanged("test");
        recordNodeGraphHistory();
      }
      out.stripHeight = Math.round(rect.height);
      const at = (f) => rect.left + rect.width * f;
      const base = nodeGraphPatchNode(a).params.frequency;
      const eff = () => { const n = nodeGraphPatchNode(a); const pr = { ...n.params }; applyNodeGraphParamOffsets(n, pr); return pr.frequency; };
      const ev = (type, f) => strip.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 5, button: 0, clientX: at(f), clientY: rect.top + 4 }));
      const glide = [];
      if (out.visible) {
        ev("pointerdown", 0.3);
        for (const f of [0.35, 0.5, 0.65, 0.8]) { ev("pointermove", f); glide.push(eff()); }
        out.stepsDuringDrag = nodeGraphMvp.historyIndex - h;
        ev("pointerup", 0.8);
      } else {
        out.stepsDuringDrag = 0;
      }
      out.releaseSteps = steps();
      out.position = Math.round(g().position * 100) / 100;
      out.glides = glide.every((v, i) => i === 0 || v > glide[i - 1]);
      out.baseUnchanged = nodeGraphPatchNode(a).params.frequency === base;
      // HP-05: "Holds still" names a gradient's Step Graph (its points hold still); a gradient without one has no such line.
      out.holdsBefore = Boolean(document.querySelector("#nodeGradientsBody .node-gradient-holds"));
      const sg = showNodeGraphModule("stepGraph", { x: 100, y: 500 }, opt);
      const sgNode = nodeGraphPatchNode(sg);
      const sgKey = Object.keys(sgNode.params).find((k) => typeof sgNode.params[k] === "number"
        && NodeGraphGradients.metaFor(sgNode, k) && !NodeGraphGradients.isDiscrete(NodeGraphGradients.metaFor(sgNode, k)));
      const gNow = g();
      nodeGraphMvp.patch.gradients = nodeGraphMvp.patch.gradients.map((x) => (x.id === gNow.id
        ? { ...x, params: [...x.params, { nodeId: sg, key: sgKey }] } : x));
      renderNodeGraphGradientPage();
      out.holdsText = document.querySelector("#nodeGradientsBody .node-gradient-holds")?.textContent || "";
      nodeGraphMvp.patch.gradients = nodeGraphMvp.patch.gradients.map((x) => (x.id === gNow.id
        ? { ...x, params: x.params.filter((p) => p.nodeId !== sg) } : x));
      renderNodeGraphGradientPage();
      out.holdsAfter = Boolean(document.querySelector("#nodeGradientsBody .node-gradient-holds"));
      // HP-23: the moved value shows where a modulated value shows (ghost + slider number + displays), with audio stopped, on the event.
      g().position = 0.8;
      nodeGraphGradientsNotifyChanged("test");
      const gs = nodeGraphSliderForParameter(a, "frequency");
      out.ghostShown = Boolean(gs?.closest("label")?.querySelector(".node-slider-readout")?.classList.contains("has-ghost-slider"));
      out.ghostValue = Math.abs(Number(gs?.dataset.sentDomainValue) - eff()) < 1e-6;
      out.displayValue = Math.abs(nodeGraphFilterCurveLiveParam(nodeGraphPatchNode(a), "frequency", base) - eff()) < 1e-6;
      // Buttons, each one step.
      btn("On", card).click(); out.toggleSteps = steps(); out.disabledEffIsBase = eff() === base;
      btn("Off", card).click(); steps();
      btn("Rename", card).click();
      const input = document.querySelector("[data-gradient-rename-input]");
      input.value = "Bright sweep";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      out.name = g().name; out.renameSteps = steps();
      if (out.visible) {
        const tapX = at(0.2);
        const s2 = document.querySelector(".node-gradient-strip");
        s2.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 6, button: 0, clientX: tapX }));
        s2.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 6, button: 0, clientX: tapX }));
      } else {
        nodeGraphGradientPageCommit(nodeGraphGradientPageReplace(g().id, () => NodeGraphGradients.snapshotIntoGradient(nodeGraphMvp.patch, g(), 0.2)), "test tap");
        nodeGraphGradientPageState.selectedStop.set(g().id, g().stops.find((s) => Math.abs(s.pos - 0.2) < 1e-9).id);
        renderNodeGraphGradientPage();
      }
      out.stopsAfterTap = g().stops.length; out.tapSteps = steps();
      btn("Delete stop", card).click(); out.stopsAfterDelete = g().stops.length; out.deleteStopSteps = steps();
      btn("Set start", card).click(); out.setStartSteps = steps();
      // D-G1: delete a module, its params leave the gradient in the same commit.
      setNodeGraphSelection({ type: "node", id: b });
      performNodeGraphDeleteSelection(nodeGraphMvp.selected);
      await wait(300);
      const last = JSON.parse(nodeGraphMvp.historySnapshots[nodeGraphMvp.historyIndex]);
      const prev = JSON.parse(nodeGraphMvp.historySnapshots[nodeGraphMvp.historyIndex - 1]);
      out.deleteDrops = !last.nodes.some((n) => n.id === b) && !last.gradients[0].params.some((x) => x.nodeId === b)
        && prev.nodes.some((n) => n.id === b) && prev.gradients[0].params.some((x) => x.nodeId === b);
      // Save / load.
      const loaded = loadNodeGraphPatchFromScript(serializeNodeGraphPatch(nodeGraphMvp.patch));
      out.roundTrip = JSON.stringify(loaded.gradients) === JSON.stringify(nodeGraphMvp.patch.gradients);
      out.minRow = Math.min(...[...document.querySelectorAll("#nodeGradientsBody .node-gradient-button, .node-gradient-param")].map((e) => e.getBoundingClientRect().height));
      out.titles = document.querySelectorAll("#nodeGradientsBody [title]").length;
      return out;
    });
    const where = file || "index.html";
    const ok = (cond, msg) => { assert.ok(cond, `${where}: ${msg} ${JSON.stringify(r)}`); };
    ok(!r.broomHasGradients && r.broomLabels.length >= 4 && r.broomTitles === 0, "the 🧹 page keeps Lock / Write Defaults / Hide Unused / Hide Wires, no gradients, no tooltips");
    ok(r.navIcons[0] === "🌈" && r.navIcons[1] === "🧹", "🌈 Gradients and 🧹 Ready are separate pages");
    ok(r.gradientsOpen, "the 🌈 page opens");
    ok(r.created.length === 1 && r.created[0] === "Gradient 1" && r.createSteps === 1, "Snapshot starts Gradient 1 in one step");
    ok(r.clonedKeepsGradients, "patch clones keep gradients");
    ok(JSON.stringify(r.registered) === JSON.stringify(["a.frequency", "b.floorDb"]) && r.snapshotSteps === 1, "both moved params register");
    ok(r.rows.length === 2, "one row per registered param");
    if (r.visible) ok(r.stripHeight === 44, "the strip is 44 px tall");
    ok(r.stepsDuringDrag === 0 && r.releaseSteps === 1, "a playhead drag is exactly one undo step");
    ok(r.position === 0.8 && (r.glides || !r.visible) && r.baseUnchanged, "dragging glides the effective value; the base never changes");
    ok(!r.holdsBefore && /^Holds still: /.test(r.holdsText) && !r.holdsAfter, "Holds still line only for a gradient touching a Step Graph");
    if (r.visible) ok(r.ghostShown && r.ghostValue, "the gradient's moved value shows as the slider ghost and number");
    ok(r.displayValue, "displays read the gradient's moved value");
    ok(r.toggleSteps === 1 && r.disabledEffIsBase, "Off removes the gradient's effect, one step");
    ok(r.name === "Bright sweep" && r.renameSteps === 1, "Rename");
    ok(r.stopsAfterTap === 3 && r.tapSteps === 1 && r.stopsAfterDelete === 2 && r.deleteStopSteps === 1, "tap adds a stop; Delete stop removes it");
    ok(r.setStartSteps === 1, "Set start");
    ok(r.deleteDrops, "deleting a module drops its params in the same undo step (D-G1)");
    ok(r.roundTrip, "save / load round trip");
    if (r.visible) ok(r.minRow >= 44, "44 px touch rows");
    ok(r.titles === 0, "no title tooltips");
    assert.deepEqual(errors, [], `${where}: no page errors`);
    console.log(`ok   ${where}${r.visible ? "" : " (panel hidden in perform mode: data checks only)"}`);
    await page.close();
  }
  console.log("Gradients page: create, snapshot, drag (one undo step), buttons, D-G1 delete, save / load pass on index.html and perform.html.");
} finally {
  await browser?.close();
  server?.kill();
}
