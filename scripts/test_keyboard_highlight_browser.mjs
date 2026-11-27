#!/usr/bin/env node
// Real pointer events and cached WebGL pixels with transport stopped.
// --baseline serves HEAD's keyboard files without changing the worktree.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.on("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const { port } = socket.address();
    socket.close(() => resolve(port));
  });
});
assert(![8765, 8766, 8080].includes(port));
const server = spawn(process.platform === "win32" ? "python" : "python3", ["-u", "server.py", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let browser;
try {
  await new Promise((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (data) => {
      output += data;
      if (output.includes("soemdsp-sandbox serving")) resolve();
    });
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: Number(process.env.KEYBOARD_TEST_WIDTH) || 1400, height: Number(process.env.KEYBOARD_TEST_HEIGHT) || 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.argv.includes("--proposed-grid-hooks")) {
    // Validate the proposed parent-owned integration without writing its file.
    let source = fs.readFileSync(path.join(root, "public/node-graph-gl-graph.js"), "utf8");
    if (!source.includes("nodeGraphGridKeyboardCollectChrome(id, el")) {
      const anchor = '    const graphFace = el.querySelector(".node-module-graph-display");';
      assert(source.includes(anchor), "Grid collector hook anchor");
      source = source.replace(anchor, '    if (typeof nodeGraphGridKeyboardCollectChrome === "function") nodeGraphGridKeyboardCollectChrome(id, el, buckets.keyboards);\n' + anchor);
    }
    if (!source.includes("kb.draw || nodeGraphKeyboardGlDraw")) {
      const anchor = '    if (typeof nodeGraphKeyboardGlDraw === "function") nodeGraphKeyboardGlDraw(batch, kb.surface, x, y, w, h);';
      assert(source.includes(anchor), "Grid draw hook anchor");
      source = source.replace(anchor, '    const drawKeyboard = kb.draw || nodeGraphKeyboardGlDraw;\n    if (typeof drawKeyboard === "function") drawKeyboard(batch, kb.surface, x, y, w, h);');
    }
    if (!source.includes("nodeGraphGridKeyboardGlPointerDown(event, point)")) {
      const start = source.indexOf("function nodeGraphGlHitPointerDown(event)");
      const prefix = source.slice(0, start);
      const tail = source.slice(start);
      const anchor = "  const hit = nodeGraphGlHitTest(point.x, point.y);";
      assert(start >= 0 && tail.includes(anchor), "Grid hit hook anchor");
      source = prefix + tail.replace(anchor, '  if (typeof nodeGraphGridKeyboardGlPointerDown === "function" && nodeGraphGridKeyboardGlPointerDown(event, point)) return;\n' + anchor);
    }
    await page.route("**/node-graph-gl-graph.js*", (route) => route.fulfill({ contentType: "text/javascript", body: source }));
    console.log("Testing proposed Grid hooks in served source only; shared file unchanged");
  }
  if (process.argv.includes("--baseline")) {
    for (const rel of ["modules/keyboardController/keyboard-face-gl.js", "modules/gridKeyboard/grid-keyboard.js", "node-graph-keyboard-chord-memory.js"]) {
      const body = execFileSync("git", ["show", `HEAD:public/${rel}`], { cwd: root, encoding: "utf8" });
      await page.route(`**/${rel}*`, (route) => route.fulfill({ contentType: "text/javascript", body }));
    }
  }
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click();
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => document.body.classList.contains("node-boot-ready")
    && typeof createNodeSliderReadout === "function", null, { timeout: 180000 });
  await page.locator(".node-boot-loading-screen").waitFor({ state: "hidden", timeout: 180000 });
  await page.evaluate(async () => {
    const piano = createNodeGraphPatchNode("keyboard", { id: "piano", gx: 3, gy: 3 });
    const grid = createNodeGraphPatchNode("gridKeyboard", { id: "grid", gx: 3, gy: 15 });
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes: [piano, grid], cables: [] }, { status: "keyboard highlight test" });
    setNodeGraphZoom(1);
    flushNodeGraphViewportImmediate({ persist: false });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const box = nodeGraphGlGraphWorldBox(document.querySelector('.dsp-node[data-node="piano"]'));
    viewFrame({ x: box.x - 20, y: box.y - 20, w: box.w + 40, h: box.h + 40 });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    nodeGraphGlGraphPresent();
  });
  const drain = () => page.evaluate(async () => {
    // One keyboard rAF schedules one graph-present rAF. No waiting on time.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const hit = await page.evaluate(() => {
    const key = nodeGraphKeyboardAllKeys().find((k) => k.surface.closest("[data-node]")?.dataset.node === "piano" && !k.black);
    if (!key) throw new Error("piano key model not mounted");
    const r = nodeGraphKeyboardKeyClientRect(key);
    window.__highlightKey = key;
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.85, clip: { x: r.left + 2, y: r.top + r.height * 0.7, width: Math.max(1, r.width - 4), height: Math.max(1, r.height * 0.2) } };
  });
  const snapshot = () => page.screenshot({ clip: hit.clip });
  const base = await snapshot();
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await drain();
  assert(await page.evaluate(() => __highlightKey.state.contains("active")), "plain press updates key state");
  const blue = await snapshot();
  assert(!base.equals(blue), "plain press updates cached GL pixels while stopped");
  await page.mouse.up();
  await drain();
  assert(!(await page.evaluate(() => __highlightKey.state.contains("active"))), "plain release clears state");
  await page.keyboard.down("Shift");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Shift");
  await drain();
  assert(await page.evaluate(() => __highlightKey.state.contains("active")), "Shift click sustains blue");
  assert(!base.equals(await snapshot()), "Shift blue pixels persist after release");
  await page.keyboard.down("Control");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Control");
  await drain();
  assert(await page.evaluate(() => __highlightKey.state.contains("held")), "Ctrl click latches gold");
  const gold = await snapshot();
  assert(!base.equals(gold) && !blue.equals(gold), "Ctrl gold pixels differ from idle and blue");
  await page.keyboard.down("Control");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Control");
  await drain();
  assert(!(await page.evaluate(() => __highlightKey.state.contains("held"))), "Ctrl click unlatches gold");
  await page.evaluate(() => {
    const node = nodeGraphPatchNode("piano");
    nodeGraphChordMemoryEnsureNode(node).slots[String(__highlightKey.midi)] = [__highlightKey.midi];
    nodeGraphChordMemoryPaintKeys();
  });
  await drain();
  const green = await snapshot();
  assert(await page.evaluate(() => __highlightKey.state.contains("chord-memory")), "stored chord paints slot state");
  assert(!green.equals(base) && !green.equals(gold) && !green.equals(blue), "chord slot changes cached GL pixels to green");
  await page.evaluate(() => {
    const box = nodeGraphGlGraphWorldBox(document.querySelector('.dsp-node[data-node="grid"]'));
    viewFrame({ x: box.x - 20, y: box.y - 20, w: box.w + 40, h: box.h + 40 });
  });
  await drain();
  const gridHit = await page.evaluate(() => {
    const pads = [...document.querySelectorAll('.dsp-node[data-node="grid"] .node-grid-keyboard-pad')];
    const pad = pads.find((el) => {
      const r = el.getBoundingClientRect();
      return r.top > 0 && r.bottom < innerHeight && r.left > 0 && r.right < innerWidth;
    });
    if (!pad) throw new Error("no visible Grid pad");
    window.__highlightPad = pad;
    const r = pad.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, clip: {
      x: Math.floor(r.left + r.width * 0.2), y: Math.floor(r.top + r.height * 0.2),
      width: Math.max(1, Math.floor(r.width * 0.6)), height: Math.max(1, Math.floor(r.height * 0.2)),
    } };
  });
  const gridSnapshot = () => page.screenshot({ clip: gridHit.clip });
  const gridBase = await gridSnapshot();
  await page.mouse.move(gridHit.x, gridHit.y);
  await page.mouse.down();
  await drain();
  const gridPress = await page.evaluate(({ x, y }) => ({
    target: document.elementFromPoint(x, y)?.className,
    pad: __highlightPad.className,
    midi: __highlightPad.dataset.gridMidi,
    signal: nodeGraphKeyboardRuntime("grid").signal,
    active: __highlightPad.classList.contains("active"),
  }), gridHit);
  assert(gridPress.active, "Grid real pointer reaches active state: " + JSON.stringify(gridPress));
  const gridBlue = await gridSnapshot();
  assert(!gridBase.equals(gridBlue), "Grid plain press changes GL pixels");
  await page.mouse.up();
  await drain();
  assert(!(await page.evaluate(() => __highlightPad.classList.contains("active"))), "Grid release clears blue state");
  await page.mouse.down();
  await page.mouse.move(gridHit.x + 0.1, gridHit.y);
  await drain();
  await page.evaluate(() => {
    const surface = __highlightPad.closest(".node-grid-keyboard-surface");
    if (!surface.hasPointerCapture(1)) throw new Error("Grid must own real mouse capture");
    surface.releasePointerCapture(1);
  });
  // Chrome delivers lostpointercapture on the next pointer sample.
  await page.mouse.move(1, 1);
  await drain();
  assert(!(await page.evaluate(() => __highlightPad.classList.contains("active"))), "Grid lost capture clears momentary blue");
  await page.mouse.up();
  await drain();
  await page.mouse.move(gridHit.x, gridHit.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(gridHit.x, gridHit.y);
  await page.keyboard.up("Shift");
  await drain();
  assert(await page.evaluate(() => __highlightPad.classList.contains("active")), "Grid Shift click sustains blue after release");
  assert(!gridBase.equals(await gridSnapshot()), "Grid sustained blue changes GL pixels");
  await page.keyboard.down("Control");
  await page.mouse.click(gridHit.x, gridHit.y);
  await page.keyboard.up("Control");
  await drain();
  assert(await page.evaluate(() => __highlightPad.classList.contains("held")), "Grid Ctrl click latches gold");
  const gridGold = await gridSnapshot();
  assert(!gridGold.equals(gridBase) && !gridGold.equals(gridBlue), "Grid gold GL pixels differ from idle and blue");
  await page.keyboard.down("Control");
  await page.mouse.click(gridHit.x, gridHit.y);
  await page.keyboard.up("Control");
  await drain();
  assert(!(await page.evaluate(() => __highlightPad.classList.contains("held"))), "Grid second Ctrl click unlatches gold");
  await page.evaluate(() => {
    const midi = Number(__highlightPad.dataset.gridMidi);
    nodeGraphChordMemoryEnsureNode(nodeGraphPatchNode("grid")).slots[String(midi)] = [midi];
    nodeGraphChordMemoryPaintKeys();
  });
  await drain();
  assert(await page.evaluate(() => __highlightPad.classList.contains("chord-memory")), "Grid stored chord paints slot state");
  const gridGreen = await gridSnapshot();
  assert(!gridGreen.equals(gridBase) && !gridGreen.equals(gridBlue) && !gridGreen.equals(gridGold), "Grid chord slot changes GL pixels to green");
  await page.evaluate(() => {
    const node = nodeGraphPatchNode("grid");
    node.traceDisplaySettings = { ...node.traceDisplaySettings, mode: "chordMemory" };
  });
  await page.keyboard.down("Control");
  await page.mouse.click(gridHit.x, gridHit.y);
  await page.keyboard.up("Control");
  await drain();
  assert(await page.evaluate(() => __highlightPad.classList.contains("slot-edit") && __highlightPad.classList.contains("chord-edit-note")), "Grid Ctrl chord slot opens red-note editing");
  const gridRed = await gridSnapshot();
  assert(!gridRed.equals(gridGreen) && !gridRed.equals(gridGold) && !gridRed.equals(gridBlue), "Grid real chord-edit gesture changes GL pixels to red");
  await page.keyboard.down("Control");
  await page.mouse.click(gridHit.x, gridHit.y);
  await page.keyboard.up("Control");
  await drain();
  assert(!(await page.evaluate(() => __highlightPad.classList.contains("slot-edit") || __highlightPad.classList.contains("chord-edit-note"))), "Grid second Ctrl chord gesture clears edit highlights");
  const result = await page.evaluate(() => ({
    counts: nodeGraphGlGraphState.presentCounts,
    transport: nodeGraphLiveTransportUiState(),
    engineUp: Boolean(nodeGraphMvp.live.node),
    contextState: nodeGraphMvp.live.context?.state || "absent",
    gridPads: document.querySelectorAll('.dsp-node[data-node="grid"] .node-grid-keyboard-pad').length,
    gridDomOpacity: getComputedStyle(__highlightPad).opacity,
  }));
  assert.equal(result.transport, "stopped", "transport stays stopped");
  assert.equal(result.engineUp, false, "no DSP engine started");
  assert.notEqual(result.contextState, "running", "no running AudioContext");
  assert.equal(result.gridDomOpacity, "0", "Grid pixel proof cannot come from DOM key paint");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("ok  real stopped pointer plain/Shift/Ctrl and chord-slot state AND GL pixels", JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    await new Promise((resolve) => { server.once("exit", resolve); server.kill(); });
  }
}
