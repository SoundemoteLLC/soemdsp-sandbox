#!/usr/bin/env node
// Pitch Mod Wheel is the first display-only module: the WebGL face is the
// whole UI. Static checks (old DOM wheel gone, definition, integration
// entries, keyboard golden fixture untouched) plus a headless browser run:
// shared drag surface with the Knob/Slider modifiers (relative click-drag,
// Alt+click jump, Shift/Ctrl fine, Shift+Ctrl finer, Ctrl+click reset, touch
// relative, two fingers on two wheels at once), Pitch springs back, Mod holds (until Spring is on), no press
// highlight, ridges roll with the pointer,
// wire drops map to each wheel's MOD inlet, right-click opens one merged
// panel (Parameter on top, Display below), hidden display collapses, the
// display resizes with its height, and old patches load.
//   node scripts/test_pitch_mod_wheel_face_gl.mjs
//   SANDBOX_URL=http://127.0.0.1:8765/ node scripts/test_pitch_mod_wheel_face_gl.mjs
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures += 1;
}

// ---- static ------------------------------------------------------------------
const face = read("public/modules/pitchModWheel/pitch-mod-wheel-face.js");
const kit = read("public/modules/_shared/controller-face-gl.js");
const defs = read("public/node-graph-module-definitions.js");
const css = read("public/styles.css");
const allJs = ["public/node-graph-view-controls.js", "public/node-graph-module-factories.js", "public/node-graph-module-rendering.js"]
  .map(read).join("\n");
const def = defs.slice(defs.indexOf("  pitchModWheel: {"), defs.indexOf("\n  },", defs.indexOf("  pitchModWheel: {")));

