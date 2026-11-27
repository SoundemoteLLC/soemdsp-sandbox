// HP-04 / Stage A3, HP-22: the Gradients page (its own 🌈 page; the 🧹 page keeps only the Ready controls). Real page on its own server.py port (never 8765 / 8766 / 8080) unless
// SANDBOX_URL is set; runs on index.html and perform.html.
// Create a gradient, move sliders on two modules: both register. Dragging the playhead glides the effective value while
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
  const selectedFile = process.env.GRADIENT_TEST_FILE;
  const files = selectedFile ? [selectedFile === "index.html" ? "" : selectedFile] : ["", "perform.html"];
  for (const file of files) {
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
      btn("New Gradient").click();
      out.created = (nodeGraphMvp.patch.gradients || []).map((g) => g.name);
      out.createSteps = steps();
      const g = () => nodeGraphMvp.patch.gradients[0];
      out.newGradientReady = nodeGraphGradientPageState.editMode && g().position === 1 && g().params.length === 0
        && g().stops.length === 1 && g().stops[0].pos === 0;
      out.migratedPositions = (() => {
        const migrated = NodeGraphGradients.normalize([{ id: "legacy", name: "Legacy", position: 64,
          stops: [{ id: "s1", pos: 0, offsets: {} }, { id: "s2", pos: 127, offsets: {} }] }])[0];
        return Math.abs(migrated.position - 64 / 127) < 1e-9 && migrated.stops[0].pos === 0 && migrated.stops[1].pos === 1;
      })();
      out.clonedKeepsGradients = (cloneNodeGraphPatch(nodeGraphMvp.patch).gradients || []).length === 1;
      steps();
      const editButton = () => [...document.querySelectorAll("#nodeGradientsBody .node-gradient-top button")].find((x) => x.getAttribute("aria-label") === "Gradient edit mode");
      const moveParam = (nodeId, key) => {
        const node = nodeGraphPatchNode(nodeId), slider = nodeGraphSliderForParameter(nodeId, key), meta = NodeGraphGradients.metaFor(node, key);
        const held = Number(slider.dataset.domainValue), base = Number(node.params[key]);
        const before = Number.isFinite(Number(slider.value)) ? Number(slider.value) : NaN;
        const targetSlider = Math.min(0.95, NodeGraphGradients.toSlider(meta, base) + 0.08);
        const target = NodeGraphGradients.fromSlider(meta, targetSlider);
        setNodeSliderValue(slider, target, { interaction: "drag" });
        commitNodeSliderDragValue(slider);
        return { nodeId, key, slider, held, before, base, target, targetSlider };
      };
      const first = moveParam(a, "frequency");
      const second = moveParam(b, "floorDb");
      const untracked = nodeGraphPatchNode(a);
      const untrackedKey = Object.keys(untracked.params).find((key) => key !== "frequency" && typeof untracked.params[key] === "number"
        && NodeGraphGradients.metaFor(untracked, key) && nodeGraphSliderForParameter(a, key));
      const third = moveParam(a, untrackedKey);
      out.registered = g().params.map((x) => x.nodeId === a ? "a." + x.key : x.nodeId === b ? "b." + x.key : x.key).sort();
      out.firstMoveCreatesEndStop = g().stops.some((stop) => stop.pos === 1) && g().stops.length === 2
        && Math.abs(Number(g().stops.find((stop) => stop.pos === 1).offsets?.[a]?.frequency) - (first.targetSlider - Number(g().origin?.[a]?.frequency))) < 1e-6;
      out.newParamsJoinLive = [second, third].every(({ nodeId, key }) => g().params.some((item) => item.nodeId === nodeId && item.key === key))
        && g().stops.find((stop) => stop.pos === 0).offsets?.[b]?.floorDb === 0
        && nodeGraphSliderForParameter(a, untrackedKey)?.closest("label")?.querySelector(".node-slider-readout")?.classList.contains("is-gradient-edit");
      out.editHeld = [first, second, third].every(({ nodeId, key, slider, held, before, base }) => nodeGraphPatchNode(nodeId).params[key] === base
        && Number(slider.dataset.domainValue) === held && Number(slider.value) === before);
      nodeGraphGradientPageSetPlayhead(g(), 0.5);
      const bBefore = nodeGraphGradientPageOffsetAt(g(), b, "floorDb");
      const bent = moveParam(a, "frequency");
      const halfStop = g().stops.find((stop) => Math.abs(stop.pos - 0.5) < 1e-9);
      out.unsnappedMoveCreatesAllParamsStop = Boolean(halfStop) && Math.abs(Number(halfStop.offsets?.[b]?.floorDb) - bBefore) < 1e-6
        && Math.abs(Number(halfStop.offsets?.[a]?.frequency) - (bent.targetSlider - Number(g().origin?.[a]?.frequency))) < 1e-6;
      out.allJoinedControlsGold = g().params.every(({ nodeId, key }) => nodeGraphSliderForParameter(nodeId, key)?.closest("label")?.querySelector(".node-slider-readout")?.classList.contains("is-gradient-edit"));
      const gradientCard = document.querySelector(card);
      out.paramColorsMatch = g().params.every(({ nodeId, key }) => {
        const readout = nodeGraphSliderForParameter(nodeId, key)?.closest("label")?.querySelector(".node-slider-readout");
        const chip = [...gradientCard.querySelectorAll(".node-gradient-param-chips button")].find((item) => item.dataset.nodeId === nodeId && item.dataset.paramKey === key);
        const series = [...gradientCard.querySelectorAll("[data-curve-series]")].find((item) => decodeURIComponent(item.dataset.curveSeries) === `${nodeId}\u0000${key}`);
        const color = readout?.style.getPropertyValue("--gradient-edit-color").trim();
        return Boolean(color) && color === chip?.style.getPropertyValue("--curve-color").trim() && color === series?.getAttribute("stroke");
      });
      const slider = nodeGraphSliderForParameter(a, "frequency");
      const curveSeries = [...gradientCard.querySelectorAll("[data-curve-series]")].find((item) => decodeURIComponent(item.dataset.curveSeries) === `${a}\u0000frequency`);
      curveSeries?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      const popover = document.getElementById("nodeParameterMetadataPopover");
      out.curveContextSettings = nodeGraphMvp.metadataEditorTarget === slider?.id && !popover?.hidden
        && Boolean(document.getElementById("metadataSmoothingModeGroup"));
      closeNodeMetadataPopover();
      const readout = document.querySelector(`.node-slider-readout[data-slider-target="${CSS.escape(slider?.id || "")}"]`);
      readout?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      out.sliderContextSettings = nodeGraphMvp.metadataEditorTarget === slider?.id && !popover?.hidden
        && Boolean(document.getElementById("metadataSmoothingModeGroup"));
      closeNodeMetadataPopover();
      nodeGraphGradientPageSetPlayhead(g(), 0.5 + 1 / 127);
      const snappedStop = g().stops.find((stop) => Math.abs(stop.pos - 0.5) < 1e-9);
      const beforeSnapEdit = Number(snappedStop.offsets?.[a]?.frequency) || 0;
      const snapSlider = nodeGraphSliderForParameter(a, "frequency"), snapMeta = NodeGraphGradients.metaFor(nodeGraphPatchNode(a), "frequency");
      setNodeSliderValue(snapSlider, NodeGraphGradients.fromSlider(snapMeta, 0.92), { interaction: "drag" });
      commitNodeSliderDragValue(snapSlider);
      out.playheadSnapAndLiveEdit = Math.abs(g().position - 0.5) < 1e-9
        && nodeGraphGradientPageState.snappedStops.get(g().id) === snappedStop?.id
        && (Number(snappedStop.offsets?.[a]?.frequency) || 0) !== beforeSnapEdit;
      nodeGraphGradientPageSetPlayhead(g(), 0.5 + 4 / 127);
      out.playheadSnapReleases = Math.abs(g().position - (0.5 + 4 / 127)) < 1e-9 && !nodeGraphGradientPageState.snappedStops.has(g().id);
      editButton().click();
      out.editOffDiscards = !nodeGraphGradientPageHasPendingValues();
      nodeGraphGradientPageSetPlayhead(g(), 0.5);
      out.rows = [...document.querySelectorAll(".node-gradient-param-chips .node-gradient-button:not(.node-gradient-button:last-child)")].map((x) => x.textContent);
      out.graphsHiddenByDefault = Boolean(document.querySelector(".node-gradient-card")?.classList.contains("graphs-hidden"));
      if (out.visible) btn("Show graphs").click();
      else nodeGraphGradientPageState.showGraphs = true;
      out.graphsShowOnDemand = !out.visible || Boolean(document.querySelector("[data-gradient-graph]")?.getClientRects().length);
      // Selecting a plotted point must retain capture across the page re-render; horizontal and vertical drags edit separate dimensions.
      const host = document.getElementById("nodeGradientsBody");
      host.setPointerCapture = (id) => { host.__testCapturedPointer = id; };
      host.releasePointerCapture = (id) => { host.__testReleasedPointer = id; };
      let plot = document.querySelector("[data-gradient-graph]");
      let point = plot?.querySelector('[data-curve-point="0"]');
      let box = point?.getBoundingClientRect();
      const sx = box ? box.left + box.width / 2 : 0, sy = box ? box.top + box.height / 2 : 0;
      const stopId = g().stops[0].id, firstParam = g().params[0], secondParam = g().params[1];
      const pointGeometry = point ? {
        attrs: ["x", "y", "width", "height", "rx", "stroke-width"].map((key) => point.getAttribute(key)),
        bounds: point.getBoundingClientRect(),
      } : null;
      const startPos = g().stops.find((s) => s.id === stopId).pos;
      const startOther = Number(g().stops.find((s) => s.id === stopId).offsets?.[secondParam.nodeId]?.[secondParam.key]) || 0;
      nodeGraphGradientPagePointerDown({ target: point, currentTarget: host, pointerId: 77, button: 0, clientX: sx, clientY: sy, preventDefault() {} });
      out.graphCapture = host.__testCapturedPointer === 77 && nodeGraphGradientPageState.drag?.graph === true;
      const pressedPoint = document.querySelector('[data-gradient-graph] [data-curve-point="0"]');
      const pressedBounds = pressedPoint?.getBoundingClientRect();
      out.graphPinPressBounds = [pointGeometry?.bounds.width, pointGeometry?.bounds.height, pressedBounds?.width, pressedBounds?.height];
      out.graphPointDoesNotResizeOnPress = Boolean(pointGeometry && pressedPoint && pressedBounds)
        && pointGeometry.attrs.every((value, index) => value === ["x", "y", "width", "height", "rx", "stroke-width"].map((key) => pressedPoint.getAttribute(key))[index])
        && Math.abs(pointGeometry.bounds.width - pointGeometry.bounds.height) < 0.1
        && Math.abs(pressedBounds.width - pressedBounds.height) < 0.1
        && Math.abs(pointGeometry.bounds.width - pressedBounds.width) < 0.1
        && Math.abs(pointGeometry.bounds.height - pressedBounds.height) < 0.1;
      nodeGraphGradientPagePointerMove({ pointerId: 77, clientX: sx + 24, clientY: sy });
      nodeGraphGradientPagePointerUp({ pointerId: 77, type: "pointerup" });
      const movedXStop = g().stops.find((s) => s.id === stopId);
      out.graphHorizontalDrag = movedXStop.pos > startPos && (Number(movedXStop.offsets?.[firstParam.nodeId]?.[firstParam.key]) || 0) === 0;
      steps();
      plot = document.querySelector("[data-gradient-graph]"); point = plot?.querySelector('[data-curve-point="0"]'); box = point?.getBoundingClientRect();
      const vy = box ? box.top + box.height / 2 : 0, vx = box ? box.left + box.width / 2 : 0;
      const beforeVerticalPos = movedXStop.pos;
      const beforeVerticalValue = Number(movedXStop.offsets?.[firstParam.nodeId]?.[firstParam.key]) || 0;
      nodeGraphGradientPagePointerDown({ target: point, currentTarget: host, pointerId: 78, button: 0, clientX: vx, clientY: vy, preventDefault() {} });
      nodeGraphGradientPagePointerMove({ pointerId: 78, clientX: vx, clientY: vy + 24 });
      nodeGraphGradientPagePointerUp({ pointerId: 78, type: "pointerup" });
      const movedYStop = g().stops.find((s) => s.id === stopId);
      out.graphVerticalDrag = movedYStop.pos === beforeVerticalPos
        && (Number(movedYStop.offsets?.[firstParam.nodeId]?.[firstParam.key]) || 0) < beforeVerticalValue
        && (Number(movedYStop.offsets?.[secondParam.nodeId]?.[secondParam.key]) || 0) === startOther;
      const points = [...document.querySelectorAll("[data-gradient-graph] [data-curve-point]")];
      out.graphPinBounds = points.map((el) => { const bounds = el.getBoundingClientRect(); return [bounds.width, bounds.height]; });
      out.graphPointsStaySquare = points.length > 0 && points.every((el) => {
        const bounds = el.getBoundingClientRect();
        return el.localName === "rect" && el.getAttribute("width") === "12" && el.getAttribute("height") === "12"
          && el.getAttribute("rx") === "2" && el.getAttribute("stroke-width") === "1" && Math.abs(bounds.width - bounds.height) < 0.1;
      });
      steps();
      const colorInput = document.querySelector("#nodeGradientsBody .node-gradient-native-color-picker");
      const colorHandle = document.querySelector("#nodeGradientsBody .node-gradient-handle");
      let pickerOpened = false;
      if (colorInput && colorHandle) {
        colorInput.showPicker = () => { pickerOpened = true; };
        colorHandle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      }
      out.doubleClickOpensNativeColorPicker = pickerOpened && Boolean(colorInput?.dataset.stopId);
      out.noVisibleColorWidget = Boolean(colorInput && !document.querySelector("#nodeGradientsBody .node-gradient-stop-colors"));
      if (colorInput) { colorInput.value = "#ff0000"; colorInput.dispatchEvent(new Event("input", { bubbles: true })); colorInput.dispatchEvent(new Event("change", { bubbles: true })); }
      out.colorPicker = g().stops[0].color === "#ff0000"
        && Boolean(document.querySelector("#nodeGradientsBody .node-gradient-strip")?.style.background);
      const shapeButton = document.querySelector('#nodeGradientsBody [data-gradient-action="curveShape"][data-shape="smoothstep"]');
      out.shapeControls = Boolean(shapeButton && document.querySelector("#nodeGradientsBody [data-gradient-skew]"));
      const curveChart = document.querySelector("#nodeGradientsBody [data-gradient-graph]");
      out.curveChart = Boolean(curveChart && curveChart.querySelector("path") && curveChart.querySelectorAll("[data-curve-point]").length === g().stops.length * g().params.length);
      shapeButton?.click();
      const skew = document.querySelector("#nodeGradientsBody [data-gradient-skew]");
      if (skew) {
        skew.value = "0.35";
        skew.dispatchEvent(new Event("input", { bubbles: true }));
        skew.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const curveParam = shapeButton ? g().params.find((p) => p.nodeId === shapeButton.dataset.nodeId && p.key === shapeButton.dataset.paramKey) : null;
      const curve = curveParam ? g().stops.find((s) => s.id === shapeButton.dataset.stopId)?.curves?.[curveParam.nodeId]?.[curveParam.key] : null;
      out.curveStored = curve?.shape === "smoothstep" && Math.abs(curve?.skew - 0.35) < 1e-9;
      out.otherParamLinear = curveParam ? g().params.filter((p) => p !== curveParam).every((p) => !g().stops[0].curves?.[p.nodeId]?.[p.key]) : false;
      nodeGraphGradientPageSetPlayhead(g(), 0.2);
      nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), "test playhead baseline");
      h = nodeGraphMvp.historyIndex;
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
        for (const f of [0.35, 0.4, 0.45, 0.48]) { ev("pointermove", f); glide.push(eff()); }
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
        g().position = 0.2;
        nodeGraphGradientsNotifyPlayhead(g(), "test bar click");
        nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), "test bar click");
      }
      out.stopsAfterTap = g().stops.length; out.positionAfterTap = Math.round(g().position * 100) / 100; out.tapSteps = steps();
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
    ok(r.created.length === 1 && r.created[0] === "Gradient 1" && r.createSteps === 1 && r.newGradientReady, "New Gradient starts in Edit at 1 with stop 0 holding current settings");
    ok(r.migratedPositions, "legacy 0..127 positions migrate to normalized 0..1 values");
    ok(r.clonedKeepsGradients, "patch clones keep gradients");
    ok(r.firstMoveCreatesEndStop && r.newParamsJoinLive, "first move creates stop 1 and later untracked parameters join live with their start values preserved");
    ok(r.editHeld && r.allJoinedControlsGold && r.paramColorsMatch, "Edit keeps slider thumbs held and uses each parameter's same color for its outline, chip and curve");
    ok(r.curveContextSettings && r.sliderContextSettings, "right-click on a parameter curve or control opens that parameter's settings, including smoothing");
    ok(r.unsnappedMoveCreatesAllParamsStop, "an unsnapped move creates a stop for all params without moving untouched curves");
    ok(r.editOffDiscards, "turning Edit off clears edit state without changing base values");
    ok(r.playheadSnapAndLiveEdit && r.playheadSnapReleases, "playhead snaps within two steps, live edits the snapped stop, and releases beyond the threshold");
    ok(r.rows.length === 3, "one row per joined parameter");
    ok(r.graphsHiddenByDefault && r.graphsShowOnDemand, "graphs start hidden and the page toggle shows them");
    ok(r.graphCapture && r.graphHorizontalDrag && r.graphVerticalDrag, "graph point drag keeps pointer capture and separates shared position from selected-param value");
    ok(r.graphPointsStaySquare, "selected and unselected graph points keep the same square shape");
    ok(r.graphPointDoesNotResizeOnPress, "selecting a graph point does not change its pixel-aligned geometry");
    ok(r.doubleClickOpensNativeColorPicker && r.noVisibleColorWidget, "double-clicking a gradient stop opens the native color picker with no visible extra widget");
    if (r.visible) ok(r.colorPicker, "the app color picker updates stop color and the visible gradient strip");
    ok(r.shapeControls && r.curveStored && r.otherParamLinear, "HTML shape and skew controls store a per-param segment curve without changing the other parameter");
    ok(r.curveChart, "selected parameter renders SVG stop points and its shaped curve");
    if (r.visible) ok(r.stripHeight === 24, "the shared stop lane is 24 px tall");
    ok(r.stepsDuringDrag === 0 && r.releaseSteps === 1, "a playhead drag is exactly one undo step");
    ok(r.position === (r.visible ? 0.48 : 0.8) && (r.glides || !r.visible) && r.baseUnchanged, "dragging glides the effective value; the base never changes");
    ok(!r.holdsBefore && /^Holds still: /.test(r.holdsText) && !r.holdsAfter, "Holds still line only for a gradient touching a Step Graph");
    if (r.visible) ok(r.ghostShown && r.ghostValue, "the gradient's moved value shows as the slider ghost and number");
    ok(r.displayValue, "displays read the gradient's moved value");
    ok(r.toggleSteps === 1 && r.disabledEffIsBase, "Off removes the gradient's effect, one step");
    ok(r.name === "Bright sweep" && r.renameSteps === 1, "Rename");
    ok(r.stopsAfterTap === 3 && r.positionAfterTap === 0.2 && r.tapSteps === 1 && r.stopsAfterDelete === 2 && r.deleteStopSteps === 1, "empty bar click moves the playhead without adding a stop; Delete stop removes a selected stop");
    ok(r.setStartSteps === 1, "Set start");
    ok(r.deleteDrops, "deleting a module drops its params in the same undo step (D-G1)");
    ok(r.roundTrip, "save / load round trip");
    if (r.visible) ok(r.minRow >= 28, "curve controls have readable hit areas");
    ok(r.titles === 0, "no title tooltips");
    assert.deepEqual(errors, [], `${where}: no page errors`);
    console.log(`ok   ${where}${r.visible ? "" : " (panel hidden in perform mode: data checks only)"}`);
    await page.close();
  }
  console.log("Gradients page: create, live stop editing, drag (one undo step), buttons, D-G1 delete, save / load pass on index.html and perform.html.");
} finally {
  await browser?.close();
  server?.kill();
}
