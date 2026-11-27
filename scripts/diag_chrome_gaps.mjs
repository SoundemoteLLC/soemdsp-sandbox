
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-guitar-pluck.json");
const WANT = new Set((process.env.VIEW_IDS || "clock-1,combResonator-1,stepGraph-1,pluckEnvelope-1").split(","));
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});

const { chromium } = await import("playwright");
const port = await freePort();
const server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
const baseUrl = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 240; i += 1) {
  try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message || e)));
try {
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  const censusFn = (ids) => {
    const want = ids instanceof Set ? ids : new Set(ids);
    const gl = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState : null;
    const byId = gl?.chrome?.byId;
    const cache = typeof nodeGraphGlGraphChromeCache !== "undefined" ? nodeGraphGlGraphChromeCache : null;
    const lists = (obj) => obj ? {
      titles: obj.titles?.length || obj.lists?.titles?.length || 0,
      labels: obj.labels?.length || obj.lists?.labels?.length || 0,
      jacks: obj.jacks?.length || obj.lists?.jacks?.length || 0,
      sliders: obj.sliders?.length || obj.lists?.sliders?.length || 0,
    } : null;
    const rows = [];
    const nodes = nodeGraphMvp?.patch?.nodes || [];
    for (const node of nodes) {
      const id = String(node.id || "");
      if (want.size && !want.has(id)) continue;
      const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : document.querySelector(`[data-node="${id}"]`);
      const geo = typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(id) : null;
      const laid = el && typeof nodeGraphGlGraphChromeModuleLaidOut === "function" ? nodeGraphGlGraphChromeModuleLaidOut(el) : null;
      const rec = byId instanceof Map ? byId.get(id) : null;
      const cached = cache instanceof Map ? cache.get(id) : null;
      rows.push({
        id,
        type: node.type,
        asleep: Boolean(el?.classList.contains("viewport-asleep") || el?.hidden),
        connected: Boolean(el?.isConnected),
        laidOut: Boolean(laid),
        display: el ? getComputedStyle(el).display : "missing",
        dom: {
          title: Boolean(el?.querySelector(".node-header-title")),
          titleHidden: Boolean(el?.classList.contains("title-hidden")),
          ports: el ? el.querySelectorAll(".node-port, .node-param-port").length : 0,
          sliders: el ? el.querySelectorAll(".node-slider-readout").length : 0,
          face: Boolean(el?.querySelector(".node-face, canvas, .node-step-graph, .node-scope")),
          faceClasses: el ? [...el.querySelectorAll(".node-face, [class*='display'], canvas")].map((n) => n.className).slice(0, 6) : [],
        },
        geo: {
          has: Boolean(geo),
          box: geo?.box ? { w: geo.box.w, h: geo.box.h } : null,
          ports: geo?.ports?.length || 0,
          paramJacks: geo?.paramJacks?.length || 0,
        },
        cache: cached ? { ox: cached.ox, oy: cached.oy, ...lists(cached) } : null,
        byId: rec ? lists(rec) : null,
      });
    }
    return {
      plates: gl?.plates?.length || 0,
      mesh: (gl?.mesh?.plateGroupLayers || []).reduce((n, g) => n + (g.ids || []).length, 0),
      cacheSize: cache?.size || 0,
      chromeById: byId?.size || 0,
      geoSize: typeof nodeGraphModuleGeometryById !== "undefined" ? nodeGraphModuleGeometryById.size : 0,
      rows,
    };
  };

  const dump = async (label) => {
    const data = await page.evaluate(censusFn, [...WANT]);
    console.log("\n==== " + label + " ====");
    console.log(`plates ${data.plates} mesh ${data.mesh} cache ${data.cacheSize} byId ${data.chromeById} geo ${data.geoSize}`);
    for (const row of data.rows) console.log(JSON.stringify(row));
    return data;
  };

  // Immediate after commit, before the 2.5s settle used by the perf test.
  await page.evaluate((p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "diag_chrome_gaps" });
  }, patch);
  await dump("t=0 after commit (sync)");
  await page.waitForTimeout(0);
  await dump("t=microtask");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await dump("t=2raf");
  await page.waitForTimeout(2500);
  await dump("t=2500ms after commit");

  // Same home + invalidate the failing test uses.
  await page.evaluate(() => {
    const zoom = 2;
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(zoom);
    let best = null;
    for (const el of document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)")) {
      const x = Number.parseFloat(el.style.getPropertyValue("--node-x"));
      const y = Number.parseFloat(el.style.getPropertyValue("--node-y"));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!best || x < best.x) best = { x, y };
    }
    if (best && typeof nodeGraphRenderedOriginOffset === "function") {
      const z = nodeGraphZoom();
      const o = nodeGraphRenderedOriginOffset();
      const wantX = 80 - best.x * z;
      const wantY = 80 - best.y * z;
      nodeGraphMvp.pan = { x: nodeGraphMvp.pan.x + (wantX - o.x), y: nodeGraphMvp.pan.y + (wantY - o.y) };
      if (typeof viewCameraSet === "function") viewCameraSet({ immediate: true, persist: false });
    }
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
  });
  await page.waitForTimeout(400);
  await dump("after home zoom=2 (left edge)");
  await page.evaluate(() => {
    if (typeof nodeGraphModuleGeometryInvalidateAll === "function") nodeGraphModuleGeometryInvalidateAll();
    if (typeof drawNodeGraphWires === "function") drawNodeGraphWires();
  });
  await dump("after GeometryInvalidateAll + drawWires");

  // Wake all and rebuild, to see if a full layout fill would populate them.
  await page.evaluate(() => {
    if (typeof nodeGraphViewportCullWakeAll === "function") nodeGraphViewportCullWakeAll();
    if (typeof nodeGraphModuleGeometryPublishVisible === "function") nodeGraphModuleGeometryPublishVisible();
    if (typeof nodeGraphGlGraphRebuildPlates === "function") nodeGraphGlGraphRebuildPlates();
    if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
  });
  await dump("after WakeAll + publish + RebuildPlates");
  const sliderWhy = await page.evaluate((ids) => {
    const out = [];
    for (const id of ids) {
      const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
      if (!el) continue;
      const rows = [];
      el.querySelectorAll(".node-slider-readout").forEach((r, i) => {
        const chain = [];
        let n = r;
        for (let k = 0; k < 8 && n; k += 1) {
          chain.push({
            tag: n.tagName,
            cls: String(n.className || "").slice(0, 80),
            pos: n instanceof Element ? getComputedStyle(n).position : "",
            transform: n instanceof Element ? getComputedStyle(n).transform : "",
            zoom: n instanceof Element ? (n.style && n.style.zoom) || getComputedStyle(n).zoom : "",
            ow: n.offsetWidth,
            oh: n.offsetHeight,
            ol: n.offsetLeft,
            ot: n.offsetTop,
            op: n.offsetParent ? (n.offsetParent.id || n.offsetParent.className || n.offsetParent.tagName).toString().slice(0, 60) : null,
          });
          if (n === el) break;
          n = n.offsetParent;
        }
        const box = typeof nodeGraphGlGraphWorldBox === "function" ? nodeGraphGlGraphWorldBox(r) : null;
        const laid = typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(r, el) : null;
        const cs = getComputedStyle(r);
        rows.push({
          i,
          display: cs.display,
          visibility: cs.visibility,
          ow: r.offsetWidth,
          oh: r.offsetHeight,
          box,
          laid,
          inSeed: Boolean(r.closest(".node-seed-control, .node-parameter-row-seed")),
          parent: String(r.parentElement?.className || "").slice(0, 80),
          chain,
        });
      });
      out.push({ id, count: rows.length, rows: rows.slice(0, 3) });
    }
    return out;
  }, [...WANT]);
  console.log("\n==== slider WorldBox after WakeAll ====");
  console.log(JSON.stringify(sliderWhy, null, 2));

} finally {
  await browser.close().catch(() => {});
  server.kill();
}
