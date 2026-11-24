#!/usr/bin/env node
// Knob and Slider face mouse modifiers through the shared drag surface
// (bindNodeSliderDragSurface / beginNodeSliderDrag). The expected numbers were
// recorded before the binding was shared (wheel-gl-2) and must not change:
// relative click-drag, Shift / Ctrl fine (x0.1), Shift+Ctrl finer (x0.01),
// Alt+click jump, Ctrl+click reset. Multi-touch (multitouch-1): a Knob and a
// Slider dragged at once by two fingers each move exactly like a lone drag;
// a long hold on one finger opens type-in while the other keeps dragging;
// a double-tap resets one while the other is held; nothing leaks after.
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
  // ---- multi-touch: Knob + Slider at once ----
  const multi = await page.evaluate(async (hits) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, type, id, x, y, buttons = 1) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: "touch", isPrimary: id === 41,
      clientX: x, clientY: y, button: 0, buttons,
    }));
    const k = hits.k1; const s = hits.s1;
    const ks = document.getElementById(k.target); const ss = document.getElementById(s.target);
    const v = (el) => Number(el.dataset.domainValue ?? el.value);
    const set = (el, val) => { setNodeSliderValue(el, val, { interaction: "drag" }); commitNodeSliderDragValue(el, "probe"); };
    const out = {};
    set(ks, 0.5); set(ss, 0.5);
    const kEl = document.elementFromPoint(k.x, k.y); const sEl = document.elementFromPoint(s.x, s.y);
    fire(kEl, "pointerdown", 41, k.x, k.y);
    fire(sEl, "pointerdown", 42, s.x, s.y);
    out.bothLive = nodeGraphSliderActiveDrags().length;
    for (let i = 1; i <= 4; i += 1) {
      fire(document, "pointermove", 41, k.x, k.y - 5 * i);
      fire(document, "pointermove", 42, s.x, s.y - 5 * i);
    }
    out.knobDelta = +(v(ks) - 0.5).toFixed(5);
    out.sliderDelta = +(v(ss) - 0.5).toFixed(5);
    fire(document, "pointerup", 41, k.x, k.y - 20, 0);
    out.afterFirstUp = nodeGraphSliderActiveDrags().length;
    fire(document, "pointermove", 42, s.x, s.y - 40);
    out.sliderAfterKnobUp = +(v(ss) - 0.5).toFixed(5);
    fire(document, "pointerup", 42, s.x, s.y - 40, 0);
    // Long hold on the knob opens its type-in while the slider finger drags.
    await wait(450); // past the double-tap window from the presses above
    set(ks, 0.5); set(ss, 0.5);
    fire(sEl, "pointerdown", 44, s.x, s.y);
    fire(kEl, "pointerdown", 43, k.x, k.y);
    fire(document, "pointermove", 44, s.x, s.y - 15); // past the 10px touch slop
    await wait(650);
    fire(document, "pointermove", 44, s.x, s.y - 20);
    out.holdTypeIn = document.querySelector(`.node-knob-face[data-node="k1"]`)?.dataset?.knobFaceEditing === "true";
    out.sliderDuringHold = +(v(ss) - 0.5).toFixed(5);
    out.liveDuringHold = nodeGraphSliderActiveDrags().map((d) => d.slider.id);
    fire(document, "pointerup", 43, k.x, k.y, 0);
    fire(document, "pointerup", 44, s.x, s.y - 20, 0);
    document.activeElement?.blur?.();
    if (typeof endNodeGraphKnobFaceValueEdit === "function") endNodeGraphKnobFaceValueEdit(document.querySelector(`.node-knob-face[data-node="k1"]`), false);
    await wait(400);
    // Double-tap resets the knob while another finger holds the slider.
    set(ks, 0.8);
    fire(sEl, "pointerdown", 45, s.x, s.y);
    fire(kEl, "pointerdown", 46, k.x, k.y); fire(document, "pointerup", 46, k.x, k.y, 0);
    await wait(60);
    fire(kEl, "pointerdown", 47, k.x, k.y); fire(document, "pointerup", 47, k.x, k.y, 0);
    out.doubleTapReset = +v(ks).toFixed(5);
    out.sliderStillLive = nodeGraphSliderActiveDrags().some((d) => d.pointerId === 45);
    fire(document, "pointercancel", 45, s.x, s.y, 0);
    out.leftAfter = nodeGraphSliderActiveDrags().length;
    out.flagAfter = Boolean(nodeGraphMvp.sliderDragging);
    out.bodyClassAfter = document.body.classList.contains("node-slider-dragging");
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
  const mcheck = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
  mcheck(multi.bothLive === 2, `two fingers drive a Knob and a Slider at once (${multi.bothLive} live drags)`);
  mcheck(Math.abs(multi.knobDelta - expected.k1.plainUp20) < 1e-4 && Math.abs(multi.sliderDelta - expected.s1.plainUp20) < 1e-4,
    `each finger moves its control exactly like a lone drag (knob ${multi.knobDelta}, slider ${multi.sliderDelta})`);
  mcheck(multi.afterFirstUp === 1 && multi.sliderAfterKnobUp > multi.sliderDelta, `lifting one finger leaves the other dragging (${multi.sliderAfterKnobUp})`);
  mcheck(multi.holdTypeIn && multi.sliderDuringHold > 0 && multi.liveDuringHold.length === 1 && multi.liveDuringHold[0] === hits.s1.target,
    `long hold opens the Knob type-in while the Slider finger keeps dragging (${JSON.stringify(multi.liveDuringHold)}, slider ${multi.sliderDuringHold})`);
  mcheck(Math.abs(multi.doubleTapReset) < 1e-6 && multi.sliderStillLive, `double-tap resets the Knob while another finger holds the Slider (${multi.doubleTapReset})`);
  mcheck(multi.leftAfter === 0 && !multi.flagAfter && !multi.bodyClassAfter, "pointercancel ends its drag; no drag state or cursor class left behind");
  console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
  process.exitCode = bad ? 1 : 0;
} finally { await browser.close(); server.kill(); }
