// HP-24: editing a gradient stop's values on the 🌈 page. Real page on its own server.py port (never 8765 / 8766 / 8080) unless
// SANDBOX_URL is set.
//   - tap a stop: the playhead snaps there, the stop is outlined, and every slider of that gradient is marked (data-gradient-edit);
//   - moving a marked slider writes into that stop's offset (the base param stays), one undo step per release, none while moving;
//   - an unmarked slider still writes its base;
//   - tap the stop again, Esc, or tap empty strip: editing ends (and the empty-strip tap adds no stop);
//   - the playhead leaving the stop ends the outlines.
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
  // Boot can still restore the working patch just after interface-ready; let it land before building the test patch.
  await page.waitForTimeout(1500);

  const r = await page.evaluate(async () => { try {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = { stage: "start" };
    window.__seOut = out;
    const opt = { record: false, autosaveWorkingPatch: false };
    const a = showNodeGraphModule("polyBlep", { x: 100, y: 100 }, opt);
    await wait(200);
    const node = () => nodeGraphPatchNode(a);
    const meta = nodeGraphReadPatchParameterMetadata(node(), "frequency");
    const s0 = nodeGraphParamControlPosition(node().params.frequency, meta);
    nodeGraphMvp.patch.gradients = NodeGraphGradients.normalize([{ id: "g1", name: "Test", enabled: true, position: 0,
      origin: { [a]: { frequency: s0 } }, params: [{ nodeId: a, key: "frequency" }],
      stops: [{ id: "s1", pos: 0, offsets: {} }, { id: "s2", pos: 1, offsets: { [a]: { frequency: 0.1 } } }] }]);
    recordNodeGraphHistory();
    openNodeGraphUnifiedWindowPage("gradients");
    await wait(80);
    const g = () => nodeGraphMvp.patch.gradients.find((x) => x.id === "g1");
    const strip = () => document.querySelector('#nodeGradientsBody .node-gradient-strip[data-gradient-id="g1"]');
    const tap = (target, clientX) => {
      const rect = strip().getBoundingClientRect();
      const x = clientX ?? (target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2);
      const y = rect.top + rect.height / 2;
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, button: 0, clientX: x, clientY: y }));
      strip().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, button: 0, clientX: x, clientY: y }));
    };
    const handle = (id) => strip().querySelector(`[data-stop-id="${id}"]`);
    const slider = () => nodeGraphSliderForParameter(a, "frequency");
    const marked = () => slider()?.dataset.gradientEdit === "1";
    const eff = () => { const n = node(); const p = { ...n.params }; applyNodeGraphParamOffsets(n, p); return p.frequency; };

    out.stage = "tap";
    // Tap stop 2: edit it.
    tap(handle("s2"));
    await wait(30);
    out.snapped = g().position === 1;
    out.handleOutlined = handle("s2").classList.contains("is-editing");
    out.sliderMarked = marked();
    out.note = Boolean(document.querySelector("#nodeGradientsBody .node-gradient-editing"));

    out.stage = "move";
    // Move the marked slider: the stop's offset takes it, the base stays, one undo step on release only.
    const base = node().params.frequency;
    const h0 = nodeGraphMvp.historyIndex;
    const target = base * 3;
    setNodeSliderValue(slider(), target * 0.9, { interaction: "drag" });
    setNodeSliderValue(slider(), target, { interaction: "drag" });
    out.stepsDuringMove = nodeGraphMvp.historyIndex - h0;
    commitNodeSliderDragValue(slider());
    out.stepsOnRelease = nodeGraphMvp.historyIndex - h0;
    out.baseKept = node().params.frequency === base;
    out.soundsAtTarget = Math.abs(eff() - target) / target < 1e-6;
    out.offsetWritten = Math.abs(g().stops.find((s) => s.id === "s2").offsets[a].frequency - 0.1) > 1e-6;

    out.stage = "phase";
    // PASTE-7: a typed value while editing writes the stop too (one undo step, base kept).
    const h1 = nodeGraphMvp.historyIndex;
    const typed = Math.round(base * 2);
    updateNodeSliderCurrentValue(slider(), String(typed));
    out.typedSteps = nodeGraphMvp.historyIndex - h1;
    out.typedBaseKept = node().params.frequency === base;
    out.typedSounds = Math.abs(eff() - typed) / typed < 1e-6;

    // An unmarked slider writes its base as before.
    const phase = nodeGraphSliderForParameter(a, "phase");
    out.phaseUnmarked = phase?.dataset.gradientEdit !== "1";
    if (phase) { setNodeSliderValue(phase, 0.25, { interaction: "drag" }); commitNodeSliderDragValue(phase); }
    out.phaseBase = !phase || Math.abs(node().params.phase - 0.25) < 1e-9;

    // Tap the same stop again: editing ends.
    tap(handle("s2"));
    await wait(30);
    out.offAfterRetap = !marked() && !handle("s2").classList.contains("is-editing");

    // Esc ends editing.
    tap(handle("s2"));
    await wait(30);
    const onBeforeEsc = marked();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(30);
    out.escEnds = onBeforeEsc && !marked();

    // Empty strip while editing: ends editing and adds no stop.
    tap(handle("s2"));
    await wait(30);
    const stopsBefore = g().stops.length;
    const rect = strip().getBoundingClientRect();
    tap(strip(), rect.left + rect.width * 0.5);
    await wait(30);
    out.emptyTapEnds = !marked() && g().stops.length === stopsBefore;

    // Playhead leaving the stop: no outlines.
    tap(handle("s2"));
    await wait(30);
    g().position = 0.5;
    nodeGraphGradientsNotifyChanged("test");
    nodeGraphGradientEditSyncOutlines();
    out.betweenStopsUnmarked = !marked();
    nodeGraphGradientEditEnd();
    const baseBefore = node().params.frequency;
    updateNodeSliderCurrentValue(slider(), String(Math.round(baseBefore + 7)));
    out.typedOutsideWritesBase = node().params.frequency === Math.round(baseBefore + 7);
    return out; } catch (e) { return { error: String(e), stage: window.__seOut?.stage, out: window.__seOut }; }
  });
  const ok = (cond, msg) => assert.ok(cond, `${msg} ${JSON.stringify(r)}`);
  ok(r.snapped && r.handleOutlined && r.sliderMarked && r.note, "tapping a stop edits it: playhead snaps, stop and its sliders outlined");
  ok(r.stepsDuringMove === 0 && r.stepsOnRelease === 1, "a slider move is one undo step, on release");
  ok(r.baseKept && r.soundsAtTarget && r.offsetWritten, "the move writes the stop's offset; the base stays");
  ok(r.typedSteps === 1 && r.typedBaseKept && r.typedSounds, "a typed value while editing writes the stop, one undo step");
  ok(r.phaseUnmarked && r.phaseBase, "an unoutlined slider still writes its base");
  ok(r.offAfterRetap, "tapping the edited stop again ends editing");
  ok(r.escEnds, "Esc ends editing");
  ok(r.emptyTapEnds, "tapping empty strip ends editing and adds no stop");
  ok(r.betweenStopsUnmarked, "between stops nothing is outlined");
  ok(r.typedOutsideWritesBase, "outside stop editing a typed value writes the base");
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_gradient_stop_edit: ok");
} finally {
  await browser?.close();
  server?.kill();
}
