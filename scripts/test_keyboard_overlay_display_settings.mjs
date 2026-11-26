#!/usr/bin/env node
// Piano Keyboard: the DOM velocity/info overlay is gone from the face.
// Mode, Min Vel, and Max Vel live in per-module Display Settings (not shared
// module settings). Live readouts are dropped. Old patches still normalize.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("ok  ", msg);
  }
};

const factories = fs.readFileSync(path.join(root, "public/node-graph-module-factories.js"), "utf8");
const bodyStart = factories.indexOf("function createNodeGraphKeyboardBody");
const bodyEnd = factories.indexOf("\nfunction ", bodyStart + 1);
check(bodyStart >= 0 && bodyEnd > bodyStart, "createNodeGraphKeyboardBody is present");
const body = factories.slice(bodyStart, bodyEnd);
check(!body.includes("node-keyboard-heading"), "face factory does not build the heading overlay");
check(!body.includes("node-keyboard-live-readouts"), "face factory does not build live freq/pitch/midi/vel readouts");
check(!body.includes("keyboardVelMin") && !body.includes("keyboardVelMax"), "face factory does not build Min/Max Vel inputs");
check(!body.includes("node-keyboard-signal-bar"), "face factory does not build the signal bar");
check(!body.includes("node-keyboard-bitmask-row"), "face factory does not build the arp bitmask row");
check(!body.includes("node-keyboard-vm-debug"), "face factory does not build vm debug");
check(body.includes("node-keyboard-surface") && body.includes("node-keyboard-performance"), "face factory still builds the WebGL key surface");

const layout = fs.readFileSync(path.join(root, "public/modules/keyboardController/keyboard-layout-settings.js"), "utf8");
const htmlStart = layout.indexOf("function buildNodeGraphKeyboardFaceDisplaySettingsBodyHtml");
const htmlEnd = layout.indexOf("function bindNodeGraphKeyboardFaceDisplaySettingsBody");
check(htmlStart >= 0 && htmlEnd > htmlStart, "Keyboard display-settings HTML builder is present");
const htmlFn = layout.slice(htmlStart, htmlEnd);
check(htmlFn.includes('data-midi-key-layout="mode"'), "display settings include Mode");
check(htmlFn.includes('data-midi-key-layout="velMin"') && htmlFn.includes("Min Vel"), "display settings include Min Vel");
check(htmlFn.includes('data-midi-key-layout="velMax"') && htmlFn.includes("Max Vel"), "display settings include Max Vel");
check(!htmlFn.includes("hideKeyboardInfo") && !htmlFn.includes("Hide keyboard info"), "Hide keyboard info checkbox is gone");
check(!htmlFn.includes("data-keyboard-signal") && !htmlFn.includes("node-keyboard-live-readouts"), "live readouts were not moved into settings");
const playSlice = htmlFn.slice(htmlFn.indexOf(">Play<"), htmlFn.indexOf(">Keys<"));
check(playSlice.includes("Mode") && !playSlice.includes("title="), "play rows have no hover title text");
check(layout.includes('classList.remove("show-keyboard-info")'), "piano Keyboard always uses the hide-info key-fill grid");
check(
  layout.includes("node-grid-keyboard-module")
    && layout.includes('classList.toggle("show-keyboard-info"'),
  "Grid Keyboard still honors hideKeyboardInfo",
);

const formIo = fs.readFileSync(path.join(root, "public/node-graph-module-scope-settings-form-io.js"), "utf8");
const readStart = formIo.indexOf('if (formType === "keyboardFace")');
const readEnd = formIo.indexOf("\n  const next = { ...current };", readStart);
check(readStart >= 0 && readEnd > readStart, "form-io has a keyboardFace reader");
check(formIo.slice(readStart, readEnd).includes("[data-midi-key-layout]"), "form-io persists Mode/Vel through data-midi-key-layout");
check(!formIo.slice(readStart, readEnd).includes("moduleSettings"), "keyboard face reader stays on display settings");

