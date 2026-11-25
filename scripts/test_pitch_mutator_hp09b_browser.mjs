// HP-09b on the real page (own server.py on a free port, never 8765 / 8766 / 8080, unless SANDBOX_URL is set).
//  - every C label on the Mutator keyboard is stacked (octave over letter) and fully inside its own key, in the default and the 0-127 views, desktop and phone width
//  - the lowest C reads C-2 and MIDI 60 reads C3 (the shared helper)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(path.join(ROOT, "package.json"))("playwright")); }
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : "";
if (shots) fs.mkdirSync(shots, { recursive: true });

let server = null;
let browser = null;
let step = "";
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 240; i += 1) {
      try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const patch = nodeGraphMvp.patch; const n = patch && patch.nodes ? patch.nodes.length : -1; const now = performance.now();
    if (!window.__settle || window.__settle.patch !== patch || window.__settle.n !== n) window.__settle = { patch, n, since: now };
    return now - window.__settle.since > 2000;
  }, null, { timeout: 120000, polling: 100 });

  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const pm = showNodeGraphModule("pitchMutator", { x: 60, y: 60 }, options);
    const flt = showNodeGraphModule("flowerChildFilter", { x: 700, y: 60 }, options);
    return { pm, flt };
  });
  await page.waitForFunction((i) => !!document.querySelector(`.dsp-node[data-node="${i.pm}"] input[data-param="playhead"]`), ids);
  if (!(await page.locator("#nodeSceneContextMenu").isVisible())) await page.locator("#nodeCommandCenterButton").click();
  await page.locator('#nodeSceneContextMenu [data-unified-action="mutators"]').click();
  await page.waitForFunction(() => !document.getElementById("pitchMutatorOverlay").hidden && !!document.querySelector("#pitchMutatorOverlay .pm-key"));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const O = "#pitchMutatorOverlay";
  const check = async (label) => {
    const result = await page.evaluate(() => {
      const kbd = document.querySelector("#pitchMutatorOverlay .pm-kbd").getBoundingClientRect();
      const bad = []; let count = 0; const samples = {};
      for (const key of document.querySelectorAll("#pitchMutatorOverlay .pm-key")) {
        const n = Number(key.dataset.note);
        const oct = key.querySelector(".pm-key-oct"), letter = key.querySelector(".pm-key-letter");
        if (n % 12 !== 0) { if (oct || letter || key.textContent.trim()) bad.push(`${n}: unlabeled key has text`); continue; }
        count += 1;
        if (!oct || !letter) { bad.push(`${n}: not stacked`); continue; }
        const k = key.getBoundingClientRect(), a = oct.getBoundingClientRect(), b = letter.getBoundingClientRect();
        const eps = 0.6;
        if (a.left < k.left - eps || a.right > k.right + eps || b.left < k.left - eps || b.right > k.right + eps) bad.push(`${n}: label wider than its key (${a.width.toFixed(1)}/${b.width.toFixed(1)} in ${k.width.toFixed(1)})`);
        if (a.top < k.top - eps || b.bottom > k.bottom + eps) bad.push(`${n}: label clipped vertically`);
        if (b.top < a.bottom - eps) bad.push(`${n}: letter is not below the octave`);
        if (k.bottom > kbd.bottom + eps) bad.push(`${n}: key cut off at the bottom`);
        if (n === 0 || n === 60) samples[n] = [oct.textContent, letter.textContent];
      }
      return { bad, count, samples, size: getComputedStyle(document.querySelector("#pitchMutatorOverlay .pm-key-oct")).fontSize };
    });
    assert.deepEqual(result.bad, [], `${label}: ${result.bad.join("; ")}`);
    assert.ok(result.count >= 10, `${label}: the Cs are labeled (${result.count})`);
    assert.deepEqual(result.samples[0], ["-2", "C"], `${label}: the lowest C reads C-2 (octave over letter)`);
    assert.deepEqual(result.samples[60], ["3", "C"], `${label}: MIDI 60 reads C3`);
    return result;
  };
  step = "default view";
  await check("default view");
  step = "0-127 view";
  await page.locator(`${O} [data-pm="view-all"]`).click();
  await page.waitForFunction(() => document.querySelector("#pitchMutatorOverlay").style.getPropertyValue("--pm-visible") === "128");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const all = await check("0-127 view");
  if (shots) await page.screenshot({ path: path.join(shots, "hp09b-all.png") });
  step = "phone width";
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await check("phone width, 0-127 view");
  await page.locator(`${O} [data-pm="view-c0c8"]`).click();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await check("phone width, default view");
  if (shots) await page.screenshot({ path: path.join(shots, "hp09b-phone.png") });
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_pitch_mutator_hp09b_browser: ok (font " + all.size + " at 128 keys on desktop)");
} catch (error) {
  console.error(`FAILED at "${step}": ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
