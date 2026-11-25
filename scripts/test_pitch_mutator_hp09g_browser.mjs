// HP-09g on the real page (own server.py on a free port, never 8765 / 8766 / 8080, unless SANDBOX_URL is set).
//  - the Mutator has pitch, f and 0-1 outputs with symbol labels; f keeps its name
//  - the status line uses the pitch symbol, never the words "Pitch In"
//  - one note-name convention everywhere: MIDI 0 = C-2, MIDI 60 = C3
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
  step = "outputs";
  const def = await page.evaluate(() => JSON.parse(JSON.stringify({ outputs: nodeGraphModuleDefinitions.pitchMutator.outputs, labels: nodeGraphModuleDefinitions.pitchMutator.outputLabels, inputs: nodeGraphModuleDefinitions.pitchMutator.inputs })));
  assert.deepEqual(def.outputs, ["Gate", "pitch", "f", "unit", "Velocity"], "outputs: pitch, f and 0-1 (unit) beside Gate and Velocity");
  assert.equal(def.labels.pitch, "♯/♭", "pitch uses the app's pitch symbol");
  assert.equal(def.labels.f, "ƒ", "f keeps its symbol");
  assert.equal(def.labels.unit, "0–1", "0-1 uses the app's 0-1 label");
  assert.ok(def.inputs.includes("pitch"), "Pitch In is still the pitch input");

  step = "status uses the pitch symbol";
  await page.evaluate((i) => {
    const kb = showNodeGraphModule("keyboard", { x: 60, y: 400 }, { record: false, autosaveWorkingPatch: false, skipLivePlan: true });
    window.__kb = kb;
    nodeGraphMvp.patch.connections.push({ sourceNode: kb, sourcePort: "f", destinationNode: i.pm, destinationPort: "pitch" });
    commitNodeGraphPatch(nodeGraphMvp.patch, { status: "Wire Pitch In" });
  }, ids);
  await page.evaluate(() => sendNodeGraphLiveKeyboardModuleSignal(window.__kb, { frequency: 261.6256, gate: 1, midi: 60 }));
  await page.locator(`${O} .pm-key[data-note="48"]`).click();
  await page.waitForFunction(() => /= Pitch knob/.test(document.querySelector("#pitchMutatorOverlay [data-pm=playhead]")?.textContent || ""));
  const playhead = await page.locator(`${O} [data-pm=playhead]`).innerText();
  assert.ok(playhead.includes("♯/♭"), `the pitch symbol shows where Pitch In was named: ${playhead}`);
  assert.ok(!/Pitch In/.test(await page.locator(O).innerText()), "the words Pitch In appear nowhere in the overlay");

  step = "note names";
  const names = await page.evaluate(() => {
    const bad = [];
    for (let n = 0; n <= 127; n += 1) {
      const want = nodeGraphKeyboardPitchLabel(n);
      const got = { seq: sequencerPitchLabel(n), arp: nodeGraphArpPitchLabel(n), patch: nodeGraphCircuitPatchMidiName(n), pm: nodeGraphPitchManagerPitchText(n).split(" ")[1] };
      for (const [k, v] of Object.entries(got)) if (v !== want) bad.push(`${n} ${k}: ${v} != ${want}`);
    }
    const caps = {};
    for (const n of [0, 12, 60]) caps[n] = document.querySelector(`#pitchMutatorOverlay .pm-key[data-note="${n}"]`).textContent;
    return { bad, c0: nodeGraphKeyboardPitchLabel(0), c60: nodeGraphKeyboardPitchLabel(60), caps };
  });
  assert.deepEqual(names.bad, [], "every note-name display agrees with the shared helper");
  assert.equal(names.c0, "C-2", "MIDI 0 is C-2");
  assert.equal(names.c60, "C3", "MIDI 60 is C3");
  assert.equal(names.caps[0], "C-2", "the Mutator keyboard's lowest key reads C-2");
  assert.equal(names.caps[60], "C3", "the Mutator keyboard's MIDI 60 reads C3");
  if (shots) await page.screenshot({ path: path.join(shots, "hp09g.png") });
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_pitch_mutator_hp09g_browser: ok");
} catch (error) {
  console.error(`FAILED at "${step}": ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