check(!/node-keyboard-wheel|node-performance-wheels/.test(css + allJs), "old DOM wheel track/thumb CSS and builders are gone");
check(!/data-performance-wheel|PerformanceWheel|PerformancePitchWheel|createNodeGraphPitchModWheelBody/.test(allJs), "old DOM wheel drag/render JS is gone");
check(/displayType:\s*"pitchModWheelFace"/.test(def) && /customDisplayArea:\s*true/.test(def), "definition declares the WebGL display face");
check(!/modulation:\s*false/.test(def), "both wheel params accept modulation");
check(/registerNodeGraphModuleFaceCreator\(\s*"pitchModWheelFace"/.test(face), "face registers on the display-type creator map");
check(/nodeGraphControllerFacePaint\(\s*face,\s*"wheel"/.test(face) && /wheel:\s*drawWheel/.test(kit), "face draws through the shared controller GL kit (kind wheel)");
check(!/\.title\s*=|setAttribute\("title"|nodeGraphApplyTooltip/.test(face), "face sets no hover text");
const dragging = read("public/node-graph-slider-dragging.js");
const knobFace = read("public/modules/knob/knob-face.js");
check(/function bindNodeSliderDragSurface\(/.test(dragging) && /bindNodeSliderDragSurface\(hit\)/.test(face)
  && /bindNodeSliderDragSurface\(face\)/.test(knobFace), "wheel, Knob and Slider faces bind through one shared drag surface helper");
check(!/setPointerCapture|addEventListener\("pointer(down|move|up)"|altKey|shiftKey|ctrlKey/.test(face), "wheel face has no drag/modifier code of its own");
check(!/\bactive\b/.test(kit.slice(kit.indexOf("function drawWheel"), kit.indexOf("const LAYOUTS"))) && !/active:/.test(face), "no press/drag highlight on the wheel");
{
  // Ridge direction: the surface moves with the pointer. Raising the value
  // (drag up) rolls the ridges up; lowering it (drag down) rolls them down.
  const vm = await import("node:vm");
  const sandbox = { module: { exports: {} }, Math, Number, Object, JSON, Array, Date };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(kit, sandbox);
  const kitApi = sandbox.module.exports;
  const body = { x: 0, y: 0, w: 40, h: 100 };
  const near = (list, y) => list.reduce((best, r) => (Math.abs(r.y - y) < Math.abs(best.y - y) ? r : best));
  const a = near(kitApi.nodeGraphControllerWheelRidges(body, 0.5), 50);
  const up = near(kitApi.nodeGraphControllerWheelRidges(body, 0.505), a.y);
  const down = near(kitApi.nodeGraphControllerWheelRidges(body, 0.495), a.y);
  check(up.y < a.y && down.y > a.y, `ridges roll with the drag (value up: ${a.y.toFixed(2)} -> ${up.y.toFixed(2)}, value down: -> ${down.y.toFixed(2)})`);
}
check(!/clampNodeSliderValue\([^)]*-1\s*,\s*1\)|Math\.min\(1,\s*Math\.max\(-1/.test(face), "face hardcodes no wheel limits");
for (const [rel, re] of [
  ["public/node-graph-module-scope-display-mode.js", /"pitchModWheelFace"/],
  ["public/node-graph-module-scope-draw-orchestrator.js", /pitchModWheelFace:/],
  ["public/node-graph-module-scope-paint-gate.js", /pitchModWheelFace:\s*"param"/],
  ["public/node-graph-module-scope-offline.js", /"pitchModWheelFace"/],
  ["public/node-graph-module-scope-trace-controls.js", /pitchModWheelFace:\s*"Pitch Mod Wheel"/],
  ["public/node-graph-module-scope-settings-form.js", /buildNodeGraphPitchModWheelDisplaySettingsBodyHtml/],
  ["public/node-graph-module-scope-settings-form-io.js", /restoreNodeGraphPitchModWheelParamEmbed[\s\S]*bindNodeGraphPitchModWheelDisplaySettingsBody/],
  ["public/node-graph-module-scope-settings-apply.js", /"pitchModWheelFace"/],
  ["public/node-graph-patch-clone.js", /case "pitchModWheelFace"/],
  ["public/node-graph-module-face.js", /data-face-param-drop/],
]) check(re.test(read(rel)), `integration: ${rel}`);
for (const html of ["public/index.html", "public/perform.html"]) {
  const text = read(html);
  check(/pitchModWheel\/pitch-mod-wheel-face\.js\?v=/.test(text) && /pitchModWheel\/pitch-mod-wheel-face\.css\?v=/.test(text), `${html} loads the wheel face js + css`);
}
let fixtureSame = false;
try {
  execSync("git diff --quiet HEAD -- scripts/fixtures/keyboard-face-gl-draw-ops.json", { cwd: ROOT });
  fixtureSame = true;
} catch { fixtureSame = false; }
check(fixtureSame, "keyboard golden fixture is byte-identical to HEAD");

// ---- browser -----------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server not up: ${url}`);
}

const { chromium } = await import("playwright");
let server = null;
let browser = null;
let baseUrl = process.env.SANDBOX_URL || "";
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
  }
  await waitForServer(baseUrl, 60000);
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function"
    && typeof nodeGraphModuleFaceCreatorsByDisplayType === "object" && typeof nodeGraphModuleFaceCreatorsByDisplayType.pitchModWheelFace === "function", null, { timeout: 180000 });
  // The boot screen sits over the workspace until the app is ready.
  await page.waitForFunction(() => {
    const boot = document.querySelector(".node-boot-loading-screen");
    return !boot || boot.hidden || getComputedStyle(boot).display === "none" || boot.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);

  const setup = await page.evaluate(async () => {
    const node = createNodeGraphPatchNode("pitchModWheel", { id: "wheelA", gx: 3, gy: 2, ui: { displayHeightGu: 5 } });
    const legacy = createNodeGraphPatchNode("pitchModWheel", { id: "wheelOld", gx: 14, gy: 2 });
    legacy.params = { pitch: "0.5", mod: "0.25" };
    delete legacy.traceDisplaySettings;
    const hidden = createNodeGraphPatchNode("pitchModWheel", { id: "wheelHidden", gx: 3, gy: 14, ui: { oscilloscopeHidden: true } });
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes: [node, legacy, hidden], cables: [] }, { status: "wheel gl test" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    await new Promise((r) => setTimeout(r, 600));
    const art = document.querySelector('.dsp-node[data-node="wheelA"]');
    const f = art?.querySelector(".node-pitch-mod-wheel-face");
    const hits = [...(f?.querySelectorAll(".node-pitch-mod-wheel-hit") || [])];
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const drops = typeof nodeGraphModuleFaceHitBoxes === "function" ? nodeGraphModuleFaceHitBoxes(art) : [];
    const hiddenArt = document.querySelector('.dsp-node[data-node="wheelHidden"]');
    const oldArt = document.querySelector('.dsp-node[data-node="wheelOld"]');
    return {
      glGraphOn: Boolean(document.querySelector(".node-graph-workspace.gl-graph-on, .gl-graph-on")),
      face: Boolean(f),
      canvas: Boolean(f?.querySelector(".node-controller-face-canvas")),
      oldDom: Boolean(art?.querySelector(".node-keyboard-wheel, [data-performance-wheel]")),
      titles: [f, ...hits].filter((el) => el?.hasAttribute?.("title")).length,
      hits: hits.map((h) => ({ key: h.dataset.pitchModWheelParam, ...rect(h) })),
      faceH: f?.getBoundingClientRect().height || 0,
      dropKeys: drops.map((b) => b.row?.dataset?.param).filter(Boolean),
      modPorts: ["pitch", "mod"].map((k) => Boolean(art?.querySelector(`.node-parameter-row[data-param="${k}"] .node-param-port.modulation-input`))),
      hiddenFaceH: (() => {
        const hf = hiddenArt?.querySelector(".node-pitch-mod-wheel-face");
        return hf ? hf.getBoundingClientRect().height : 0;
      })(),
      hiddenVisible: typeof nodeGraphModuleDisplayVisibleForUi === "function"
        ? nodeGraphModuleDisplayVisibleForUi("pitchModWheel", nodeGraphMvp.patch.nodes.find((n) => n.id === "wheelHidden")?.ui || {})
        : null,
      hiddenArt: Boolean(hiddenArt),
      oldFace: Boolean(oldArt?.querySelector(".node-pitch-mod-wheel-face")),
      oldPitch: Number(document.getElementById("node-wheelOld-pitch")?.value),
      oldSettings: typeof nodeGraphPitchModWheelDisplaySettingsForNode === "function"
        ? nodeGraphPitchModWheelDisplaySettingsForNode(nodeGraphMvp.patch.nodes.find((n) => n.id === "wheelOld")) : null,
    };
  });
  console.log(`note GL graph mode: ${setup.glGraphOn ? "on" : "off"}`);
  check(setup.face && setup.canvas, "wheel face + GL canvas mounted");
  check(!setup.oldDom, "no DOM wheel graphics in the module");
  check(setup.titles === 0, "no hover titles on the face or wheels");
  check(setup.hits.length === 2 && setup.hits.every((h) => h.w > 4 && h.h > 10), `two wheel hit boxes laid over the drawing (${JSON.stringify(setup.hits.map((h) => [h.key, Math.round(h.w), Math.round(h.h)]))})`);
  check(setup.dropKeys.includes("pitch") && setup.dropKeys.includes("mod"), `wire-drop boxes map to both wheel params (${setup.dropKeys.join(",")})`);
  check(setup.modPorts.every(Boolean), "both wheel params have a MOD inlet for the drop");
  check(setup.hiddenArt && setup.hiddenVisible === false && setup.hiddenFaceH === 0, `hidden display collapses (visible=${setup.hiddenVisible}, face height ${setup.hiddenFaceH})`);
  check(setup.oldFace && Math.abs(setup.oldPitch - 0.5) < 1e-6 && setup.oldSettings?.springPitch === true, "old patch without display settings loads with defaults and keeps its values");

  const val = (key) => page.evaluate((k) => {
    const el = document.getElementById(`node-wheelA-${k}`);
    const d = Number(el?.dataset?.domainValue);
    return Number.isFinite(d) ? d : Number(el?.value);
  }, key);
  const setVal = (key, v) => page.evaluate(({ k, v }) => {
    const el = document.getElementById(`node-wheelA-${k}`);
    setNodeSliderValue(el, v, { interaction: "drag" });
    commitNodeSliderDragValue(el, "test");
  }, { k: key, v });
  // Pointer gesture on a wheel through real event dispatch (modifier flags on
  // every event). Presses are kept apart so two in a row are not a double-click.
  // fromV: 0 = top of the slot, 1 = bottom. dy: pixels moved (negative = up).
  const gesture = (key, fromV, dy, mods = {}, opts = {}) => page.evaluate(({ key, fromV, dy, mods, opts }) => {
    const hit = document.querySelector(`.dsp-node[data-node="wheelA"] [data-pitch-mod-wheel-param="${key}"]`);
    const r = hit.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y0 = r.top + r.height * fromV;
    const slider = document.getElementById(`node-wheelA-${key}`);
    const read = () => { const d = Number(slider.dataset.domainValue); return Number.isFinite(d) ? d : Number(slider.value); };
    if (!opts.keepClickTiming) nodeGraphMvp.sliderLastPointerDown = null;
    const pointerType = opts.touch ? "touch" : "mouse";
    const fire = (target, type, y, buttons) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: opts.touch ? 21 : 1, pointerType, isPrimary: true,
      clientX: x, clientY: y, button: 0, buttons, ...mods,
    }));
    const target = document.elementFromPoint(x, y0);
    fire(target, "pointerdown", y0, 1);
    const pressed = read();
    const steps = 5;
    for (let i = 1; i <= steps; i += 1) fire(document, "pointermove", y0 + (dy * i) / steps, 1);
    const held = read();
    fire(document, "pointerup", y0 + dy, 0);
    return { onWheel: Boolean(target?.closest?.(`[data-pitch-mod-wheel-param="${key}"]`)), pressed, held, released: read(), h: r.height };
  }, { key, fromV, dy, mods, opts });
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  // Plain click-drag is relative: the press never jumps to the pointer.
  await setVal("mod", 0.25);
  const plain = await gesture("mod", 0.1, -20);
  const plainDelta = plain.held - 0.25;
  check(plain.onWheel && near(plain.pressed, 0.25, 1e-9), `click on the wheel does not jump to the mouse (pressed at the top: ${plain.pressed})`);
  check(plainDelta > 0.05 && plainDelta < 0.5, `click-drag moves relative to the current value (0.25 -> ${plain.held.toFixed(4)})`);
  check(near(plain.released, plain.held, 1e-9), `Mod holds where it was released (${plain.released.toFixed(4)})`);
  // Alt+click jumps to the pointer (vertical position in the slot).
  await setVal("mod", 0.25);
  const alt = await gesture("mod", 0.25, 0, { altKey: true });
  check(near(alt.pressed, 0.75, 0.03), `Alt+click jumps to the mouse (0.25 -> ${alt.pressed.toFixed(4)} at 75% height)`);
  // Fine drags: Shift or Ctrl x0.1, Shift+Ctrl x0.01 of a plain drag.
  await setVal("mod", 0.25);
  const shift = await gesture("mod", 0.5, -20, { shiftKey: true });
  await setVal("mod", 0.25);
  const ctrlDrag = await gesture("mod", 0.5, -20, { ctrlKey: true });
  await setVal("mod", 0.25);
  const finer = await gesture("mod", 0.5, -20, { shiftKey: true, ctrlKey: true });
  const ratio = (g) => (g.held - 0.25) / plainDelta;
  check(near(ratio(shift), 0.1, 0.01), `Shift drag is fine (x${ratio(shift).toFixed(3)})`);
  check(near(ratio(ctrlDrag), 0.1, 0.01), `Ctrl drag is fine (x${ratio(ctrlDrag).toFixed(3)})`);
  check(near(ratio(finer), 0.01, 0.002), `Shift+Ctrl drag is finer (x${ratio(finer).toFixed(4)})`);
  // Ctrl+click resets to the param default.
  await setVal("mod", 0.6);
  const reset = await gesture("mod", 0.5, 0, { ctrlKey: true });
  check(near(reset.released, 0, 1e-9), `Ctrl+click resets to default (0.6 -> ${reset.released})`);
  // The param max is the only limit.
  await setVal("mod", 0.9);
  const past = await gesture("mod", 0.5, -400);
  check(near(past.held, 1, 1e-9), `dragging past the end stops at the param max (${past.held})`);
  // A quick second press is another drag (no type-in on the wheel face).
  await setVal("mod", 0.25);
  await gesture("mod", 0.5, 0);
  const second = await gesture("mod", 0.5, -20, {}, { keepClickTiming: true });
  const typeIn = await page.evaluate(() => Boolean(document.querySelector('.dsp-node[data-node="wheelA"] input:not([type="range"]):not([type="hidden"])')));
  check(!typeIn && second.held > 0.25 + plainDelta * 0.5, `double-click does not open a type-in; the second press drags (${second.held.toFixed(4)})`);
  // Pitch: relative drag, then springs back to its default on release.
  await setVal("pitch", 0);
  const pitch = await gesture("pitch", 0.9, -20);
  check(near(pitch.pressed, 0, 1e-9) && pitch.held > 0.1, `Pitch drags relative from center (${pitch.pressed} -> ${pitch.held.toFixed(4)})`);
  check(near(pitch.released, 0, 1e-9), `Pitch springs back to its default on release (${pitch.released})`);
  // Touch: relative like the sliders (no jump on press), spring still applies.
  const touch = await gesture("pitch", 0.1, 20, {}, { touch: true });
  check(near(touch.pressed, 0, 1e-9) && touch.held < -0.1 && near(touch.released, 0, 1e-9),
    `touch drags relative and springs back (${touch.pressed} -> ${touch.held.toFixed(4)} -> ${touch.released})`);

  const modHit = setup.hits.find((h) => h.key === "mod");
  const cx = (h) => h.x + h.w / 2;
  // Multi-touch: two fingers drive the two wheels at once; a second finger on
  // a wheel already held does not take it over; pointercancel ends cleanly.
  await setVal("pitch", 0);
  await setVal("mod", 0.25);
  const both = await page.evaluate(() => {
    const at = (key, v) => {
      const hit = document.querySelector(`.dsp-node[data-node="wheelA"] [data-pitch-mod-wheel-param="${key}"]`);
      const r = hit.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * v };
    };
    const fire = (el, type, id, p, dy, buttons = 1) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: "touch", isPrimary: id === 31,
      clientX: p.x, clientY: p.y + dy, button: 0, buttons,
    }));
    const read = (key) => { const el = document.getElementById(`node-wheelA-${key}`); const d = Number(el.dataset.domainValue); return Number.isFinite(d) ? d : Number(el.value); };
    const p = at("pitch", 0.5); const m = at("mod", 0.5);
    fire(document.elementFromPoint(p.x, p.y), "pointerdown", 31, p, 0);
    fire(document.elementFromPoint(m.x, m.y), "pointerdown", 32, m, 0);
    const live = nodeGraphSliderActiveDrags().length;
    // A third finger lands on the Mod wheel that finger 32 already holds.
    fire(document.elementFromPoint(m.x, m.y + 10), "pointerdown", 33, m, 10);
    const liveAfterThird = nodeGraphSliderActiveDrags().length;
    for (let i = 1; i <= 4; i += 1) {
      fire(document, "pointermove", 31, p, -5 * i);
      fire(document, "pointermove", 32, m, -5 * i);
      fire(document, "pointermove", 33, m, 10 + 30 * i);
    }
    const heldPitch = read("pitch");
    const heldMod = read("mod");
    fire(document, "pointerup", 33, m, 130, 0);
    fire(document, "pointerup", 32, m, -20, 0);
    const modAfterUp = read("mod");
    const pitchStillLive = nodeGraphSliderActiveDrags().some((d) => d.pointerId === 31);
    fire(document, "pointermove", 31, p, -30);
    const pitchMore = read("pitch");
    fire(document, "pointercancel", 31, p, -30, 0);
    return {
      live, liveAfterThird, heldPitch, heldMod, modAfterUp, pitchStillLive, pitchMore,
      pitchAfterCancel: read("pitch"),
      left: nodeGraphSliderActiveDrags().length,
      flag: Boolean(nodeGraphMvp.sliderDragging),
      bodyClass: document.body.classList.contains("node-slider-dragging"),
    };
  });
  check(both.live === 2 && both.heldPitch > 0.1 && both.heldMod > 0.3, `two fingers drag both wheels at once (pitch ${both.heldPitch.toFixed(4)}, mod ${both.heldMod.toFixed(4)})`);
  check(both.liveAfterThird === 2 && near(both.heldMod - 0.25, plainDelta, 0.01), `a second finger on a held wheel does not take it over (mod moved ${(both.heldMod - 0.25).toFixed(4)} = one finger's ${plainDelta.toFixed(4)})`);
  check(near(both.modAfterUp, both.heldMod, 1e-9) && both.pitchStillLive && both.pitchMore > both.heldPitch, `lifting the Mod finger holds Mod and Pitch keeps dragging (${both.pitchMore.toFixed(4)})`);
  check(near(both.pitchAfterCancel, 0, 1e-9), `pointercancel ends the Pitch drag and it springs back (${both.pitchAfterCancel})`);
  check(both.left === 0 && !both.flag && !both.bodyClass, "no drag state or cursor class left after all fingers end");

  // Right-click the Mod wheel: one panel, Parameter on top, Display below.
  await page.mouse.click(cx(modHit), modHit.y + modHit.h * 0.5, { button: "right" });
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => {
    const pop = document.getElementById("nodeTraceDisplaySettingsPopover");
    const host = pop?.querySelector("[data-pitch-mod-wheel-param-host]");
    const grid = host?.querySelector(".metadata-popover-grid");
    const display = pop?.querySelector("[data-pitch-mod-wheel-display-settings-panel]");
    const colors = pop?.querySelectorAll("[data-trace-display-color-field], .node-trace-display-color-row, [data-color-field]").length || 0;
    const springMod = pop?.querySelector('[data-pitch-mod-wheel-setting="springMod"]');
    const hostTop = host?.getBoundingClientRect().top ?? 0;
    const springTop = springMod?.getBoundingClientRect().top ?? 0;
    return {
      open: Boolean(pop && !pop.hidden && pop.getBoundingClientRect().height > 0),
      display: Boolean(display),
      grid: Boolean(grid),
      target: nodeGraphMvp.metadataEditorTarget,
      colors,
      paramAbove: hostTop < springTop,
      gridVisible: Boolean(grid && grid.getBoundingClientRect().height > 20),
    };
  });
  check(panel.open && panel.display, "right-click opens Display Settings for the wheel");
  check(panel.grid && panel.gridVisible && panel.paramAbove, "Parameter Settings form is embedded above the Display section");
  check(panel.target === "node-wheelA-mod", `Parameter section edits the wheel under the pointer (${panel.target})`);
  // Spring for Mod from the Display section.
  await page.evaluate(() => {
    const box = document.querySelector('#nodeTraceDisplaySettingsPopover [data-pitch-mod-wheel-setting="springMod"]');
    if (box) box.click();
  });
  await page.waitForTimeout(150);
  const springOn = await page.evaluate(() => nodeGraphMvp.patch.nodes.find((n) => n.id === "wheelA")?.traceDisplaySettings?.springMod === true);
  check(springOn, "Spring (Mod) is saved in node.traceDisplaySettings");
  await page.evaluate(() => closeNodeGraphTraceDisplaySettings());
  await page.waitForTimeout(150);
  const under = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.("[data-pitch-mod-wheel-param]")?.dataset?.pitchModWheelParam || `${el?.id || ""} ${el?.className || ""}`;
  }, { x: cx(modHit), y: modHit.y + modHit.h * 0.5 });
  check(under === "mod", `closing the panel leaves the wheel reachable (${under})`);
  const sprung = await gesture("mod", 0.5, -30);
  check(sprung.held > 0.1 && near(sprung.released, 0, 1e-9), `with Spring on, Mod returns to its default (${sprung.held.toFixed(4)} -> ${sprung.released})`);
  const restored = await page.evaluate(() => {
    if (typeof restoreNodeGraphPitchModWheelParamEmbed === "function") restoreNodeGraphPitchModWheelParamEmbed();
    const grid = document.querySelector("#nodeParameterMetadataPopover > .metadata-popover-grid");
    return Boolean(grid);
  });
  check(restored, "the Parameter form goes back to its own popover");

  // Resize: a taller display gives a taller face.
  const grown = await page.evaluate(async () => {
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const n = patch.nodes.find((x) => x.id === "wheelA");
    n.ui = { ...(n.ui || {}), displayHeightGu: 9 };
    commitNodeGraphPatch(patch, { status: "wheel resize" });
    await new Promise((r) => setTimeout(r, 500));
    const f = document.querySelector('.dsp-node[data-node="wheelA"] .node-pitch-mod-wheel-face');
    return f?.getBoundingClientRect().height || 0;
  });
  check(grown > setup.faceH + 20, `display height resizes the face (${Math.round(setup.faceH)} -> ${Math.round(grown)} px)`);
  const normalized = await page.evaluate(() => normalizeNodeGraphPitchModWheelFaceSettings({ springPitch: "false", springMod: 1, wheelColor: 12, fillColor: "#112233" }));
  check(normalized.springPitch === false && normalized.springMod === true && normalized.fillColor === "#112233" && typeof normalized.wheelColor === "string" && normalized.wheelColor.startsWith("#"), "normalize fixes old/odd display-setting fields");
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(" | ")}` : ""}`);
} catch (error) {
  check(false, `browser run: ${error?.stack || error}`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
