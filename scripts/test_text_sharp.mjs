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

check(srcLines.includes("uniform float uSnap;") && srcLines.includes("dev = floor(dev + 0.5)"), "vertex shader snaps 1:1 glyph corners to device pixels");
check(srcLines.includes("nodeGraphGlLinesTextAtlasSweep"), "camera atlases are per size and swept");
check(/function nodeGraphGlGraphDeviceScale/.test(srcGl) && /canvas\.style\.width = sw/.test(srcGl), "workspace canvas is device-pixel sized and shown 1:1");
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
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
  for (const dpr of DPRS) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
    await page.addInitScript(() => {
      // Spy on the glyph snap uniform: names per location, values per draw.
      window.__snapVals = [];
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        const gul = C.prototype.getUniformLocation;
        C.prototype.getUniformLocation = function (p, n) { const l = gul.call(this, p, n); if (l) l.__n = n; return l; };
        const u1 = C.prototype.uniform1f;
        C.prototype.uniform1f = function (l, v) { if (l && l.__n === "uSnap") window.__snapVals.push(v); return u1.call(this, l, v); };
      }
    });
    await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const startBtn = page.locator("#nodeBootStartButton");
    if (await startBtn.count()) await startBtn.click().catch(() => {});
    await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
    await page.waitForFunction(() => {
      const b = document.querySelector(".node-boot-loading-screen");
      return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
    }, null, { timeout: 180000 }).catch(() => {});
    await page.evaluate(async (p) => {
      commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_text_sharp" });
      setNodeGraphZoom(1);
      flushNodeGraphViewportImmediate({ persist: false });
      await new Promise((r) => setTimeout(r, 2000));
    }, patch);

    for (const zoom of [1, 1.5, 2]) {
      const tag = `dpr ${dpr} zoom ${zoom}`;
      const r = await page.evaluate(async (zoom) => {
        setNodeGraphZoom(zoom);
        await new Promise((res) => setTimeout(res, 700));
        // Record every text call of one full present, then inspect the mesh it built.
        const wanted = new Set();
        const orig = window.nodeGraphGlLinesText;
        window.nodeGraphGlLinesText = function (batch, text, x, y, o = {}) { if (batch?.camera) wanted.add(+(+o.px).toFixed(3)); return orig.apply(this, arguments); };
        nodeGraphGlGraphPresent({ resharpenText: true });
        window.nodeGraphGlLinesText = orig;
        const cv = nodeGraphGlGraphState.canvas;
        const rect = cv.getBoundingClientRect();
        const host = document.getElementById("nodeGraphWorkspace");
        const dev = Math.min(2, Math.max(1, devicePixelRatio));
        const cam = nodeGraphGlGraphState.frameCamera;
        const scale = cam.zoom * (cv.width / rect.width);
        const runs = []; let glyphs = 0; let snapGlyphs = 0; let nonIntQuads = 0; let quads = 0;
        const walk = (b) => {
          if (!b) return;
          for (const t of b.texts || []) {
            if (t.color || !b.tdata) continue;
            const n = (t.end - t.start) / 48; glyphs += n;
            if (t.snapScale > 0) {
              snapGlyphs += n;
              runs.push({ snap: t.snapScale, bake: t.bakePx, n });
              for (let j = t.start; j + 17 < t.end; j += 48) {
                quads += 1;
                const w = (b.tdata[j + 8] - b.tdata[j]) * t.snapScale; const h = (b.tdata[j + 17] - b.tdata[j + 1]) * t.snapScale;
                if (Math.abs(w - Math.round(w)) > 0.03 || Math.abs(h - Math.round(h)) > 0.03) nonIntQuads += 1;
              }
            }
          }
          for (const l of b.layers || []) walk(l);
        };
        for (const b of nodeGraphGlGraphState.mesh.batches) walk(b);
        // Settled replay snaps; a replay at a different (mid-zoom) scale must not.
        window.__snapVals.length = 0;
        nodeGraphGlGraphReplayMesh("all");
        const settledSnaps = window.__snapVals.filter((v) => v === 1).length;
        const savedZoom = nodeGraphZoom();
        setNodeGraphZoom(savedZoom * 1.1);
        window.__snapVals.length = 0;
        nodeGraphGlGraphReplayMesh("all");
        const midSnaps = window.__snapVals.filter((v) => v === 1).length;
        setNodeGraphZoom(savedZoom);
        await new Promise((res) => setTimeout(res, 700));
        return {
          dev, bw: cv.width, bh: cv.height, rectW: rect.width, rectH: rect.height, hostW: host.clientWidth, hostH: host.clientHeight,
          recordScale: nodeGraphGlGraphState.textRecordScale, scale, wanted: [...wanted], runs, glyphs, snapGlyphs, nonIntQuads, quads, settledSnaps, midSnaps,
        };
      }, zoom);
      check(r.bw === Math.ceil(r.hostW * r.dev - 1e-6) && r.bh === Math.ceil(r.hostH * r.dev - 1e-6), `${tag}: backing store is css x dpr (${r.bw}x${r.bh} for ${r.hostW}x${r.hostH} at ${r.dev}x)`);
      check(Math.abs(r.rectW * r.dev - r.bw) < 0.25 && Math.abs(r.rectH * r.dev - r.bh) < 0.25, `${tag}: canvas is shown 1:1, not resampled (<0.25 device px off; ${(r.rectW * r.dev).toFixed(2)}x${(r.rectH * r.dev).toFixed(2)} device px for ${r.bw}x${r.bh} texels)`);
      const want = zoom * r.dev;
      check(r.runs.length > 0 && r.runs.every((u) => Math.abs(u.snap - want) < 1e-6 * want), `${tag}: recorded text scale == dpr x zoom (${want}; runs ${r.runs.length})`);
      // Atlas scale: every snapped run's atlas is a requested size x dpr x zoom, or a fitted-down (half px steps) size of one.
      const exact = (b) => r.wanted.some((px) => Math.abs(px * want - b) < 0.02);
      const fitted = (b) => r.wanted.some((px) => b <= px * want + 0.02);
      check(r.runs.every((u) => u.bake >= 8 && fitted(u.bake)), `${tag}: every atlas is at most the on-screen size (bakes ${[...new Set(r.runs.map((u) => u.bake))].join(", ")})`);
      const exactGlyphs = r.runs.filter((u) => exact(u.bake)).reduce((a, u) => a + u.n, 0);
      check(exactGlyphs / Math.max(1, r.glyphs) >= 0.6, `${tag}: atlas scale == dpr x zoom x px for most text (${(100 * exactGlyphs / Math.max(1, r.glyphs)).toFixed(0)}% exact, ${(100 * r.snapGlyphs / Math.max(1, r.glyphs)).toFixed(0)}% 1:1)`);
      check(r.snapGlyphs / Math.max(1, r.glyphs) >= 0.95, `${tag}: glyph runs are pixel-snapped 1:1 (${r.snapGlyphs}/${r.glyphs} glyphs)`);
      check(r.nonIntQuads === 0 && r.quads > 0, `${tag}: snapped glyph quads span whole device pixels (${r.nonIntQuads}/${r.quads} fractional)`);
      check(r.settledSnaps >= 1, `${tag}: a settled replay turns the vertex snap on (${r.settledSnaps} draws)`);
      check(r.midSnaps === 0, `${tag}: a replay at another scale does not snap (${r.midSnaps} draws)`);
    }

    // Pixel parity with HTML text: same string, font and on-screen size, GL (own batch) vs a span.
    await page.evaluate(() => { document.body.innerHTML = '<div id="host" style="position:fixed;left:0;top:0;background:#202050;width:900px;height:700px;z-index:99999"></div>'; document.body.style.background = "#202050"; });
    const ref = await context.newPage();
    for (const zoom of [1.5, 2]) {
      const layout = await page.evaluate(async ({ zoom, sizes }) => {
        const bg = [0x20 / 255, 0x20 / 255, 0x50 / 255, 1];
        const fam = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
        const host = document.getElementById("host"); host.innerHTML = "";
        const d = devicePixelRatio; const text = "Comb Resonator Frequency 0.00 Hz";
        await document.fonts.ready;
        let top = 4; const rows = [];
        for (const css of sizes) {
          const hCss = Math.ceil(css * zoom * 1.5);
          const box = document.createElement("div"); box.style.cssText = `position:absolute;left:8px;top:${top}px;will-change:transform;`;
          const sp = document.createElement("span"); sp.textContent = text; sp.style.cssText = `font:400 ${css * zoom}px ${fam};color:#fff;line-height:1;white-space:pre`;
          box.appendChild(sp); host.appendChild(box);
          rows.push({ kind: "html", css, top, hCss }); top += hCss + 6;
          const cv = document.createElement("canvas"); cv.width = Math.round(880 * d); cv.height = Math.round(hCss * d);
          cv.style.cssText = `position:absolute;left:8px;top:${top}px;width:${cv.width / d}px;height:${cv.height / d}px`;
          host.appendChild(cv);
          const batch = nodeGraphGlLinesBegin(cv, bg, { scale: d, camera: { x: 0, y: 0, zoom }, keepMesh: false });
          nodeGraphGlLinesText(batch, text, 0, hCss / zoom / 2, { px: css, rgba: [1, 1, 1, 1], align: "left", baseline: "middle", weight: 400 });
          nodeGraphGlLinesEnd(batch, "alpha");
          rows.push({ kind: "gl", css, top, hCss }); top += hCss + 6;
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { rows, dpr: d };
      }, { zoom, sizes: [13, 21.08] });
      const shot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 900, height: 700 } });
      const m = await ref.evaluate(async ({ b64, layout }) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = layout.dpr; const out = {};
        for (const r of layout.rows) {
          const y0 = Math.round(r.top * d); const h = Math.round(r.hCss * d); const w = Math.round(880 * d);
          const px = g.getImageData(0, y0, w, h).data;
          const cov = new Float32Array(w * h);
          for (let i = 0; i < w * h; i += 1) cov[i] = (px[i * 4] - 0x20) / (255 - 0x20);
          let ink = 0; let mid = 0; let en = 0;
          for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
            const v = cov[y * w + x]; ink += Math.max(0, v); if (v > 0.1 && v < 0.9) mid += 1;
            if (x + 1 < w) { const dd = cov[y * w + x + 1] - v; en += dd * dd; }
          }
          (out[r.css] || (out[r.css] = {}))[r.kind] = { ink, mid, edge: en / Math.max(1e-6, ink) };
        }
        return out;
      }, { b64: shot.toString("base64"), layout });
      for (const [css, v] of Object.entries(m)) {
        const inkR = v.gl.ink / v.html.ink; const midR = v.gl.mid / Math.max(1, v.html.mid); const edgeR = v.gl.edge / v.html.edge;
        const tag = `dpr ${dpr} zoom ${zoom} ${css}px vs HTML`;
        check(inkR > 0.93 && inkR < 1.07, `${tag}: same ink (x${inkR.toFixed(3)}, no gamma / weight shift)`);
        check(edgeR > 0.82, `${tag}: edges as sharp (edge energy x${edgeR.toFixed(2)})`);
        check(midR < 1.6, `${tag}: no extra soft pixels (x${midR.toFixed(2)})`);
      }
    }
    check(pageErrors.length === 0, `dpr ${dpr}: no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
    await context.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

if (bad) {
  console.error(`${bad} check(s) failed`);
  process.exit(1);
}
console.log("test_text_sharp passed");
