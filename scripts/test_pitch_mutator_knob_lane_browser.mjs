// HP-09c: the Pitch Mutator knob lane, end to end on the REAL UI path (real page.mouse on the real face widget, real Arm / Pin buttons).
// Starts its own server.py on a free port (never 8765 / 8766 / 8080) unless SANDBOX_URL is set. No fixed sleeps: every wait is a condition.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(path.join(ROOT, "package.json"))("playwright")); }

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : "";
if (shots) fs.mkdirSync(shots, { recursive: true });

let server = null;
let browser = null;
const errors = [];
let step = "";
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 240; i += 1) {
      try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  // The late working-patch load (INDEX S-4) can still replace the graph: wait until the patch object and its node count stop changing.
  await page.waitForFunction(() => {
    const w = window; const patch = nodeGraphMvp.patch; const n = patch && patch.nodes ? patch.nodes.length : -1;
    const now = performance.now();
    if (!w.__settle || w.__settle.patch !== patch || w.__settle.n !== n) w.__settle = { patch, n, since: now };
    return now - w.__settle.since > 2000;
  }, null, { timeout: 120000, polling: 100 });

  // Modules in the top half (the overlay covers the bottom 260 px).
  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const pm = showNodeGraphModule("pitchMutator", { x: 60, y: 60 }, options);
    const flt = showNodeGraphModule("flowerChildFilter", { x: 700, y: 60 }, options);
    const kb = showNodeGraphModule("keyboard", { x: 60, y: 500 }, options);
    return { pm, flt, kb };
  });
  await page.waitForFunction((i) => !!document.querySelector(`.dsp-node[data-node="${i.flt}"] .node-face`), ids);
  await page.evaluate(() => { setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false }); });

  const mut = () => page.evaluate((id) => JSON.parse(JSON.stringify(nodeGraphPatchNode(id).mutator)), ids.pm);
  const base = () => page.evaluate((id) => Number(nodeGraphPatchNode(id).params.frequency), ids.flt);
  const effective = () => page.evaluate((id) => {
    const n = nodeGraphPatchNode(id);
    const p = { frequency: Number(n.params.frequency) };
    applyNodeGraphParamOffsets(n, p, { notify: false });
    return { live: p.frequency, base1: applyNodeGraphParamOffsetsToBase(n, "frequency", Number(n.params.frequency), n.paramMeta.frequency) };
  }, ids.flt);
  const status = () => page.locator("#pitchMutatorOverlay [data-pm=status]").innerText();
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + ".png") }); };
  const clickPm = async (pm) => {
    const box = await page.locator(`#pitchMutatorOverlay [data-pm="${pm}"]`).first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const clickNote = async (note) => {
    // scroll the strip to the note, then a real pointer tap on its key
    await page.evaluate((n) => { const k = document.querySelector(`#pitchMutatorOverlay .pm-key[data-note="${n}"]`); k.scrollIntoView({ block: "nearest", inline: "center" }); }, note);
    await page.waitForFunction((n) => { const k = document.querySelector(`#pitchMutatorOverlay .pm-key[data-note="${n}"]`); const r = k.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }, note);
    const box = await page.locator(`#pitchMutatorOverlay .pm-key[data-note="${note}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  // Where the Cutoff widget of the Flower Child face is on screen.
  const knobPoint = () => page.evaluate((id) => {
    const article = document.querySelector(`.dsp-node[data-node="${id}"]`);
    const face = article.querySelector(".node-face");
    const widgets = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpecForElement(article), face.offsetWidth, article);
    const wd = widgets.find((w) => nodeGraphModuleFaceWidgetKeys(w).includes("frequency"));
    const keys = nodeGraphModuleFaceWidgetKeys(wd), i = keys.indexOf("frequency");
    const r = face.getBoundingClientRect(); const sx = r.width / face.offsetWidth;
    return { x: r.left + (wd.x + wd.w * (i + 0.5) / keys.length) * sx, y: r.top + (wd.y + wd.h / 2) * sx };
  }, ids.flt);
  const drag = async (dy) => {
    const p = await knobPoint();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y + dy, { steps: 8 });
    await page.mouse.up();
  };

  // 1. Auto-Pin ON -----------------------------------------------------------------------------------------------------------------
  step = "open overlay";
  await page.evaluate(() => togglePitchMutatorOverlay(true));
  assert.match(await status(), /Not armed\. Press Arm, then turn the knob you want to control\./);
  const base0 = await base();
  step = "arm";
  await clickPm("arm");
  assert.match(await status(), /Armed: turn the knob you want to bind\./);
  assert.match(await page.locator('#pitchMutatorOverlay [data-pm="arm"]').innerText(), /On/, "Arm shows On in text");
  await clickPm("autopin");
  assert.match(await page.locator('#pitchMutatorOverlay [data-pm="autopin"]').innerText(), /On/, "Auto-Pin shows On in text");
  await clickNote(60);
  step = "real drag binds";
  await drag(-60);
  let m = await mut();
  assert.equal(m.lanes.length, 1, "one lane bound by a real drag");
  assert.deepEqual(m.lanes[0].target, { nodeId: ids.flt, paramKey: "frequency" });
  assert.equal(await page.evaluate((id) => !!nodeGraphPatchNode(id)._mutatorArmed, ids.pm), false, "Arm is off again after the bind (D-M8)");
  assert.match(await status(), /Bound: .*\/ .*\./);
  assert.ok(await page.locator("#pitchMutatorOverlay .pm-chip").count() === 1, "the lane chip appears");
  assert.equal(await base(), base0, "stored base never changes");
  assert.equal(m.lanes[0].keys.length, 1, "Auto-Pin: the first drag pinned at C4");
  assert.equal(m.lanes[0].keys[0].x, 60);
  await clickNote(84);
  await drag(60);
  m = await mut();
  assert.deepEqual(m.lanes[0].keys.map((k) => k.x), [60, 84], "two keys at C4 and C6");
  assert.notEqual(m.lanes[0].keys[0].offset, m.lanes[0].keys[1].offset, "with different offsets");
  assert.equal(await page.locator("#pitchMutatorOverlay svg circle.pm-pin").count(), 2, "the plot shows 2 pin dots");
  await shot("c6-pinned");

  // 2. The knob follows the note ---------------------------------------------------------------------------------------------------
  step = "follow the note";
  const k = m.lanes[0].keys;
  const expectAt = async (note, lo, hi) => {
    await clickNote(note);
    const e = await effective();
    assert.equal(e.live, e.base1, `live params and base path agree at note ${note}`);
    const shown = await page.evaluate((id) => Number(nodeGraphSliderForParameter(id, "frequency").dataset.domainValue), ids.flt);
    assert.ok(Math.abs(shown - e.live) < 1e-9, `the knob shows the effective value at note ${note} (${shown} vs ${e.live})`);
    return e.live;
  };
  const at60 = await expectAt(60), at84 = await expectAt(84), at72 = await expectAt(72);
  assert.notEqual(at60, at84, "C4 and C6 give different cutoffs");
  assert.ok((at72 > Math.min(at60, at84)) && (at72 < Math.max(at60, at84)), "C5 lies between the pinned values");
  assert.equal(await base(), base0, "stored base still untouched");
  assert.match(await page.locator("#pitchMutatorOverlay .pm-chip").innerText(), /\d/, "chip fallback shows the effective value");
  await clickNote(60);
  await shot("c4");

  // 3. Auto-Pin OFF on a fresh lane -----------------------------------------------------------------------------------------------
  step = "auto-pin off";
  await page.evaluate((id) => { const n = nodeGraphPatchNode(id); n.mutator.lanes.length = 0; n.mutator.autoPin = false; pitchMutatorRefreshOverlay(); }, ids.pm);
  await clickPm("arm");
  await clickNote(60);
  await drag(-60);
  m = await mut();
  assert.equal(m.lanes.length, 1, "bound again");
  assert.equal(m.lanes[0].keys.length, 0, "Auto-Pin off: the turn is pending");
  assert.equal(await base(), base0, "base unchanged by the turn");
  const pending = (await effective()).live;
  assert.notEqual(pending, base0, "the pending value shows at the playhead");
  await clickNote(72);
  assert.equal((await effective()).live, base0, "another note drops the pending value");
  await clickNote(60);
  await drag(-60);
  await clickPm("pin");
  await clickNote(84);
  await drag(60);
  await clickPm("pin");
  m = await mut();
  assert.deepEqual(m.lanes[0].keys.map((q) => q.x), [60, 84]);
  assert.notEqual(m.lanes[0].keys[0].offset, m.lanes[0].keys[1].offset, "two different keys with Auto-Pin off");
  assert.notEqual((await expectAt(60)), (await expectAt(84)));
  assert.equal(await base(), base0);

  // 4. Armed with the overlay closed -----------------------------------------------------------------------------------------------
  step = "closed overlay";
  await page.evaluate((id) => { const n = nodeGraphPatchNode(id); n.mutator.lanes.length = 0; pitchMutatorRefreshOverlay(); }, ids.pm);
  await clickPm("arm");
  await page.evaluate(() => togglePitchMutatorOverlay(false));
  assert.match(await page.evaluate(() => document.getElementById("pitchMutatorCcButton")?.textContent || ""), /armed/, "the Mutators button shows armed while closed");
  await drag(-40);
  m = await mut();
  assert.equal(m.lanes.length, 1, "a drag with the overlay closed binds (D-M8)");
  await page.evaluate((id) => { const n = nodeGraphPatchNode(id); n.mutator.lanes.length = 0; }, ids.pm);
  const before = await base();
  await drag(-40);
  assert.notEqual(await base(), before, "not armed, no lane: a normal base write");
  await page.evaluate(({ id, v }) => { nodeGraphPatchNode(id).params.frequency = v; }, { id: ids.flt, v: base0 });

  // 5. Freq In and the native playhead ---------------------------------------------------------------------------------------------
  step = "freq in";
  await page.evaluate((i) => {
    nodeGraphMvp.patch.connections.push({ sourceNode: i.kb, sourcePort: "f", destinationNode: i.pm, destinationPort: "f" });
    commitNodeGraphPatch(nodeGraphMvp.patch, { status: "Wire Freq In" });
  }, ids);
  const wired = await page.evaluate((i) => nodeGraphMvp.patch.connections.some((c) => c.sourceNode === i.kb && c.destinationNode === i.pm && c.destinationPort === "f"), ids);
  assert.ok(wired, "keyboard f is wired into the Mutator's Freq In");
  {
    for (const hz of [880, 130.8128]) {
      await page.evaluate(({ kb, hz }) => sendNodeGraphLiveKeyboardModuleSignal(kb, { frequency: hz, gate: 1, midi: 0 }), { kb: ids.kb, hz });
      const live = await page.evaluate((id) => { const n = nodeGraphPatchNode(id); const p = { playheadHz: 0 }; applyNodeGraphParamOffsets(n, p, { notify: false }); return p.playheadHz; }, ids.pm);
      assert.ok(Math.abs(live - hz) < 1e-6, `live playheadHz follows Freq In (${hz}), got ${live}`);
    }
  }

  // 6. Save and reload -------------------------------------------------------------------------------------------------------------
  step = "save and reload";
  const saved = await page.evaluate((id) => JSON.parse(JSON.stringify(nodeGraphPatchNode(id).mutator)), ids.pm);
  const reloaded = await page.evaluate((id) => {
    const copy = JSON.parse(JSON.stringify(nodeGraphMvp.patch));
    const patch = loadNodeGraphPatchFromObject(copy);
    return JSON.parse(JSON.stringify(patch.nodes.find((n) => n.id === id).mutator));
  }, ids.pm);
  assert.deepEqual(reloaded.lanes, saved.lanes, "lane and keys survive a save and load");

  assert.deepEqual(errors, [], "no page errors");
  console.log("test_pitch_mutator_knob_lane_browser: ok");
} catch (e) {
  console.error(`FAILED at "${step}":`, e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
