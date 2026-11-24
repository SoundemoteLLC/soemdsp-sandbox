#!/usr/bin/env node
// Knob and Slider face mouse modifiers through the shared drag surface
// (bindNodeSliderDragSurface / beginNodeSliderDrag). The expected numbers were
// recorded before the binding was shared (wheel-gl-2) and must not change:
// relative click-drag, Shift / Ctrl fine (x0.1), Shift+Ctrl finer (x0.01),
// Alt+click jump, Ctrl+click reset.
//   node scripts/test_controller_face_modifiers.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const { chromium } = await import("playwright");
const port = await freePort();
const server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 240; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(`${base}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);
  const hits = await page.evaluate(async () => {
    const k = createNodeGraphPatchNode("knob", { id: "k1", gx: 3, gy: 2 });
    const s = createNodeGraphPatchNode("pluginSlider", { id: "s1", gx: 12, gy: 2 });
    const b = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...b, nodes: [k, s], cables: [] }, { status: "probe" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    await new Promise((r) => setTimeout(r, 600));
    const out = {};
    for (const id of ["k1", "s1"]) {
      const face = document.querySelector(`.node-knob-face[data-node="${id}"]`);
      const hit = face?.querySelector(":scope > .node-controller-face-hit") || face;
      const r = hit.getBoundingClientRect();
      out[id] = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, target: face.dataset.sliderTarget };
    }
    return out;
  });
  const results = await page.evaluate((hits) => {
    const out = {};
    const fire = (el, type, x, y, mods = {}, buttons = 1) => {
      const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, button: 0, buttons, ...mods });
      el.dispatchEvent(ev);
    };
    const gesture = (h, mods, dx, dy, dx0 = 0) => {
      // Back-to-back presses on one spot read as a double-click; keep them apart.
      nodeGraphMvp.sliderLastPointerDown = null;
      const el = document.elementFromPoint(h.x + dx0, h.y);
      fire(el, "pointerdown", h.x + dx0, h.y, mods);
      const steps = 4;
      for (let i = 1; i <= steps; i++) fire(document, "pointermove", h.x + dx0 + (dx * i) / steps, h.y + (dy * i) / steps, mods);
      fire(document, "pointerup", h.x + dx0 + dx, h.y + dy, mods, 0);
    };
    for (const [id, h] of Object.entries(hits)) {
      const s = document.getElementById(h.target);
      const set = (v) => { setNodeSliderValue(s, v, { interaction: "drag" }); commitNodeSliderDragValue(s, "probe"); };
      const v = () => Number(s.dataset.domainValue ?? s.value);
      const r = {};
      set(0.5); { nodeGraphMvp.sliderLastPointerDown = null; const el = document.elementFromPoint(h.x + h.w * 0.3, h.y); fire(el, "pointerdown", h.x + h.w * 0.3, h.y); r.pressNoMove = +v().toFixed(5); fire(document, "pointerup", h.x + h.w * 0.3, h.y, {}, 0); }
      set(0.5); gesture(h, {}, 0, -20); r.plainUp20 = +(v() - 0.5).toFixed(5);
      set(0.5); gesture(h, { shiftKey: true }, 0, -20); r.shiftUp20 = +(v() - 0.5).toFixed(5);
      set(0.5); gesture(h, { ctrlKey: true }, 0, -20); r.ctrlDragUp20 = +(v() - 0.5).toFixed(5);
      set(0.5); gesture(h, { shiftKey: true, ctrlKey: true }, 0, -20); r.shiftCtrlUp20 = +(v() - 0.5).toFixed(5);
      set(0.5); gesture(h, { altKey: true }, 0, 0, h.w * 0.3); r.altClick = +v().toFixed(5);
      set(0.8); gesture(h, { ctrlKey: true }, 0, 0); r.ctrlClick = +v().toFixed(5);
      set(0.5);
      out[id] = r;
    }
    return out;
  }, hits);
  const expected = {"k1":{"pressNoMove":0.5,"plainUp20":0.35021,"shiftUp20":0.03502,"ctrlDragUp20":0.03502,"shiftCtrlUp20":0.0035,"altClick":0.65,"ctrlClick":0},"s1":{"pressNoMove":0.5,"plainUp20":0.09851,"shiftUp20":0.00985,"ctrlDragUp20":0.00985,"shiftCtrlUp20":0.00099,"altClick":0.65,"ctrlClick":0}};
  let bad = 0;
  for (const [id, exp] of Object.entries(expected)) {
    for (const [k, v] of Object.entries(exp)) {
      const got = results[id]?.[k];
      const ok = Math.abs(got - v) < 1e-4;
      if (!ok) bad += 1;
      console.log(`${ok ? "ok  " : "FAIL"} ${id === "k1" ? "Knob" : "Slider"} ${k}: ${got} (expected ${v})`);
    }
  }
  console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
  process.exitCode = bad ? 1 : 0;
} finally { await browser.close(); server.kill(); }
