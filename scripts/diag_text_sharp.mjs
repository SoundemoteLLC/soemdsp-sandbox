// Diagnostic: GL text vs HTML text sharpness (MAS-3 text-sharp). Not a test.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patch = JSON.parse(fs.readFileSync(path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json"), "utf8"));
const OUT = process.env.OUT_DIR || path.join(process.env.TEMP || "/tmp", "textsharp-out");
fs.mkdirSync(OUT, { recursive: true });
const DPRS = (process.env.DPRS || "1,1.25,1.5").split(",").map(Number);
const ZOOMS = (process.env.ZOOMS || "1,1.5,2").split(",").map(Number);
const TAG = process.env.TAG || "before";
let WANT = process.env.LABEL || "";
const HTML_AA = process.env.HTML_AA || "gray";

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.unref(); s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});
const { chromium } = await import("playwright");
let server = null; let browser = null;
const results = [];
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error("reserved port");
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const dpr of DPRS) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const startBtn = page.locator("#nodeBootStartButton");
    if (await startBtn.count()) await startBtn.click().catch(() => {});
    await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
    await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
    await page.evaluate(async (p) => {
      commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "text_sharp" });
      setNodeGraphZoom(1);
      flushNodeGraphViewportImmediate({ persist: false });
      await new Promise((r) => setTimeout(r, 2000));
    }, patch);
    const ref = await context.newPage();
    for (const zoom of ZOOMS) {
      const rec = await page.evaluate(async ({ zoom, want }) => {
        setNodeGraphZoom(zoom);
        await new Promise((r) => setTimeout(r, 700));
        const recordCalls = () => {
          const calls = [];
          const orig = window.nodeGraphGlLinesText;
          window.nodeGraphGlLinesText = function (batch, text, x, y, o = {}) {
            if (batch?.camera) calls.push({ text: String(text), x, y, px: o.px, rgba: o.rgba, align: o.align, base: o.baseline, weight: o.weight || 600, family: o.family || null, maxWidth: o.maxWidth || 0 });
            return orig.apply(this, arguments);
          };
          nodeGraphGlGraphPresent({ resharpenText: true });
          window.nodeGraphGlLinesText = orig;
          return calls;
        };
        if (want) {
          let calls0 = recordCalls();
          const cam0 = nodeGraphGlGraphState.frameCamera; const r0 = nodeGraphGlGraphState.canvas.getBoundingClientRect();
          const hit = calls0.find((c) => c.text === want);
          if (hit) {
            const sx = r0.left + (hit.x - cam0.x) * cam0.zoom; const sy = r0.top + (hit.y - cam0.y) * cam0.zoom;
            nodeGraphMvp.pan = { x: nodeGraphMvp.pan.x + (800 - sx), y: nodeGraphMvp.pan.y + (500 - sy) };
            applyNodeGraphViewportCssLight({ zoom: true, pan: true, readouts: false });
            await new Promise((r) => setTimeout(r, 700));
          }
        }
        const calls = recordCalls();
        const cam = nodeGraphGlGraphState.frameCamera;
        const cv = nodeGraphGlGraphState.canvas;
        const r = cv.getBoundingClientRect();
        const atlas = nodeGraphGlLinesTextAtlas(undefined, 600, "");
        const atlas4 = nodeGraphGlLinesTextAtlas(undefined, 400, "");
        const pick = calls.map((c) => {
          const cx = r.left + (c.x - cam.x) * cam.zoom; const cy = r.top + (c.y - cam.y) * cam.zoom;
          return { ...c, cx, cy, wScreen: nodeGraphGlLinesMeasureText(c.text, c.px, c.family || undefined, c.weight) * cam.zoom };
        }).filter((c) => c.text.length >= 5 && c.px >= 8 && c.cx - c.wScreen / 2 > 40 && c.cx + c.wScreen / 2 < 1560 && c.cy > 60 && c.cy < 940 && c.align === "center" && c.base === "middle");
        pick.sort((a, b) => b.text.length - a.text.length);
        // Glyph quad origins in device px: how far from a whole pixel.
        const fr = { n: 0, snapped: 0, sumX: 0, sumY: 0 };
        const dprNow = cv.width / r.width;
        const walk = (b) => {
          if (!b) return;
          for (const t of b.texts || []) {
            if (t.color || !b.tdata) continue;
            for (let j = t.start; j + 1 < t.end; j += 48) {
              const dxp = (b.tdata[j] - cam.x) * cam.zoom * dprNow; const dyp = (b.tdata[j + 1] - cam.y) * cam.zoom * dprNow;
              const fx = Math.abs(dxp - Math.round(dxp)); const fy = Math.abs(dyp - Math.round(dyp));
              fr.n++; fr.sumX += fx; fr.sumY += fy; if (fx < 0.02 && fy < 0.02) fr.snapped++;
            }
          }
          for (const l of b.layers || []) walk(l);
        };
        for (const b of nodeGraphGlGraphState.mesh?.batches || []) walk(b);
        return {
          frac: { n: fr.n, snappedFrac: +(fr.snapped / Math.max(1, fr.n)).toFixed(3), meanFracX: +(fr.sumX / Math.max(1, fr.n)).toFixed(3), meanFracY: +(fr.sumY / Math.max(1, fr.n)).toFixed(3) },
          dprNow,
          dpr: devicePixelRatio, zoom: nodeGraphZoom(), cam, canvas: { w: cv.width, h: cv.height, cssW: r.width, cssH: r.height, left: r.left, top: r.top },
          bakePx: nodeGraphGlGraphState.lastTextBake?.px, emojiPx: nodeGraphGlGraphState.emojiPx, atlas600: atlas?.bakePx, atlas400: atlas4?.bakePx,
          nCalls: calls.length, pick: pick.slice(0, 6),
        };
      }, { zoom, want: WANT });
      const label = (WANT && rec.pick.find((c) => c.text === WANT)) || rec.pick[0];
      if (!WANT && label) WANT = label.text;
      if (!label) { results.push({ dpr, zoom, error: "no label", rec }); continue; }
      const shot = await page.screenshot({ type: "png" });
      // Crop in css px, multiples of 4 so device px are integral at 1.25 / 1.5.
      const w4 = Math.ceil((label.wScreen + 16) / 4) * 4;
      const h4 = Math.ceil((label.px * rec.zoom * 1.35 + 4) / 4) * 4;
      const x4 = Math.floor((label.cx - w4 / 2) / 4) * 4;
      const y4 = Math.floor((label.cy - h4 / 2) / 4) * 4;
      const c = label.rgba || [1, 1, 1, 1];
      const colorCss = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c.length > 3 ? c[3] : 1})`;
      const family = label.family || '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
      const analysis = await ref.evaluate(async ({ shotB64, dpr, x4, y4, w4, h4, colorCss, family, weight, fontPx, text, tag, cv, aa }) => {
        const img = new Image(); img.src = "data:image/png;base64," + shotB64; await img.decode();
        const cx = (x, y, w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
        const dx = Math.round(x4 * dpr), dy = Math.round(y4 * dpr), dw = Math.round(w4 * dpr), dh = Math.round(h4 * dpr);
        const glC = cx(0, 0, dw, dh); const g = glC.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, dx, dy, dw, dh, 0, 0, dw, dh);
        const glData = g.getImageData(0, 0, dw, dh);
        // Background: median of the crop border.
        const border = [];
        for (let x = 0; x < dw; x++) { border.push([0, x], [dh - 1, x]); }
        for (let y = 0; y < dh; y++) { border.push([y, 0], [y, dw - 1]); }
        const med = (ch) => { const v = border.map(([y, x]) => glData.data[(y * dw + x) * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
        const bg = [med(0), med(1), med(2)];
        document.body.style.cssText = "margin:0;background:rgb(" + bg.join(",") + ")";
        document.body.innerHTML = "";
        const box = document.createElement("div");
        box.style.cssText = `position:absolute;left:0;top:0;width:${w4}px;height:${h4}px;display:flex;align-items:center;justify-content:center;overflow:hidden;` + (aa === 'gray' ? 'will-change:transform;' : '');
        const sp = document.createElement("span");
        sp.textContent = text;
        sp.style.cssText = `font-family:${family};font-weight:${weight};font-size:${fontPx}px;color:${colorCss};white-space:pre;line-height:1;`;
        box.appendChild(sp); document.body.appendChild(box);
        await document.fonts.ready;
        return { bg, dw, dh, dx, dy, ready: true };
      }, { shotB64: shot.toString("base64"), dpr, x4, y4, w4, h4, colorCss, family, weight: label.weight, fontPx: label.px * rec.zoom, text: label.text, tag: TAG, cv: null, aa: HTML_AA });
      const refShot = await ref.screenshot({ type: "png", clip: { x: 0, y: 0, width: w4, height: h4 } });
      const stats = await ref.evaluate(async ({ shotB64, refB64, dpr, x4, y4, w4, h4, fg, bg, name, zoom }) => {
        const load = async (b) => { const i = new Image(); i.src = "data:image/png;base64," + b; await i.decode(); return i; };
        const [gi, ri] = [await load(shotB64), await load(refB64)];
        const dw = Math.round(w4 * dpr), dh = Math.round(h4 * dpr);
        const mk = (img, sx, sy) => { const c = document.createElement("canvas"); c.width = dw; c.height = dh; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, sx, sy, dw, dh, 0, 0, dw, dh); return { c, d: x.getImageData(0, 0, dw, dh) }; };
        const gl = mk(gi, Math.round(x4 * dpr), Math.round(y4 * dpr));
        const rf = mk(ri, 0, 0);
        const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const bgL = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
        const fgL = 0.2126 * fg[0] + 0.7152 * fg[1] + 0.0722 * fg[2];
        const den = (fgL - bgL) || 1;
        const cov = (o) => { const a = new Float32Array(dw * dh); for (let i = 0; i < a.length; i++) a[i] = (lum(o.d.data, i * 4) - bgL) / den; return a; };
        const cg = cov(gl), cr = cov(rf);
        const metrics = (a) => {
          let ink = 0, peak = -9, en = 0, inkPx = 0, mid = 0;
          for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
            const v = a[y * dw + x]; ink += Math.max(0, v); if (v > peak) peak = v;
            if (v > 0.1) { inkPx++; if (v < 0.9) mid++; }
            if (x + 1 < dw) { const d = a[y * dw + x + 1] - v; en += d * d; }
            if (y + 1 < dh) { const d = a[(y + 1) * dw + x] - v; en += d * d; }
          }
          return { ink: +ink.toFixed(2), peak: +peak.toFixed(3), edgePerInk: +(en / Math.max(1e-6, ink)).toFixed(4), inkPx, midFrac: +(mid / Math.max(1, inkPx)).toFixed(3) };
        };
        // Best-aligned mean abs diff (shift GL by up to 6 px each way).
        let best = { mae: 1e9, sx: 0, sy: 0 };
        for (let sy = -6; sy <= 6; sy++) for (let sx = -6; sx <= 6; sx++) {
          let s = 0, n = 0;
          for (let y = 6; y < dh - 6; y++) for (let x = 6; x < dw - 6; x++) { s += Math.abs(cg[(y + sy) * dw + x + sx] - cr[y * dw + x]); n++; }
          const mae = s / n; if (mae < best.mae) best = { mae, sx, sy };
        }
        // Side by side, 8x nearest.
        const S = 8; const out = document.createElement("canvas"); out.width = dw * S; out.height = dh * S * 2 + 8;
        const o = out.getContext("2d"); o.imageSmoothingEnabled = false; o.fillStyle = "#f0f"; o.fillRect(0, 0, out.width, out.height);
        o.drawImage(gl.c, 0, 0, dw * S, dh * S); o.drawImage(rf.c, 0, dh * S + 8, dw * S, dh * S);
        return { gl: metrics(cg), html: metrics(cr), align: { mae: +best.mae.toFixed(4), sx: best.sx, sy: best.sy }, png: out.toDataURL("image/png").split(",")[1], dw, dh };
      }, { shotB64: shot.toString("base64"), refB64: refShot.toString("base64"), dpr, x4, y4, w4, h4, fg: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)], bg: analysis.bg, name: "", zoom });
      const name = `${TAG}_dpr${dpr}_z${zoom}`;
      fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(stats.png, "base64"));
      delete stats.png;
      results.push({ dpr, zoom, label: { text: label.text, px: label.px, weight: label.weight, wScreen: +label.wScreen.toFixed(1) }, canvas: rec.canvas, frac: rec.frac, backingDpr: rec.dprNow, bakePx: rec.bakePx, atlas600: rec.atlas600, atlas400: rec.atlas400, wantAtlasPxIfDprZoom: Math.round(label.px * zoom * dpr), crop: { x4, y4, w4, h4 }, ...stats });
      console.log(name, JSON.stringify({ gl: stats.gl, html: stats.html, align: stats.align, canvas: rec.canvas.w + "x" + rec.canvas.h, atlas: rec.atlas600 }));
    }
    await context.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
fs.writeFileSync(path.join(OUT, `${TAG}_results.json`), JSON.stringify(results, null, 1));
console.log("saved", OUT);