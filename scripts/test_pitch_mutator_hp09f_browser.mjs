// HP-09f on the real page (real page.mouse). Own server.py on a free port (never 8765 / 8766 / 8080) unless SANDBOX_URL is set.
//  - a fresh Mutator's list is blank (no Frequency entry), no Hz field, no explanation text
//  - keys: press / drag selects, the last key dragged to wins, a key toggles off only on mouse up from the key that was already selected
//  - double click on the graph adds a point on the bound knob's lane
//  - the Offset number scrubs with the mouse (app scrub number), double click types
//  - the Glide button opens the Mutator's own parameter menu
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
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const patch = nodeGraphMvp.patch; const n = patch && patch.nodes ? patch.nodes.length : -1; const now = performance.now();
    if (!window.__settle || window.__settle.patch !== patch || window.__settle.n !== n) window.__settle = { patch, n, since: now };
    return now - window.__settle.since > 2000;
  }, null, { timeout: 120000, polling: 100 });

  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const pm = showNodeGraphModule("pitchMutator", { x: 60, y: 60 }, options);
    const flt = showNodeGraphModule("flowerChildFilter", { x: 700, y: 60 }, options);
    return { pm, flt };
  });
  await page.waitForFunction((i) => !!document.querySelector(`.dsp-node[data-node="${i.pm}"] input[data-param="playhead"]`), ids);
  if (!(await page.locator("#nodeSceneContextMenu").isVisible())) await page.locator("#nodeCommandCenterButton").click();
  await page.locator('#nodeSceneContextMenu [data-unified-action="mutators"]').click();
  await page.waitForFunction(() => !document.getElementById("pitchMutatorOverlay").hidden && !!document.querySelector("#pitchMutatorOverlay .pm-key"));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const O = "#pitchMutatorOverlay";
  const knobKey = () => page.evaluate(() => document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note") ?? null);
  const centre = async (n) => { const b = await page.locator(`${O} .pm-key[data-note="${n}"]`).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

  step = "blank list";
  assert.equal(await page.locator(`${O} [data-pm="lane"]`).count(), 0, "a fresh Mutator's list has no entries");
  const html = await page.locator(O).innerHTML();
  assert.ok(!/Frequency/.test(html), "no Frequency entry");
  assert.equal(await page.locator(`${O} [data-pm="hz"]`).count(), 0, "no Hz field");
  assert.ok(!/Wire Freq Out/.test(html), "no explanation text");

  step = "key press / drag / toggle";
  assert.equal(await knobKey(), null, "nothing selected on a fresh Mutator");
  // press selects at once; drag across keys leaves the last one; mouse up keeps it
  let [x, y] = await centre(60);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.waitForFunction(() => document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note") === "60");
  const [x2, y2] = await centre(66);
  const seen = new Set();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x + ((x2 - x) * i) / 12, y);
    seen.add(await knobKey());
  }
  await page.waitForFunction(() => document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note") === "66");
  assert.ok(![...seen].includes(null), "no flicker: a key is always selected while dragging");
  await page.mouse.up();
  assert.equal(await knobKey(), "66", "the last key dragged to wins and mouse up does not toggle it off");
  // press on the selected key, drag away and back, release on it: no toggle (the pointer moved)
  [x, y] = await centre(66);
  const [x3] = await centre(70);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x3, y, { steps: 6 });
  await page.waitForFunction(() => document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note") === "70");
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  assert.equal(await knobKey(), "66", "an excursion then a release on the key leaves it selected");
  // plain press and release on the already selected key toggles it off, on mouse up
  await page.mouse.move(x, y); await page.mouse.down();
  assert.equal(await knobKey(), "66", "still selected while the button is down");
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector("#pitchMutatorOverlay .pm-key.audition"));
  assert.equal(await page.evaluate((id) => Number(nodeGraphPatchNode(id).params.playhead), ids.pm), 0, "the Pitch knob is 0 after the toggle");

  step = "double click adds a point";
  await page.evaluate((i) => {
    const m = nodeGraphPatchNode(i.pm);
    m.mutator = { ...(m.mutator || {}), lanes: [{ id: "L1", target: { nodeId: i.flt, paramKey: "frequency" }, keys: [] }], activeLane: "L1", snap: true };
    pitchMutatorRefreshOverlay();
  }, ids);
  await page.waitForFunction(() => document.querySelectorAll('#pitchMutatorOverlay [data-pm="lane"]').length === 1);
  const svg = await page.locator(`${O} [data-pm=plot]`).boundingBox();
  const pinAt = async (note, fy) => {
    const px = svg.x + ((note + 0.5) / 128) * svg.width;
    await page.mouse.dblclick(px, svg.y + svg.height * fy);
  };
  const lane = () => page.evaluate((id) => JSON.parse(JSON.stringify(nodeGraphPatchNode(id).mutator.lanes[0].keys)), ids.pm);
  assert.deepEqual(await lane(), [], "no points yet");
  await pinAt(60, 0.25);
  await page.waitForFunction((id) => nodeGraphPatchNode(id).mutator.lanes[0].keys.length === 1, ids.pm);
  const k1 = (await lane())[0];
  assert.equal(k1.x, 60, "the point sits at the double-clicked key");
  assert.ok(Number.isFinite(k1.offset) && k1.offset !== 0, `its offset follows the pointer height (${k1.offset})`);
  await pinAt(72, 0.75);
  await page.waitForFunction((id) => nodeGraphPatchNode(id).mutator.lanes[0].keys.length === 2, ids.pm);
  assert.equal((await lane()).length, 2, "a second double click adds a second point");

  step = "offset scrub";
  await page.evaluate((id) => { const m = nodeGraphPatchNode(id); m.mutator.lanes[0].keys = [{ x: 60, offset: 0.1 }]; pitchMutatorRefreshOverlay(); }, ids.pm);
  await page.locator(`${O} .pm-key[data-note="60"]`).click(); // the playhead sits on the pin
  await page.waitForFunction(() => !!document.querySelector('#pitchMutatorOverlay [data-pm="offset"]'));
  const off = page.locator(`${O} [data-pm="offset"]`);
  assert.equal(await off.evaluate((e) => e.readOnly), true, "the offset is a read-only scrub number (drag, double click to type)");
  const ob = await off.boundingBox();
  const before = Number(await off.inputValue());
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
  await page.mouse.down();
  await page.mouse.move(ob.x + ob.width / 2 + 60, ob.y + ob.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate((id) => nodeGraphPatchNode(id).mutator.lanes[0].keys.find((k) => k.x === 60)?.offset, ids.pm);
  assert.ok(Math.abs(after - 0.1) > 0.01, `dragging the Offset number changes the pin (0.1 -> ${after}); field was ${before}`);
  await off.dblclick();
  assert.equal(await off.evaluate((e) => e.readOnly), false, "double click types");
  await page.keyboard.press("Escape");
  assert.equal(await off.evaluate((e) => e.readOnly), true, "Escape ends typing");

  step = "glide";
  await page.locator(`${O} [data-pm="glide"]`).click();
  await page.waitForFunction((i) => {
    const slider = document.querySelector(`.dsp-node[data-node="${i.pm}"] input[data-param="playhead"]`);
    return !!slider && nodeGraphMvp.metadataEditorTarget === slider.id && !document.getElementById("nodeParameterMetadataPopover").hidden;
  }, ids);
  const smoothing = await page.evaluate((id) => { const n = nodeGraphPatchNode(id); const m = nodeGraphReadPatchParameterMetadata(n, "playhead"); return { mode: m.smoothingMode }; }, ids.pm);
  assert.equal(smoothing.mode, "off", "Glide is off by default on the Pitch knob");
  if (shots) await page.screenshot({ path: path.join(shots, "hp09f.png") });
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_pitch_mutator_hp09f_browser: ok");
} catch (error) {
  console.error(`FAILED at "${step}": ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
