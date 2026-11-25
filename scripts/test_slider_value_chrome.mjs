// Slider value-chrome test (Stage 2/4 mesh replay).
// Asserts that a param change moves the drawn GL slider fill on the next
// frame as an incremental plate repaint, not a full mesh rebuild, and
// without polling. Covers a real pointer drag (per-frame fill change) and
// a programmatic set. Starts its own server.py on a free port; never
// touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-guitar-pluck.json");
const W = Number(process.env.VIEW_W || 1600);
const H = Number(process.env.VIEW_H || 1000);
const headed = process.env.VIEW_HEADED === "1";

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

const { chromium } = await import("playwright");
let server = null;
let browser = null;
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  browser = await chromium.launch({ headless: !headed, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});

  const loaded = await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_slider_value_chrome" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(0.7);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    const pin = () => {
      let best = null;
      for (const el of document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)")) {
        const x = Number.parseFloat(el.style.getPropertyValue("--node-x"));
        const y = Number.parseFloat(el.style.getPropertyValue("--node-y"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!best || x < best.x || (x === best.x && y < best.y)) best = { x, y };
      }
      if (!best || typeof nodeGraphRenderedOriginOffset !== "function") return;
      const z = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
      const o = nodeGraphRenderedOriginOffset();
      const wantX = 120 - best.x * z;
      const wantY = 80 - best.y * z;
      if (nodeGraphMvp?.pan) {
        nodeGraphMvp.pan = {
          x: nodeGraphMvp.pan.x + (wantX - o.x),
          y: nodeGraphMvp.pan.y + (wantY - o.y),
        };
      }
      if (typeof viewCameraSet === "function") viewCameraSet({ immediate: true, persist: false });
      else if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    };
    pin();
    await new Promise((r) => setTimeout(r, 1500));
    pin();
    return document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)").length;
  }, patch);
  console.log(`loaded ${loaded} modules from ${path.relative(ROOT, patchPath)}`);

  await page.waitForFunction(() => Boolean(nodeGraphGlGraphState?.mesh?.batches?.[0] && (nodeGraphGlGraphState.chrome?.sliders || []).length), null, { timeout: 30000 });

  const pick = await page.evaluate(() => {
    const host = document.getElementById("nodeGraphWorkspace");
    const hr = host.getBoundingClientRect();
    const toClient = (wx, wy) => {
      const surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null;
      const scale = typeof nodeGraphZoomSurfaceClientScale === "function" && surface
        ? nodeGraphZoomSurfaceClientScale(surface)
        : { x: (typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1), y: (typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1) };
      const r = surface?.getBoundingClientRect?.() || hr;
      const origin = typeof nodeGraphRenderedOriginOffset === "function"
        ? nodeGraphRenderedOriginOffset(nodeGraphMvp?.pan || { x: 0, y: 0 }, host)
        : (nodeGraphMvp?.pan || { x: 0, y: 0 });
      return {
        x: r.left + (Number(origin?.x) || 0) + Number(wx) * scale.x,
        y: r.top + (Number(origin?.y) || 0) + Number(wy) * scale.y,
      };
    };
    const sliders = nodeGraphGlGraphState.chrome?.sliders || [];
    const cands = [];
    const debug = { total: sliders.length, noInput: 0, small: 0, offscreen: 0, vertical: 0, horizontal: 0 };
    for (const s of sliders) {
      if (!s.input) { debug.noInput += 1; continue; }
      if (!(s.w > 4) || !(s.h > 4)) { debug.small += 1; continue; }
      const mid = toClient(s.x + s.w * 0.5, s.y + s.h * 0.5);
      if (mid.x < hr.left + 8 || mid.x > hr.right - 8 || mid.y < hr.top + 8 || mid.y > hr.bottom - 8) { debug.offscreen += 1; continue; }
      if (s.vertical) debug.vertical += 1;
      else debug.horizontal += 1;
      const domain = Number(s.input.dataset?.domainValue);
      const value = Number.isFinite(domain) ? domain : Number(s.input.value);
      const min = Number(s.input.min);
      const max = Number(s.input.max);
      const travel = typeof nodeGraphGlGraphSliderTravel === "function"
        ? nodeGraphGlGraphSliderTravel(s.input, value)
        : NaN;
      cands.push({
        id: String(s.id || ""),
        param: String(s.input.dataset?.param || s.input.name || ""),
        inputId: s.input.id || "",
        vertical: Boolean(s.vertical),
        travel,
        value,
        min,
        max,
        mid,
        top: toClient(s.x + s.w * 0.5, s.y + s.h * 0.12),
        bottom: toClient(s.x + s.w * 0.5, s.y + s.h * 0.88),
        left: toClient(s.x + s.w * 0.12, s.y + s.h * 0.5),
        right: toClient(s.x + s.w * 0.88, s.y + s.h * 0.5),
      });
    }
    const scored = (s) => {
      const midBias = Number.isFinite(s.travel) ? Math.abs(s.travel - 0.5) : 9;
      return (s.vertical ? 0 : 10) + midBias;
    };
    cands.sort((a, b) => scored(a) - scored(b));
    return { host: { x: hr.left, y: hr.top, w: hr.width, h: hr.height }, slider: cands[0] || null, n: cands.length, debug };
  });
  console.log("pick", JSON.stringify(pick.slider), "of", pick.n, "debug", JSON.stringify(pick.debug));
  check(Boolean(pick.slider?.id && pick.slider?.param), `found an in-view slider (${pick.n} candidates)`);
  if (!pick.slider) throw new Error("no in-view slider to test");

  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // --- programmatic set ---
  const prog = await page.evaluate((info) => {
    const counts0 = { ...(nodeGraphGlGraphState.presentCounts || {}) };
    const before = typeof nodeGraphGlGraphSliderTravelSnapshot === "function"
      ? nodeGraphGlGraphSliderTravelSnapshot(info.id, info.param)
      : [];
    const input = info.inputId ? document.getElementById(info.inputId) : null;
    if (!input || typeof setNodeSliderValue !== "function") {
      return { ok: false, reason: "no input or setNodeSliderValue" };
    }
    const mid = (Number(info.min) + Number(info.max)) / 2;
    const target = Number(info.value) < mid ? Number(info.max) : Number(info.min);
    setNodeSliderValue(input, target, { record: false, status: "test_slider_value_chrome" });
    return { ok: true, counts0, before, target, value: Number(input.dataset?.domainValue ?? input.value) };
  }, pick.slider);
  check(prog.ok, `programmatic set armed (${prog.reason || "ok"})`);
  await frames();
  await frames();
  const afterProg = await page.evaluate((info) => {
    const recs = typeof nodeGraphGlGraphSliderTravelSnapshot === "function"
      ? nodeGraphGlGraphSliderTravelSnapshot(info.id, info.param)
      : [];
    return {
      recs,
      lastPresent: nodeGraphGlGraphState.lastPresent || null,
      counts: { ...(nodeGraphGlGraphState.presentCounts || {}) },
      lastRepaint: nodeGraphGlGraphState.lastValueChromeRepaint || null,
    };
  }, pick.slider);
  const travel0 = prog.before?.find?.((r) => r.param === pick.slider.param)?.travel;
  const travel1 = afterProg.recs?.find?.((r) => r.param === pick.slider.param)?.travel;
  const full0 = Number(prog.counts0?.full || 0);
  const full1 = Number(afterProg.counts?.full || 0);
  const repaint0 = Number(prog.counts0?.valueChromeRepaint || 0);
  const repaint1 = Number(afterProg.counts?.valueChromeRepaint || 0);
  check(Number.isFinite(travel1) && travel1 !== travel0, `programmatic set changed drawn fill travel (${travel0} -> ${travel1})`);
  check(afterProg.lastPresent?.path === "replay", `programmatic set used mesh replay, not a full rebuild (path=${afterProg.lastPresent?.path})`);
  check(full1 === full0, `programmatic set did not bump full presents (${full0} -> ${full1})`);
  check(repaint1 > repaint0, `programmatic set incrementally repainted plates (${repaint0} -> ${repaint1})`);

  // --- pointer drag: fill must change across frames ---
  // Direction follows the travel after the programmatic set, so we do not
  // drag further into an already-clamped end.
  const curTravel = Number.isFinite(travel1) ? travel1 : pick.slider.travel;
  const dragFrom = pick.slider.vertical
    ? (curTravel >= 0.5 ? pick.slider.top : pick.slider.bottom)
    : (curTravel >= 0.5 ? pick.slider.right : pick.slider.left);
  const dragTo = pick.slider.vertical
    ? (curTravel >= 0.5 ? pick.slider.bottom : pick.slider.top)
    : (curTravel >= 0.5 ? pick.slider.left : pick.slider.right);
  await page.evaluate((info) => {
    window.__sliderOn = true;
    window.__sliderLog = [];
    const tick = () => {
      if (!window.__sliderOn) return;
      const recs = typeof nodeGraphGlGraphSliderTravelSnapshot === "function"
        ? nodeGraphGlGraphSliderTravelSnapshot(info.id, info.param)
        : [];
      const rec = recs[0] || null;
      window.__sliderLog.push({
        t: performance.now(),
        travel: rec?.travel,
        valueText: rec?.valueText || "",
        path: nodeGraphGlGraphState.lastPresent?.path || "",
        full: nodeGraphGlGraphState.presentCounts?.full || 0,
        repaint: nodeGraphGlGraphState.presentCounts?.valueChromeRepaint || 0,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, pick.slider);

  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(
      dragFrom.x + (dragTo.x - dragFrom.x) * t,
      dragFrom.y + (dragTo.y - dragFrom.y) * t,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await frames();
  const dragLog = await page.evaluate(() => {
    window.__sliderOn = false;
    return window.__sliderLog || [];
  });
  const moving = dragLog.filter((f) => Number.isFinite(f.travel));
  const distinct = [...new Set(moving.map((f) => Number(f.travel.toFixed(4))))];
  const fullDuring = moving.length ? (moving[moving.length - 1].full - moving[0].full) : 0;
  const repaintDuring = moving.length ? (moving[moving.length - 1].repaint - moving[0].repaint) : 0;
  console.log(`drag frames=${moving.length} distinctTravels=${distinct.length} fullDelta=${fullDuring} repaintDelta=${repaintDuring} sample=${JSON.stringify(distinct.slice(0, 8))}`);
  check(moving.length >= 8, `drag logged per-frame travels (${moving.length} frames)`);
  check(distinct.length >= 5, `drawn fill travel changed across drag frames (${distinct.length} distinct values)`);
  check(repaintDuring >= 3, `drag incrementally repainted plates each move (${repaintDuring})`);
  // A pointerdown on the row may raise the module (liveKey change) and cause
  // one full present at gesture start, and pointerup another. Mid-drag fill
  // updates must still be incremental plate repaints.
  check(fullDuring <= 2, `drag did not full-rebuild the mesh on every move (fullDelta=${fullDuring})`);
  check(repaintDuring > fullDuring, `most drag presents were incremental repaints, not full rebuilds (${repaintDuring} vs ${fullDuring} full)`);

  if (pageErrors.length) {
    console.log("page errors", pageErrors.slice(0, 8));
    check(false, `no page errors (${pageErrors.length})`);
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

if (bad) {
  console.log(`FAIL ${bad} check(s)`);
  process.exit(1);
}
console.log("ok   test_slider_value_chrome");
