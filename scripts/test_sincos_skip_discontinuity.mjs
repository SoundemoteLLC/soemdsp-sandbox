// HP-22: sincos Skip Discontinuity, using Argi's repro (Amplitude above 25 makes the face jump between neighbouring samples).
// Off (the default) draws the connecting wall: one unbroken Sin line. On breaks the line at each jump: several runs, and no run has
// a step taller than a quarter of the plot. Display only. Real page on its own server.py port (never 8765 / 8766 / 8080) unless
// SANDBOX_URL is set.
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const id = showNodeGraphModule("sinCos", { x: 200, y: 200 }, { record: false, autosaveWorkingPatch: false });
    for (let i = 0; i < 50 && !document.querySelector(`section.node-sincos-display[data-node="${id}"]`); i += 1) await wait(50);
    const node = nodeGraphPatchNode(id);
    const face = document.querySelector(`section.node-sincos-display[data-node="${id}"]`);
    // Argi's case: Amplitude 30 (a widened Parameter Settings range), Sin wired.
    const liveParam = window.nodeGraphSinCosLiveParam;
    const hasWire = window.nodeGraphSinCosOutputHasWire;
    const present = window.nodeGraphGlLinesPresentFrame;
    window.nodeGraphSinCosLiveParam = (n, key, fallback) => (n?.id === id && key === "amp" ? 30 : liveParam(n, key, fallback));
    window.nodeGraphSinCosOutputHasWire = (nid, port) => (nid === id ? port === "sin" : hasWire(nid, port));
    let frame = null;
    window.nodeGraphGlLinesPresentFrame = (canvas, f) => { frame = f; return present(canvas, f); };
    const measure = (skip) => {
      node.traceDisplaySettings = { ...(node.traceDisplaySettings || {}), skipDiscontinuities: skip };
      frame = null;
      face._sinCosForceDraw = true;
      drawNodeGraphSinCosDisplayInner(face);
      const lines = frame?.polylines || [];
      // The jump left out between one run's last point and the next run's first point.
      let minGap = Infinity;
      for (let k = 1; k < lines.length; k += 1) {
        const a = lines[k - 1].points;
        const b = lines[k].points;
        minGap = Math.min(minGap, Math.abs(b[1] - a[a.length - 1]));
      }
      return { runs: lines.length, minGap: Number.isFinite(minGap) ? minGap : 0, h: frame?.cssHeight || 0 };
    };
    const defaultOff = normalizeNodeGraphSinCosFaceSettings({}).skipDiscontinuities === false;
    const off = measure(false);
    const on = measure(true);
    window.nodeGraphSinCosLiveParam = liveParam;
    window.nodeGraphSinCosOutputHasWire = hasWire;
    window.nodeGraphGlLinesPresentFrame = present;
    return { defaultOff, off, on, hadFace: Boolean(face) };
  });
  assert.ok(r.hadFace, `sincos face found ${JSON.stringify(r)}`);
  assert.ok(r.defaultOff, "Skip Discontinuity is off by default");
  assert.equal(r.off.runs, 1, `off: one unbroken line (the wall is drawn) ${JSON.stringify(r)}`);
  assert.ok(r.on.runs > 1, `on: the line breaks at the jumps ${JSON.stringify(r)}`);
  assert.ok(r.on.minGap > r.on.h * 0.25, `on: each break leaves out a jump taller than a quarter of the face ${JSON.stringify(r)}`);
  assert.deepEqual(errors, [], "no page errors");
  console.log(`test_sincos_skip_discontinuity: ok (Amplitude 30: off = ${r.off.runs} unbroken line, on = ${r.on.runs} runs, smallest left-out jump ${Math.round(r.on.minGap)} px of ${r.on.h})`);
} finally {
  await browser?.close();
  server?.kill();
}
