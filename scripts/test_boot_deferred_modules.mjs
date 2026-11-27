// PASTE-10 blocker 1: under CPU throttling, readiness gates factory patch load and spawning until module types exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patch = JSON.parse(fs.readFileSync(path.join(root, "patches/black_and_white_shader.json"), "utf8"));
const expectedTypes = [...new Set(patch.nodes.map((node) => node.type))];
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.unref(); server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }
let server;
let browser;
try {
  const port = await freePort();
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "server.py"), "--port", String(port)], { cwd: root, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 8 });
  await page.addInitScript(() => {
    window.__moduleRegistryAtReady = null;
    window.addEventListener("nodeSandboxInterfaceReady", () => {
      const definitions = typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions : {};
      window.__moduleRegistryAtReady = {
        bootFinished: document.body.dataset.nodeBootFinished,
        readyState: document.documentElement.dataset.nodeSandboxInterfaceReady,
        registered: Object.keys(definitions),
        defaultNodeCount: window.nodeGraphMvp?.defaultPatch?.nodes?.length || 0,
      };
    }, { once: true });
  });
  const bindingErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (/Node graph event binding failed/.test(message.text())) bindingErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
  await page.goto(`${url}?mode=circuitbuilder&v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__moduleRegistryAtReady !== null, null, { timeout: 240000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 240000 });
  const ready = await page.evaluate(() => window.__moduleRegistryAtReady);
  const missingTypes = expectedTypes.filter((type) => !ready.registered.includes(type));
  assert.deepEqual(missingTypes, [], `factory patch module types registered before ready: ${JSON.stringify({ missingTypes, ready })}`);
  assert.ok(ready.defaultNodeCount > 0, `factory patch loaded before ready: ${JSON.stringify(ready)}`);

  const result = await page.evaluate((source) => {
    const patchData = loadNodeGraphPatchFromObject(source);
    commitNodeGraphPatch(patchData, { status: "throttled readiness regression", record: false, autosaveWorkingPatch: false });
    const patchTypes = [...new Set(nodeGraphMvp.patch.nodes.map((node) => node.type))];
    const patchDomMissing = nodeGraphMvp.patch.nodes.filter((node) => !nodeGraphNodeElement(node.id)).map((node) => `${node.type}:${node.id}`);
    const spawnedId = showNodeGraphModule("analogDistortion", { x: 0, y: 0 }, { record: false, autosaveWorkingPatch: false });
    const spawned = nodeGraphPatchNode(spawnedId);
    return { patchTypes, patchNodeCount: nodeGraphMvp.patch.nodes.length, patchDomMissing, spawnedType: spawned?.type, spawnedDom: Boolean(nodeGraphNodeElement(spawnedId)) };
  }, patch);
  assert.deepEqual(result.patchTypes.slice().sort(), expectedTypes.slice().sort(), `factory patch types survive immediate load: ${JSON.stringify(result)}`);
  assert.equal(result.patchDomMissing.length, 0, `every patch module has a DOM node: ${JSON.stringify(result.patchDomMissing)}`);
  assert.ok(result.spawnedType === "analogDistortion" && result.spawnedDom, `Analog Distortion spawn after readiness works: ${JSON.stringify(result)}`);
  assert.deepEqual(bindingErrors, [], `no event binding errors: ${bindingErrors.join("\n")}`);
  assert.deepEqual(pageErrors, [], `no page errors: ${pageErrors.join("\n")}`);
  console.log(`test_boot_deferred_modules: ok (${expectedTypes.length} factory types, CPU throttle x8)`);
} finally {
  await browser?.close();
  server?.kill();
}
