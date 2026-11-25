// HP-21: Trail and Ghost both default to 0 on every phosphor display, and Rounding Error exposes its Trail.
// Real page (own server.py on a free port, never 8765 / 8766 / 8080, unless SANDBOX_URL is set).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(ROOT, "package.json"))("playwright")); }
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let server = null; let browser = null;
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const b = page.locator("#nodeBootStartButton"); if (await b.count()) await b.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const types = ["hypersawBurn", "lineBurn", "scope2d", "scope1dTrace", "scope2dTrace", "videoscopeBurn", "phosphorLight", "xyPad", "vectorRgbFace", "gradientVectorscopeFace", "arpKeysFace", "dot", "numberReadout", "roundingErrorFace", "value"];
    const out = { rows: {}, shared: { residual: [PhosphorResidual.DEFAULT_TRAIL, PhosphorResidual.DEFAULT_GHOST], bag: [nodeGraphScopePhosphorLookDefaults.trail, nodeGraphScopePhosphorLookDefaults.ghost] } };
    for (const type of types) {
      let d = null;
      try { d = nodeGraphDisplaySettingsDefaultsForFormType(type); } catch (error) { d = { error: String(error.message) }; }
      out.rows[type] = d && !d.error ? { trail: d.trail, ghost: d.ghost, fadeTime: d.fadeTime, residual: d.residual, ghostBrightness: d.ghostBrightness } : (d || null);
    }
    // per-module hypersawBurn bags (Hypersaw, Robin Supersaw, Ping Pong Delay Lines, ...)
    out.hypersaw = {};
    for (const type of ["hypersaw2", "robinSupersaw", "pingPongDelay"]) {
      if (typeof nodeGraphHypersawBurnDefaultsForModuleType === "function") {
        const d = nodeGraphHypersawBurnDefaultsForModuleType(type);
        out.hypersaw[type] = d ? { trail: d.trail, ghost: d.ghost } : null;
      }
    }
    // a new Hypersaw and a new Rounding Error as the user gets them
    const o = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const hs = showNodeGraphModule("hypersaw2", { x: 3, y: 1 }, o);
    const re = showNodeGraphModule("blitTrigger", { x: 12, y: 1 }, o);
    const hsSettings = nodeGraphHypersawBurnSettingsForNode(nodeGraphPatchNode(hs));
    const reSettings = nodeGraphRoundingErrorFaceSettingsForNode(nodeGraphPatchNode(re));
    out.spawned = { hypersaw: { trail: hsSettings.trail, ghost: hsSettings.ghost, display: nodeGraphModuleDisplayRendererForNode(nodeGraphPatchNode(hs)) }, roundingError: { trail: reSettings.fadeTime, ghost: reSettings.ghost, display: nodeGraphModuleDisplayRendererForNode(nodeGraphPatchNode(re)) } };
    // Rounding Error exposes Trail where it exposes Ghost: both are in its control list, and the field is labelled Trail
    out.reFields = nodeGraphTraceDisplayActiveControlsByType.roundingErrorFace.fields.slice();
    const row = nodeGraphDisplaySettingsBuildStepperRowHtml("fadeTime", "roundingErrorFace");
    out.reTrailRow = { label: /Trail \(s\)/.test(row), hoverTitle: /title="[^"]+"/.test(row) };
    return out;
  });
  for (const [type, d] of Object.entries(result.rows)) {
    assert.ok(d && !d.error, `${type} has defaults (${JSON.stringify(d)})`);
    if (type === "roundingErrorFace") { assert.equal(d.fadeTime, 0, "Rounding Error Trail defaults to 0"); assert.equal(d.ghost, 0, "Rounding Error Ghost defaults to 0"); continue; }
    assert.equal(d.trail, 0, `${type} Trail defaults to 0`);
    assert.equal(d.ghost, 0, `${type} Ghost defaults to 0`);
  }
  assert.deepEqual(result.shared.residual, [0, 0], "PhosphorResidual defaults are 0 / 0");
  assert.deepEqual(result.shared.bag, [0, 0], "the shared look bag is 0 / 0");
  for (const [type, d] of Object.entries(result.hypersaw)) if (d && Number.isFinite(d.trail)) assert.equal(d.trail + d.ghost, 0, `${type} burn bag`);
  assert.deepEqual(result.spawned.hypersaw, { trail: 0, ghost: 0, display: "hypersawBurn" }, "a new Hypersaw starts at Trail 0 and Ghost 0");
  assert.deepEqual(result.spawned.roundingError, { trail: 0, ghost: 0, display: "roundingErrorFace" }, "a new Rounding Error starts at Trail 0 and Ghost 0");
  assert.ok(result.reFields.includes("fadeTime") && result.reFields.includes("ghost"), "Rounding Error exposes Trail next to Ghost");
  assert.equal(result.reTrailRow.label, true, "and it is labelled Trail");
  assert.equal(result.reTrailRow.hoverTitle, false, "with no hover text");
  console.log("ok  Trail and Ghost default to 0 on", Object.keys(result.rows).length, "display types; Rounding Error exposes Trail");
  assert.deepEqual(errors, [], "no page errors");
} finally { if (browser) await browser.close().catch(() => {}); if (server) server.kill(); }
