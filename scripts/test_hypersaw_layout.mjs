// HP-20: Hypersaw (hypersaw2) layout only. Every parameter is on the face exactly once, the Jitter params sit together (and the Vibrato
// params together), pairs share a row, and the parameter definitions (the limits and what each does) are untouched. Real page (own
// server.py on a free port, never 8765 / 8766 / 8080, unless SANDBOX_URL is set). The "before" is the module definitions at 54a79498, the commit before the face landed.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(ROOT, "package.json"))("playwright")); }
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

// the definitions as they were before the layout change: the file at the commit before the one that gave Hypersaw a face
const rev = process.env.BASELINE_REV || "54a79498";
let before = "";
try { before = execFileSync("git", ["show", `${rev}:public/node-graph-module-definitions.js`], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); } catch { /* not committed yet: compare with HEAD */ }
if (!before) before = execFileSync("git", ["show", "HEAD:public/node-graph-module-definitions.js"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

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
  await page.waitForTimeout(1500);
  const r = await page.evaluate((beforeText) => {
    const now = nodeGraphModuleDefinitions.hypersaw2;
    // the old definitions, evaluated in their own function scope so nothing global is redeclared
    const oldDefs = new Function(`${beforeText}\nreturn nodeGraphModuleDefinitions;`)();
    const old = oldDefs.hypersaw2;
    const keyOf = (p) => (typeof p === "string" ? p : p.key);
    const faceKeys = [];
    for (const row of now.face || []) {
      if (row.kind === "cells") for (const cell of row.params) faceKeys.push(cell[0]);
      else if (row.kind === "choices" || row.kind === "seed") faceKeys.push(row.param);
    }
    const paramKeys = now.parameters.map(keyOf);
    const sameDef = (key) => JSON.stringify(now.parameters.find((p) => keyOf(p) === key)) === JSON.stringify(old.parameters.find((p) => keyOf(p) === key));
    return {
      hasFace: Array.isArray(now.face) && now.face.length > 0, faceKeys, paramKeys, oldKeys: old.parameters.map(keyOf),
      pairRows: (now.face || []).filter((row) => row.kind === "cells" && row.params.length === 2).length,
      changedDefs: paramKeys.filter((k) => !sameDef(k)),
      jitterOrder: paramKeys.map((k, i) => (/^jitter/.test(k) ? i : -1)).filter((i) => i >= 0),
      vibratoOrder: paramKeys.map((k, i) => (/^vibrato/.test(k) ? i : -1)).filter((i) => i >= 0),
      faceJitter: faceKeys.map((k, i) => (/^jitter/.test(k) ? i : -1)).filter((i) => i >= 0),
      faceVibrato: faceKeys.map((k, i) => (/^vibrato/.test(k) ? i : -1)).filter((i) => i >= 0),
      hardcoded: JSON.stringify(now.face).match(/"(min|max|mid)"/g),
    };
  }, before);
  assert.ok(r.hasFace, "Hypersaw has a face");
  assert.deepEqual([...r.faceKeys].sort(), [...r.paramKeys].sort(), "every parameter is on the face");
  assert.equal(new Set(r.faceKeys).size, r.faceKeys.length, "and exactly once");
  assert.deepEqual([...r.paramKeys].sort(), [...r.oldKeys].sort(), "no parameter added or removed");
  assert.deepEqual(r.changedDefs, [], "definitions (limits, defaults, curves, tooltips) are untouched: layout only");
  const contiguous = (idx) => idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  assert.equal(r.jitterOrder.length, 5, "five Jitter parameters");
  assert.ok(contiguous(r.jitterOrder), `the Jitter params sit together in the parameter list (${r.jitterOrder})`);
  assert.ok(contiguous(r.faceJitter), `and on the face (${r.faceJitter})`);
  assert.ok(contiguous(r.vibratoOrder) && contiguous(r.faceVibrato), "the Vibrato params sit together too");
  assert.ok(r.pairRows >= 4, `pairs share a row (${r.pairRows} two-up rows)`);
  assert.equal(r.hardcoded, null, "no range is written into the face");
  assert.deepEqual(errors, [], "no page errors");
  console.log(`ok  Hypersaw face: ${r.faceKeys.length} params once each, Jitter together, ${r.pairRows} paired rows, definitions unchanged`);
} finally { if (browser) await browser.close().catch(() => {}); if (server) server.kill(); }
