// SPECTRAL_FACE_FIX_PLAN 4, 5 and 5b on every spectral module:
//   - Curve is not a param, a face cell or a jack any more; it is a Display Settings field (spectralFrequencyCurve) on the spectral
//     style faces and on Spectral Prism, and the face draws with it;
//   - Seed is the last param and the last face row (Cloud, Warble, Smear, Prism);
//   - Smear puts Diffusion, Diffusion Speed and Phase Smooth on one row; no face row holds more than 4 controls.
// Real page on its own server.py port unless SANDBOX_URL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }

const SPECTRAL = ["spectralBlur", "spectralWarble", "spectralSmear", "spectralWarp", "spectralCrossSynthesis", "spectralDelay",
  "spectralFreeze", "spectralContrast", "spectralGate", "spectralPrism"];
const SEEDED = ["spectralBlur", "spectralWarble", "spectralSmear", "spectralPrism"];

let server = null;
let browser = null;
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "server.py"), "--port", String(port)], { cwd: root, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(baseUrl)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  // Definitions and faces.
  const defs = await page.evaluate((types) => Object.fromEntries(types.map((t) => {
    const def = nodeGraphModuleDefinitions[t];
    const face = def?.face || [];
    return [t, {
      exists: Boolean(def),
      params: (def?.parameters || []).map((p) => p.key),
      rows: face.map((r) => (r.kind === "cells" ? r.params.map((c) => c[0]) : r.kind === "seed" ? ["seed"] : r.param ? [r.param] : [])),
      kinds: face.map((r) => r.kind),
      displayType: def?.displayType || "",
    }];
  })), SPECTRAL);
  for (const type of SPECTRAL) {
    const d = defs[type];
    assert.ok(d.exists, `${type} is defined`);
    assert.ok(!d.params.includes("frequencyCurve"), `${type}: Curve is no longer a param ${JSON.stringify(d.params)}`);
    assert.ok(!d.rows.flat().includes("frequencyCurve"), `${type}: Curve is not on the face`);
    for (const row of d.rows) assert.ok(row.length <= 4, `${type}: at most 4 controls per row ${JSON.stringify(row)}`);
  }
  for (const type of SEEDED) {
    const d = defs[type];
    assert.equal(d.params.at(-1), "seed", `${type}: Seed is the last param ${JSON.stringify(d.params)}`);
    assert.equal(d.kinds.at(-1), "seed", `${type}: Seed is the last face row ${JSON.stringify(d.kinds)}`);
  }
  assert.ok(defs.spectralSmear.rows.some((r) => JSON.stringify(r) === JSON.stringify(["diffusion", "diffusionSpeedHz", "phaseSmoothMs"])),
    `Smear: Diffusion, Diffusion Speed and Phase Smooth share one row ${JSON.stringify(defs.spectralSmear.rows)}`);

  // Display Settings: the Curve field, set through the form's own stepper, lands in the node's display settings and the face uses it.
  const curve = await page.evaluate(async (types) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    let x = 80;
    for (const type of types) {
      const id = showNodeGraphModule(type, { x, y: 140 }, { record: false, autosaveWorkingPatch: false });
      x += 320;
      await wait(300);
      openNodeGraphTraceDisplaySettings(id, {});
      for (let i = 0; i < 40 && !document.querySelector('[data-trace-display-field="spectralFrequencyCurve"]'); i += 1) await wait(100);
      const field = document.querySelector('[data-trace-display-field="spectralFrequencyCurve"]');
      const row = field?.closest("[data-trace-display-control-row]");
      const minus = document.querySelector('[data-trace-display-step-target="spectralFrequencyCurve"][data-trace-display-step-direction="-1"]');
      const before = field ? Number(field.value) : NaN;
      minus?.click();
      await wait(200);
      const node = nodeGraphPatchNode(id);
      const stored = Number(node.traceDisplaySettings?.spectralFrequencyCurve);
      const normalized = type === "spectralPrism"
        ? normalizeNodeGraphSpectralPrismSettings(node.traceDisplaySettings).spectralFrequencyCurve
        : normalizeNodeGraphSpectralStyleSettings(node.traceDisplaySettings, node).spectralFrequencyCurve;
      out[type] = { field: Boolean(field), label: row?.textContent.replace(/[-+]/g, "").trim(), before, stored, normalized,
        param: Object.hasOwn(node.params || {}, "frequencyCurve") };
      if (typeof closeNodeGraphTraceDisplaySettings === "function") closeNodeGraphTraceDisplaySettings();
      await wait(100);
    }
    return out;
  }, ["spectralSmear", "spectralContrast", "spectralPrism"]);
  for (const [type, c] of Object.entries(curve)) {
    assert.ok(c.field && c.label === "Curve", `${type}: Display Settings has a Curve field ${JSON.stringify(c)}`);
    assert.ok(c.before === 1 && c.stored < 1 && c.normalized === c.stored, `${type}: the Curve field sets the display spacing ${JSON.stringify(c)}`);
    assert.equal(c.param, false, `${type}: no Curve param on the node`);
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("test_spectral_face_layout: ok");
} finally {
  await browser?.close();
  server?.kill();
}
