// PASTE-7 item 1: envelope faces draw a negative Amplitude the way it sounds (HP-24 signed gain): the curve hangs down from the top
// instead of rising from the floor, same shape. Real page on its own server.py port unless SANDBOX_URL is set.
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = {};
    for (const type of ["linearAttackRelease", "curveAttackRelease", "pingEnvelope", "pluckEnvelope", "hyperbolicDecay", "ellipsoidDecay"]) {
      if (!nodeGraphModuleDefinitions[type]) continue;
      const id = showNodeGraphModule(type, { x: 100, y: 100 }, { record: false, autosaveWorkingPatch: false });
      for (let i = 0; i < 40 && !document.querySelector(`[data-node="${id}"] .node-envelope-curve-display, section[data-node="${id}"]`); i += 1) await wait(50);
      const section = [...document.querySelectorAll(`section[data-node="${id}"]`)].find((s) => s._envelopeCurveSignature !== undefined || s.querySelector("canvas"));
      if (!section) { out[type] = { missing: true }; continue; }
      const draw = (amp) => {
        const node = nodeGraphPatchNode(id);
        node.params.amplitude = amp;
        const slider = nodeGraphSliderForParameter(id, "amplitude");
        if (slider) slider.dataset.domainValue = String(amp);
        let line = null;
        const poly = window.nodeGraphGlLinesPolyline;
        window.nodeGraphGlLinesPolyline = (batch, pts, ...rest) => { if (!line) line = Array.from(pts); return poly(batch, pts, ...rest); };
        section._envelopeCurveForceDraw = true;
        drawNodeGraphEnvelopeCurveDisplayInner(section);
        window.nodeGraphGlLinesPolyline = poly;
        return line;
      };
      const up = draw(0.5);
      const down = draw(-0.5);
      if (!up || !down) { out[type] = { noLine: true }; continue; }
      // Mirror: every y of the negative curve is the positive curve's y flipped about the middle of the face (the pairs sum to the height).
      const h = up[1] + down[1];
      let worst = 0;
      for (let i = 1; i < Math.min(up.length, down.length); i += 2) worst = Math.max(worst, Math.abs((h - up[i]) - down[i]));
      out[type] = { mirrored: worst < 0.01 && up.some((v, i) => i % 2 === 1 && Math.abs(v - down[i]) > 1), worst, restUp: up[1], restDown: down[1], h };
    }
    return out;
  });
  const checked = Object.entries(r).filter(([, v]) => !v.missing && !v.noLine);
  assert.ok(checked.length >= 4, `envelope faces measured ${JSON.stringify(r)}`);
  for (const [type, v] of checked) assert.ok(v.mirrored, `${type}: a negative Amplitude draws the curve inverted ${JSON.stringify(v)}`);
  assert.deepEqual(errors, [], "no page errors");
  console.log(`test_envelope_face_signed_amp: ok (${checked.map(([t]) => t).join(", ")})`);
} finally {
  await browser?.close();
  server?.kill();
}
