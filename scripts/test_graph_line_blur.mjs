// Step Graph / Smooth Graph "Line blur": the shared display Expo skirt option.
// The graph face reads Display Settings > Line blur (lineSmoothing, CSS px, 0..8,
// default 1) through the same nodeGraphLineSmoothingPx every other module face
// uses; the face's plate inset (nodeGraphGraphFacePadPx) grows with it, so the
// widest skirt is never cut at the plate edge (no fake clipping).
// Checks, on both modules: the field exists (labelled "Line blur", no title
// tooltips), the default is the old fixed 1 px, a typed value is saved on the node
// and reaches the GL stroke as its feather, the stroke + skirt stay inside the face
// at 8 px, and the value survives a patch clone.
//   node scripts/test_graph_line_blur.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
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
  const page = await (await browser.newContext({ viewport: { width: 2000, height: 1300 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function" && typeof drawNodeGraphGraphFace === "function" && typeof flushNodeGraphViewportImmediate === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const mk = (type, id, gx) => {
      const n = createNodeGraphPatchNode(type, { id, gx, gy: 3 });
      n.graph = { ...(n.graph || {}), nodes: [{ x: 0, y: -1, c: 0, shape: "hold" }, { x: 0.4, y: 0.2, c: 0, shape: "hold" }, { x: 1, y: 1, c: 0, shape: "hold" }] };
      return n;
    };
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes: [mk("stepGraph", "st", 2), mk("smoothGraph", "sm", 22)], cables: [] }, { status: "line blur test" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    await new Promise((r) => setTimeout(r, 900));
  });

  for (const [id, label] of [["st", "Step Graph"], ["sm", "Smooth Graph"]]) {
    const r = await page.evaluate(async (id) => {
      const out = {};
      if (typeof closeNodeGraphTraceDisplaySettings === "function") closeNodeGraphTraceDisplaySettings();
      setNodeGraphNodeSelection([id]);
      openNodeGraphTraceDisplaySettings(id, { clientX: 1500, clientY: 200 });
      await new Promise((res) => setTimeout(res, 400));
      const pop = document.getElementById("nodeTraceDisplaySettingsPopover");
      const input = pop.querySelector("#nodeTraceDisplayLineSmoothing");
      out.field = Boolean(input);
      out.label = input ? (input.closest("label, .node-trace-display-row, div")?.textContent || "").replace(/\s+/g, " ").trim() : "";
      out.titles = pop.querySelectorAll("[title]").length;
      out.defaultValue = input ? input.value : null;
      out.savedDefault = nodeGraphGraphFaceDisplaySettingsForNode(nodeGraphPatchNode(id)).lineSmoothing;
      // Capture every stroke the face draws.
      const calls = [];
      const orig = window.nodeGraphGlLinesPolyline;
      window.nodeGraphGlLinesPolyline = function (batch, pts, half, feather, ...rest) {
        calls.push({ half, feather, w: batch.w / (batch.scale || 1), h: batch.h / (batch.scale || 1), xs: [Math.min(...pts.filter((_, i) => i % 2 === 0)), Math.max(...pts.filter((_, i) => i % 2 === 0))], ys: [Math.min(...pts.filter((_, i) => i % 2 === 1)), Math.max(...pts.filter((_, i) => i % 2 === 1))] });
        return orig.call(this, batch, pts, half, feather, ...rest);
      };
      const set = async (value) => {
        input.focus();
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
        await new Promise((res) => setTimeout(res, 500));
      };
      calls.length = 0;
      await set(8);
      out.saved8 = nodeGraphPatchNode(id).traceDisplaySettings?.lineSmoothing;
      const display = document.querySelector(`.dsp-node[data-node="${id}"] .node-module-graph-display`);
      display._graphFaceForceDraw = true;
      drawNodeGraphGraphFace(display);
      out.feathers8 = [...new Set(calls.map((c) => c.feather))];
      // The curve stroke (widest) + skirt stays inside the face.
      const curve = calls.filter((c) => c.half > 0.5).sort((a, b) => (b.xs[1] - b.xs[0]) - (a.xs[1] - a.xs[0]))[0];
      out.inside8 = curve ? [curve.xs[0] - curve.half - curve.feather, curve.w - (curve.xs[1] + curve.half + curve.feather), curve.ys[0] - curve.half - curve.feather, curve.h - (curve.ys[1] + curve.half + curve.feather)] : null;
      calls.length = 0;
      await set(0);
      display._graphFaceForceDraw = true;
      drawNodeGraphGraphFace(display);
      out.feathers0 = [...new Set(calls.map((c) => c.feather))];
      out.saved0 = nodeGraphPatchNode(id).traceDisplaySettings?.lineSmoothing;
      await set(3.5);
      out.saved35 = nodeGraphPatchNode(id).traceDisplaySettings?.lineSmoothing;
      out.json = JSON.parse(JSON.stringify(nodeGraphPatchNode(id).traceDisplaySettings)).lineSmoothing;
      window.nodeGraphGlLinesPolyline = orig;
      return out;
    }, id);
    check(r.field, `${label}: Display Settings has a Line blur field`);
    check(/^Line blur/.test(r.label), `${label}: the field is labelled "Line blur" (${r.label.slice(0, 30)})`);
    check(r.titles === 0, `${label}: no title tooltips in the settings popover (${r.titles})`);
    check(r.defaultValue === "1" && r.savedDefault === 1, `${label}: default stays 1 px (field ${r.defaultValue}, saved ${r.savedDefault})`);
    check(r.saved8 === 8, `${label}: a typed 8 is saved on the node (${r.saved8})`);
    check(r.feathers8.length === 1 && r.feathers8[0] === 8, `${label}: the GL strokes use feather 8 (${JSON.stringify(r.feathers8)})`);
    check(r.inside8 && r.inside8.every((v) => v >= -0.01), `${label}: stroke + 8 px skirt stay inside the face (margins ${JSON.stringify(r.inside8)})`);
    check(r.saved0 === 0 && r.feathers0.length === 1 && r.feathers0[0] === 0, `${label}: 0 = hard core (saved ${r.saved0}, feathers ${JSON.stringify(r.feathers0)})`);
    check(r.saved35 === 3.5 && r.json === 3.5, `${label}: the value round-trips through JSON (${r.json})`);
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log("test_graph_line_blur passed");