const ctx = {
  console,
  SoemMath: {
    clamp(value, min, max, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    },
  },
};
ctx.globalThis = ctx;
ctx.nodeGraphKeyboardModes = Object.freeze(["slide", "press", "hold", "toggle", "chordMemory"]);
ctx.nodeGraphKeyboardMode = (value) => (ctx.nodeGraphKeyboardModes.includes(value) ? value : "slide");
ctx.nodeGraphKeyboardModeLabel = (value) => ({
  slide: "Slide",
  press: "Press",
  hold: "Hold",
  toggle: "Toggle",
  chordMemory: "Chord Memory",
}[ctx.nodeGraphKeyboardMode(value)] || "Slide");
ctx.nodeGraphKeyboardClampVel127 = (value, fallback = 127) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.min(127, Math.round(Number(fallback) || 127)));
  }
  return Math.max(0, Math.min(127, n));
};
ctx.nodeGraphKeyboardKeyCount = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(128, n)) : 25;
};
ctx.nodeGraphKeyboardOctaveOffset = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
};
ctx.nodeGraphKeyboardNormalizeArpKeys = (value) => (value && typeof value === "object" ? value : {});
ctx.normalizeNodeGraphKeyboardMemorySignal = () => null;

vm.runInNewContext(
  layout + "\nthis.normalizeNodeGraphKeyboardLayout = normalizeNodeGraphKeyboardLayout;\nthis.buildNodeGraphKeyboardFaceDisplaySettingsBodyHtml = buildNodeGraphKeyboardFaceDisplaySettingsBodyHtml;",
  ctx,
);

const view = fs.readFileSync(path.join(root, "public/node-graph-view-controls.js"), "utf8");
const normStart = view.indexOf("function normalizeNodeGraphKeyboardFaceSettings");
const normEnd = view.indexOf("\nfunction ", normStart + 1);
check(normStart >= 0 && normEnd > normStart, "normalizeNodeGraphKeyboardFaceSettings is present");
vm.runInNewContext(
  view.slice(normStart, normEnd) + "\nthis.normalizeNodeGraphKeyboardFaceSettings = normalizeNodeGraphKeyboardFaceSettings;",
  ctx,
);

const html = ctx.buildNodeGraphKeyboardFaceDisplaySettingsBodyHtml();
check(html.includes('data-midi-key-layout="mode"'), "rendered display settings include the Mode select");
check(html.includes('data-midi-key-layout="velMin"') && html.includes('value="127"'), "rendered Min Vel defaults to 127");
check(html.includes('data-midi-key-layout="velMax"'), "rendered display settings include Max Vel");
check(html.includes(">Slide<") && html.includes(">Hold<") && !html.includes("Trigger Patch"), "Mode options use the existing labels (Trigger Patch removed in HP-01)");
check(!html.includes("Hide keyboard info") && !html.includes("freq ") && !html.includes("data-keyboard-signal"), "rendered settings omit hide-info and live readouts");

const oldPatch = ctx.normalizeNodeGraphKeyboardFaceSettings({
  hideKeyboardInfo: false,
  mode: "hold",
  velMin: 10,
  velMax: 90,
  keyLabels: "number",
  blackKeyWidth: 12,
});
check(oldPatch.hideKeyboardInfo === false, "old hideKeyboardInfo: false still loads");
check(oldPatch.mode === "hold" && oldPatch.velMin === 10 && oldPatch.velMax === 90, "old mode and vel range still load");
check(oldPatch.keyLabels === "number" && oldPatch.blackKeyWidth === 12, "old key layout settings still load");

const clamped = ctx.normalizeNodeGraphKeyboardFaceSettings({ mode: "nope", velMin: 200, velMax: -4 });
check(clamped.mode === "slide" && clamped.velMin === 127 && clamped.velMax === 0, "invalid mode/vel normalize to safe defaults");

const missing = ctx.normalizeNodeGraphKeyboardFaceSettings({ keyLabels: "name" });
check(missing.mode === undefined && missing.velMin === undefined && missing.hideKeyboardInfo === undefined, "legacy patches without play fields stay sparse and still load");

