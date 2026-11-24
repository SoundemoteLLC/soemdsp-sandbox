#!/usr/bin/env node
// Pitch Mod Wheel is the first display-only module: the WebGL face is the
// whole UI. Static checks (old DOM wheel gone, definition, integration
// entries, keyboard golden fixture untouched) plus a headless browser run:
// drag sets the param, Pitch springs back, Mod holds (until Spring is on),
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

  const val = (key) => page.evaluate((k) => Number(document.getElementById(`node-wheelA-${k}`)?.value), key);
  const pitchHit = setup.hits.find((h) => h.key === "pitch");
  const modHit = setup.hits.find((h) => h.key === "mod");
  const cx = (h) => h.x + h.w / 2;
  // Pitch: drag up near the top, hold, release -> springs to default 0.
  await page.mouse.move(cx(pitchHit), pitchHit.y + pitchHit.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(cx(pitchHit), pitchHit.y + pitchHit.h * 0.1, { steps: 6 });
  const pitchHeld = await val("pitch");
  await page.mouse.up();
  await page.waitForTimeout(80);
  const pitchReleased = await val("pitch");
  check(pitchHeld > 0.6, `dragging Pitch up sets the param (${pitchHeld.toFixed(3)})`);
  check(Math.abs(pitchReleased) < 1e-6, `Pitch springs back to its default on release (${pitchReleased})`);
  // Mod: drag to ~75%, release -> holds.
  await page.mouse.move(cx(modHit), modHit.y + modHit.h * 0.9);
  await page.mouse.down();
  await page.mouse.move(cx(modHit), modHit.y + modHit.h * 0.25, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const modHeld = await val("mod");
  check(Math.abs(modHeld - 0.75) < 0.05, `Mod holds where it was released (${modHeld.toFixed(3)})`);
  // Past the end: the param's own max is the limit.
  await page.mouse.move(cx(modHit), modHit.y + modHit.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(cx(modHit), modHit.y - 200, { steps: 4 });
  await page.mouse.up();
  check(Math.abs((await val("mod")) - 1) < 1e-6, "dragging past the end stops at the param max");
  // Touch: a tap on Pitch's lower half moves it below 0 while held.
  const touched = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const opts = { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    const held = Number(document.getElementById("node-wheelA-pitch").value);
    el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
    return { held, after: Number(document.getElementById("node-wheelA-pitch").value) };
  }, { x: cx(pitchHit), y: pitchHit.y + pitchHit.h * 0.8 });
  check(touched.held < -0.3 && Math.abs(touched.after) < 1e-6, `touch drives the wheel (${touched.held.toFixed(3)} -> ${touched.after})`);

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
  await page.mouse.move(cx(modHit), modHit.y + modHit.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(cx(modHit), modHit.y + modHit.h * 0.2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  check(Math.abs(await val("mod")) < 1e-6, "with Spring on, Mod returns to its default");
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
