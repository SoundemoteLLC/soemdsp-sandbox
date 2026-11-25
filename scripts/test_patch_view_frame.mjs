// viewFrame(rect): a saved Patch View box frames the camera on patch load.
// viewFrame({ x, y, w, h }) fits the world rect into the workspace with a 5%
// margin per side, centres it, clamps the zoom to nodeGraphZoomLimits, and
// applies it through viewCameraSet (one immediate frame, no timers).
// frameNodeGraphPatchViewAfterLoad (node-graph-patch-view.js) calls it after a
// load with resetEditorView. Starts its own server.py on a free port; never
// touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const srcPerf = fs.readFileSync(path.join(ROOT, "public/node-graph-viewport-perf.js"), "utf8");
let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

const fnBody = srcPerf.slice(srcPerf.indexOf("function viewFrameRect"), srcPerf.indexOf("function viewFrame(rect)"));
check(fnBody.length > 0 && !/setTimeout|setInterval/.test(fnBody), "viewFrameRect uses no timers");
check(/viewCameraSet\(\{ immediate: true/.test(fnBody), "viewFrameRect applies through viewCameraSet (immediate)");

const RECT = { x: 260, y: -420, w: 900, h: 420 };
const patch = { ...JSON.parse(fs.readFileSync(patchPath, "utf8")), patchView: RECT };
const { chromium } = await import("playwright");
let server = null;
let browser = null;
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function" && typeof flushNodeGraphViewportImmediate === "function" && typeof scheduleNodeGraphLivePlanSync === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});

  const view = () => {
    const ws = document.getElementById("nodeGraphWorkspace");
    const cam = nodeGraphWireCameraViewBox(ws);
    return { zoom: nodeGraphZoom(), cx: cam.x + cam.width / 2, cy: cam.y + cam.height / 2, vw: cam.width, vh: cam.height, min: nodeGraphZoomLimits.min, max: nodeGraphZoomLimits.max };
  };
  const loaded = await page.evaluate(async ({ p, src }) => {
    const view = new Function(`return (${src})()`);
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_patch_view_frame", resetEditorView: true });
    const at = view();
    await new Promise((r) => setTimeout(r, 1500));
    return { at, later: view(), saved: nodeGraphPatchViewBox(), visible: Boolean(nodeGraphMvp.patchViewVisible) };
  }, { p: patch, src: view.toString() });
  const expectZoom = (v, r) => Math.exp(Math.max(Math.log(v.min), Math.min(Math.log(v.max), Math.log(Math.min((v.vw * v.zoom) / (r.w * 1.1), (v.vh * v.zoom) / (r.h * 1.1))))));
  check(JSON.stringify(loaded.saved) === JSON.stringify(RECT) && loaded.visible, `patchView survives load and shows (${JSON.stringify(loaded.saved)})`);
  for (const [tag, v] of [["on load", loaded.at], ["1.5 s later", loaded.later]]) {
    const z = expectZoom(v, RECT);
    check(Math.abs(v.zoom - z) / z < 0.01, `${tag}: zoom fits the rect with a 5% margin (zoom ${v.zoom.toFixed(4)}, want ${z.toFixed(4)})`);
    check(Math.abs(v.cx - (RECT.x + RECT.w / 2)) < 1 && Math.abs(v.cy - (RECT.y + RECT.h / 2)) < 1, `${tag}: rect centre is the screen centre (view centre ${v.cx.toFixed(2)}, ${v.cy.toFixed(2)}; rect centre ${RECT.x + RECT.w / 2}, ${RECT.y + RECT.h / 2})`);
    check(v.vw >= RECT.w * 1.099 && v.vh >= RECT.h * 1.099 && (Math.abs(v.vw - RECT.w * 1.1) < 1 || Math.abs(v.vh - RECT.h * 1.1) < 1), `${tag}: whole rect visible, tight on one axis (view ${v.vw.toFixed(1)} x ${v.vh.toFixed(1)})`);
  }
  // Direct calls: a tiny rect clamps to the max zoom, a huge one to the min; no argument keeps the frame apply.
  const direct = await page.evaluate(({ src }) => {
    const view = new Function(`return (${src})()`);
    viewFrame({ x: 10, y: 10, w: 0.5, h: 0.5 }); const tiny = view();
    viewFrame({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }); const huge = view();
    let threw = ""; try { viewFrame(); } catch (e) { threw = String(e); }
    return { tiny, huge, threw, after: view() };
  }, { src: view.toString() });
  check(Math.abs(direct.tiny.zoom - direct.tiny.max) < 1e-6 && Math.abs(direct.tiny.cx - 10.25) < 0.5, `tiny rect: zoom clamps to max ${direct.tiny.max} and stays centred (${direct.tiny.zoom}, centre ${direct.tiny.cx.toFixed(2)})`);
  check(Math.abs(direct.huge.zoom - direct.huge.min) < 1e-6, `huge rect: zoom clamps to min ${direct.huge.min} (${direct.huge.zoom})`);
  check(!direct.threw && Math.abs(direct.after.zoom - direct.huge.zoom) < 1e-9, `viewFrame() with no argument keeps the camera (${direct.threw || "no throw"})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log("test_patch_view_frame passed");