const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const panelStart = css.indexOf(".node-keyboard-panel {");
const panelEnd = css.indexOf("}", panelStart);
check(panelStart >= 0 && panelEnd > panelStart, "`.node-keyboard-panel` rule is present");
const panelRule = css.slice(panelStart, panelEnd + 1);
check(!panelRule.includes("#080a0c") && !panelRule.includes("linear-gradient"), "panel rule has no opaque gold/#080a0c fill");
check(panelRule.includes("background: transparent"), "panel rule is transparent");
check(!css.includes("linear-gradient(180deg, rgba(241, 184, 75, 0.08), transparent 48%)"), "the leftover keyboard panel gradient is gone from CSS");
check(css.includes(".node-graph-workspace.gl-graph-on .dsp-node .node-keyboard-panel"), "GL graph forces the keyboard panel transparent");
check(!css.includes(".node-keyboard-bitmask-row") && !css.includes(".node-keyboard-vm-debug"), "dead bitmask and vm-debug CSS are gone");
check(css.includes(".node-grid-keyboard-module:not(.show-keyboard-info) > .node-keyboard-heading"), "Grid Keyboard heading CSS remains");
const faceStart = css.indexOf("/* Keyboard module face:");
const faceBlock = css.slice(faceStart, css.indexOf("box-shadow: none;", faceStart) + 20);
check(faceBlock.includes("grid-template-rows: minmax(48px, 1fr)"), "piano face uses a single filling grid row");
check(!faceBlock.includes("auto minmax(0, 1fr)"), "piano face no longer uses a two-row auto+1fr grid that can collapse the keys");

async function probeComputedStyles() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    check(false, "playwright is required for the computed-style probe (" + err.message + ")");
    return;
  }
  const { createServer } = await import("node:http");
  const mime = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
  ]);
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "");
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": mime.get(path.extname(file)) || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const html = `<!doctype html>
<html><head><link rel="stylesheet" href="/public/styles.css"></head>
<body>
<div class="node-graph-workspace gl-graph-on">
  <article class="dsp-node keyboard-layout" style="position:relative;width:280px;height:160px;">
    <header class="node-drag-handle" style="height:24px"></header>
    <section class="node-keyboard-panel node-keyboard-module node-module-face" id="kbd-panel" style="position:absolute;inset:24px 0 0 0;width:100%;height:136px;">
      <div class="node-keyboard-performance" id="kbd-perf">
        <div class="node-keyboard-surface" id="kbd-surface"></div>
      </div>
    </section>
  </article>
</div>
</body></html>`;
  const tmp = path.join(root, "scripts/_tmp_kbdov2_probe.html");
  fs.writeFileSync(tmp, html);
  try {
    await page.goto("http://127.0.0.1:" + port + "/scripts/_tmp_kbdov2_probe.html");
    const probe = await page.evaluate(() => {
      const panel = document.getElementById("kbd-panel");
      const surface = document.getElementById("kbd-surface");
      const cs = getComputedStyle(panel);
      const bgImage = cs.backgroundImage;
      const bgColor = cs.backgroundColor;
      return {
        bgImage,
        bgColor,
        panelH: panel.getBoundingClientRect().height,
        surfaceH: surface.getBoundingClientRect().height,
        transparent: (bgColor === "rgba(0, 0, 0, 0)" || bgColor === "transparent")
          && (!bgImage || bgImage === "none"),
      };
    });
    check(probe.transparent, "graph keyboard panel computed style is transparent (bg=" + probe.bgColor + ", image=" + probe.bgImage + ")");
    check(probe.surfaceH >= 48 && probe.surfaceH >= probe.panelH - 2, "surface fills the face (surface " + probe.surfaceH + "px, panel " + probe.panelH + "px)");
  } finally {
    await browser.close();
    server.close();
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

await probeComputedStyles();

if (failed) {
  console.error("failed " + failed + " check(s)");
  process.exit(1);
}
console.log("ok  keyboard overlay moved to display settings; panel fill is gone");
