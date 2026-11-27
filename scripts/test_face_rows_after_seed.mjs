// SPECTRAL_FACE_FIX_PLAN 2 and 3: every face rect (fills, handles) is drawn on the over layer, also below a Seed row. The seed widget
// wraps itself in the over layer and switched it OFF on the way out, so every row below it (Spectral Smear / Cloud / Warble's Mix, Amp
// and Curve, Hypersaw 2's last row) lost its fill and handle under the plate; only the text showed. Draws each face into a recording
// batch (the GL line calls stubbed) and checks the layer of each rect. Real page on its own server.py port unless SANDBOX_URL.
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  const types = ["hypersaw2", "spectralSmear", "spectralBlur", "spectralWarble"];
  const r = await page.evaluate(async (list) => {
    const out = {};
    let x = 80;
    for (const type of list) {
      const id = showNodeGraphModule(type, { x, y: 120 }, { record: false, autosaveWorkingPatch: false });
      x += 360;
      await new Promise((res) => setTimeout(res, 400));
      const el = nodeGraphNodeElement(id);
      const face = el.querySelector(":scope > .dsp-node-body > .node-face");
      const laid = nodeGraphModuleLayoutBox(face, el);
      // Where the seed row ends (face px): rects below it are the ones the bug hid.
      const widgets = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpecForElement(el), laid.w, el);
      const seed = (widgets || []).find((w) => w.type === "seedNumber");
      const seedBottom = seed ? seed.y + seed.h : Infinity;
      const saved = {};
      const rects = [];
      const batch = { _over: true, camera: true };
      for (const name of Object.keys(window).filter((k) => k.startsWith("nodeGraphGlLines") && typeof window[k] === "function")) {
        saved[name] = window[name];
        window[name] = name === "nodeGraphGlLinesRect"
          ? (b, rx, ry, rw, rh) => { rects.push({ over: b._over === true, y: ry }); }
          : () => undefined;
      }
      try {
        nodeGraphModuleFaceDrawGl(batch, el, laid.w, 0, 0, 1);
      } finally {
        for (const [name, fn] of Object.entries(saved)) window[name] = fn;
      }
      out[type] = {
        rects: rects.length,
        below: rects.filter((q) => q.y >= seedBottom).length,
        offLayer: rects.filter((q) => !q.over).length,
        endsOn: batch._over,
        seed: Boolean(seed),
      };
    }
    return out;
  }, types);
  for (const type of types) {
    const s = r[type];
    assert.ok(s && s.rects > 0 && s.seed, `${type}: the face draws, with a seed row ${JSON.stringify(s)}`);
    assert.equal(s.offLayer, 0, `${type}: every face rect is on the over layer ${JSON.stringify(s)}`);
    assert.equal(s.endsOn, true, `${type}: the face leaves the over layer as it found it ${JSON.stringify(s)}`);
  }
  assert.ok(r.hypersaw2.below > 0, `hypersaw2 has rects below its seed row (the case the bug hid) ${JSON.stringify(r.hypersaw2)}`);
  assert.deepEqual(errors, [], "no page errors");
  console.log(`test_face_rows_after_seed: ok ${JSON.stringify(r)}`);
} finally {
  await browser?.close();
  server?.kill();
}
