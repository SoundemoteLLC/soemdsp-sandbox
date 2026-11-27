#!/usr/bin/env node
// Real repeated input with overlapping/raised keyboards, zoom, and live-style
// display-only frames. KEYBOARD_TEST_LIVE=1 also requests real Play/Stop.
// The full-present oracle is test-only: natural pixels must already match it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); });
});
assert(![8765, 8766, 8080].includes(port));
const server = spawn(process.platform === "win32" ? "python" : "python3", ["-u", "server.py", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let browser;
const failures = [];
let checks = 0;
try {
  await new Promise((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (data) => { output += data; if (output.includes("soemdsp-sandbox serving")) resolve(); });
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--mute-audio"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("#nodeBootStartButton").click();
  await page.waitForFunction(() => document.body.classList.contains("node-boot-ready") && typeof createNodeSliderReadout === "function", null, { timeout: 180000 });
  await page.locator(".node-boot-loading-screen").waitFor({ state: "hidden", timeout: 180000 });
  await page.evaluate(async () => {
    const a = createNodeGraphPatchNode("keyboard", { id: "stressA", gx: 3, gy: 3 });
    const b = createNodeGraphPatchNode("keyboard", { id: "stressB", gx: 8, gy: 4 });
    const osc = createNodeGraphPatchNode("polyBlep", { id: "stressScope", gx: 15, gy: 4 });
    const output = createNodeGraphPatchNode("output", { id: "output", gx: 21, gy: 4 });
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes: [a, b, osc, output], cables: [], connections: [{ sourceNode: "stressScope", sourcePort: "Wave", destinationNode: "output", destinationPort: "In" }] }, { status: "keyboard stress" });
    flushNodeGraphViewportImmediate({ persist: false });
    await new Promise(requestAnimationFrame);
    const boxes = [a, b].map((n) => nodeGraphGlGraphWorldBox(nodeGraphNodeElement(n.id)));
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    viewFrame({ x: x - 60, y: y - 60, w: Math.max(...boxes.map((b) => b.x + b.w)) - x + 120, h: Math.max(...boxes.map((b) => b.y + b.h)) - y + 120 });
    window.__ks = { draws: {}, log: [], phase: "setup", displayCalls: 0 };
    const signature = (surface) => JSON.stringify(nodeGraphKeyboardKeyModel(surface)?.keys.map((k) => [k.midi, [...k.state._on].sort()]));
    __ks.signature = signature;
    __ks.record = (event) => { __ks.log.push(event); if (__ks.log.length > 30) __ks.log.shift(); };
    const draw = nodeGraphKeyboardGlDraw;
    nodeGraphKeyboardGlDraw = function (batch, surface, ...args) {
      const id = nodeGraphKeyboardNodeIdFromElement(surface);
      __ks.draws[id] = signature(surface);
      __ks.record({ op: "draw", id });
      return draw(batch, surface, ...args);
    };
    const repaint = nodeGraphGlGraphRepaintMeshedPlates;
    nodeGraphGlGraphRepaintMeshedPlates = function (ids, ...args) {
      const ok = repaint(ids, ...args);
      __ks.record({ op: "repaint", ids, ok });
      return ok;
    };
    const present = nodeGraphGlGraphPresentOnce;
    nodeGraphGlGraphPresentOnce = function (options = {}) {
      const before = [...(nodeGraphGlGraphState.valueChromeDirty || [])];
      const ok = present(options);
      if (options.displaysOnly) __ks.displayCalls++;
      __ks.record({ op: "present", display: !!options.displaysOnly, before, after: [...(nodeGraphGlGraphState.valueChromeDirty || [])], ok });
      return ok;
    };
  });
  const frames = (n = 3) => page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame);
      // Match live scopes calling this in the same frame as queued UI paints.
      nodeGraphGlGraphPresent({ displaysOnly: true });
    }
  }, n);
  await frames();
  if (process.env.KEYBOARD_TEST_LIVE === "1") {
    await page.locator("#nodeTransportPlay").click();
    await page.waitForFunction(() => nodeGraphLiveTransportUiState() === "playing", null, { timeout: 20000 }).catch(() => {});
    console.log("Real Play:", await page.evaluate(() => ({ transport: nodeGraphLiveTransportUiState(), context: nodeGraphMvp.live.context?.state, engine: Boolean(nodeGraphMvp.live.node), status: document.getElementById("nodeLiveStatus")?.textContent })));
  }
  async function locate(id) {
    return page.evaluate((id) => {
      const keys = nodeGraphKeyboardAllKeys().filter((k) => nodeGraphKeyboardNodeIdFromElement(k.surface) === id && !k.black);
      for (const key of keys) {
        const r = nodeGraphKeyboardKeyClientRect(key);
        if (!r) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height * 0.75;
        if (x < 1 || x > innerWidth - 1 || y < 1 || y > innerHeight - 1) continue;
        const target = document.elementFromPoint(x, y);
        if (nodeGraphKeyboardNodeIdFromElement(target) !== id) continue;
        return { id, midi: key.midi, x, y, clip: { x: Math.floor(r.left + r.width * 0.2), y: Math.floor(r.top + r.height * 0.66), width: Math.max(1, Math.floor(r.width * 0.5)), height: Math.max(1, Math.floor(r.height * 0.12)) } };
      }
      throw new Error(`no exposed piano key for ${id}`);
    }, id);
  }
  async function check(tag, hit, expected = {}) {
    checks++;
    await frames();
    const before = await page.evaluate(({ id, midi }) => {
      const surface = nodeGraphKeyboardFaces(id)[0]?.querySelector(".node-keyboard-surface");
      const key = nodeGraphKeyboardKeyModel(surface)?.byMidi.get(midi);
      const mesh = nodeGraphGlGraphState.mesh;
      return {
        state: [...(key?.state._on || [])], signal: nodeGraphKeyboardRuntime(id).signal?.gate,
        staleDraw: __ks.draws[id] !== __ks.signature(surface), dirty: [...(nodeGraphGlGraphState.valueChromeDirty || [])],
        owners: mesh?.batches[0]?.layers?.map((l) => l.moduleRecord?.id), ranges: mesh?.plateGroupLayers,
        log: __ks.log.slice(), raised: nodeGraphModuleRaisedId,
      };
    }, hit);
    const natural = await page.screenshot({ clip: hit.clip });
    // A fresh full record must not repair any key pixels after queued work drained.
    await page.evaluate(() => nodeGraphGlGraphPresent({ resharpenText: true }));
    const fresh = await page.screenshot({ clip: hit.clip });
    const wrongState = Object.entries(expected).some(([state, on]) => before.state.includes(state) !== on);
    if (wrongState || before.staleDraw || !natural.equals(fresh)) {
      const failure = { tag, hit, expected, wrongState, pixelsStale: !natural.equals(fresh), ...before };
      failures.push(failure);
      console.log("FAIL", JSON.stringify(failure));
    }
  }
  const rounds = Number(process.env.KEYBOARD_STRESS_ROUNDS) || 6;
  for (const zoom of [1, 0.65, 1.5]) {
    await page.evaluate((z) => setNodeGraphZoom(z), zoom);
    await frames();
    for (let round = 0; round < rounds; round++) {
      for (const id of ["stressA", "stressB"]) {
        await page.evaluate((id) => setNodeGraphSelection({ type: "node", id }), id);
        const hit = await locate(id);
        await page.mouse.move(hit.x, hit.y);
        await page.mouse.down();
        await check(`z${zoom}/${round}/${id}/plain-down`, hit, { active: true });
        await page.mouse.up();
        await check(`z${zoom}/${round}/${id}/plain-up`, hit, { active: false });
        await page.keyboard.down("Shift");
        await page.mouse.click(hit.x, hit.y);
        await page.keyboard.up("Shift");
        await check(`z${zoom}/${round}/${id}/Shift-on`, hit, { active: true });
        await page.keyboard.down("Shift");
        await page.mouse.click(hit.x, hit.y);
        await page.keyboard.up("Shift");
        await check(`z${zoom}/${round}/${id}/Shift-off`, hit, { active: false });
        for (const modifier of ["Shift", "Control"]) {
          await page.keyboard.down(modifier);
          // No test delay between these real clicks: finish on the odd toggle.
          await page.mouse.click(hit.x, hit.y, { clickCount: 1 });
          await page.mouse.click(hit.x, hit.y, { clickCount: 1 });
          await page.mouse.click(hit.x, hit.y, { clickCount: 1 });
          await page.keyboard.up(modifier);
          await check(`z${zoom}/${round}/${id}/${modifier}`, hit);
        }
      }
    }
  }
  const transport = await page.evaluate(() => ({ transport: nodeGraphLiveTransportUiState(), engine: Boolean(nodeGraphMvp.live.node), context: nodeGraphMvp.live.context?.state || "absent" }));
  console.log(JSON.stringify({ checks, failures: failures.length, transport, displayCalls: await page.evaluate(() => __ks.displayCalls), errors: errors.slice(0, 5) }));
  if (process.env.KEYBOARD_TEST_LIVE === "1") {
    await page.locator("#nodeTransportStop").click();
    await page.waitForFunction(() => !nodeGraphMvp.live.node, null, { timeout: 15000 });
  }
  assert.equal(failures.length, 0, "natural keyboard paint must match a fresh full record");
  assert.equal(errors.length, 0, errors.join("\n"));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) await new Promise((resolve) => { server.once("exit", resolve); server.kill(); });
}
