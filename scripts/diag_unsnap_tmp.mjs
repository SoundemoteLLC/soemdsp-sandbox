// GL text is as sharp as HTML text (MAS-3 text-sharp).
// Causes this guards (measured, see the commit message):
//  1. the workspace GL canvas was css-sized, so the browser stretched it by
//     devicePixelRatio (backing store must be css x dpr, shown 1:1);
//  2. one 64..384 px atlas was minified to 13-21 px text through mipmaps
//     (every size must be baked at its on-screen size: zoom x dpr x px);
//  3. glyph quads were rounded to whole *world* px, so at any zoom x dpr that
//     is not an integer they landed on fractional device pixels and were
//     resampled (1:1 runs must snap their corners to device pixels in the
//     vertex shader, and only while the camera matches the recorded scale);
//  4. titles squeezed by maxWidth were resampled (they bake the fitted size).
// Starts its own server.py on a free port; never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const srcLines = fs.readFileSync(path.join(ROOT, "public/lib/visual/gl-line-renderer.js"), "utf8");
const srcGl = fs.readFileSync(path.join(ROOT, "public/node-graph-gl-graph.js"), "utf8");
const DPRS = (process.env.DPRS || "1,1.25,1.5").split(",").map(Number);

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
function tiled(patch, n) {
  if (!n) return patch;
  const single = new Set(["output", "input", "viewOut", "viewIn", "screenOut", "screenBend", "audioPlayer"]);
  const nodes = patch.nodes || [];
  const xs = nodes.map((node) => Number(node.gx) || 0);
  const span = Math.max(...xs) - Math.min(...xs) + 40;
  const out = { ...patch, nodes: [...nodes], connections: [...(patch.connections || [])], modulations: [...(patch.modulations || [])] };
  for (let k = 1; k <= n; k += 1) {
    const ids = new Map();
    for (const node of nodes) {
      if (single.has(String(node.type))) continue;
      const id = `${node.id}~t${k}`;
      ids.set(node.id, id);
      out.nodes.push({ ...JSON.parse(JSON.stringify(node)), id, gx: (Number(node.gx) || 0) + span * k });
    }
    for (const c of patch.connections || []) {
      if (ids.has(c.sourceNode) && ids.has(c.destinationNode)) out.connections.push({ ...c, sourceNode: ids.get(c.sourceNode), destinationNode: ids.get(c.destinationNode) });
    }
    for (const m of patch.modulations || []) {
      if (ids.has(m.sourceNode) && ids.has(m.destinationNode)) out.modulations.push({ ...m, sourceNode: ids.get(m.sourceNode), destinationNode: ids.get(m.destinationNode) });
    }
  }
  return out;
}


const patch = tiled(JSON.parse(fs.readFileSync(patchPath, 'utf8')), Number(process.env.VIEW_TILE || 0));
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
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(process.env.DPR || 1) });
  const page = await context.newPage(); await page.addInitScript((g) => { window.__stackGroupMax = g; }, Number(process.env.GMAX || 8));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.evaluate(async (p) => { commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "diag" }); setNodeGraphZoom(1.5); flushNodeGraphViewportImmediate({ persist: false }); await new Promise((r) => setTimeout(r, 2500)); }, patch);
  const r = await page.evaluate(async () => {
    setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((res) => setTimeout(res, 1500));
    const fb0 = nodeGraphGlLinesTextAtlasStats().fallbacks;
    nodeGraphGlGraphPresent({ resharpenText: true });
    const out = { fallbacks: nodeGraphGlLinesTextAtlasStats().fallbacks - fb0, pending: nodeGraphGlLinesTextAtlasPending(0), unsnapped: [] };
    const walk = (b, path) => { if (!b) return; for (const t of b.texts || []) { if (t.color || !b.tdata) continue; if (!(t.snapScale > 0)) out.unsnapped.push({ path, n: (t.end - t.start) / 48, bake: t.bakePx, text: t.text || t.str || "" }); } (b.layers || []).forEach((l, i) => walk(l, path + "/" + i)); };
    nodeGraphGlGraphState.mesh.batches.forEach((b, i) => walk(b, "b" + i));
    out.unsnapped = out.unsnapped.slice(0, 20);
    return out;
  });  console.log(JSON.stringify(r));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}