// PASTE-10 Step 0: real pointer gestures recover after boot (pan, zoom, MIDI store drag-in).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  const bindingErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (/Node graph event binding failed/.test(message.text())) bindingErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
  await page.goto(`${url}?mode=circuitbuilder&v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  assert.deepEqual(bindingErrors, [], `no event binding errors: ${bindingErrors.join("\n")}`);

  const empty = await page.evaluate(() => {
    const ws = document.getElementById("nodeGraphWorkspace");
    const r = ws.getBoundingClientRect();
    const nodes = [...ws.querySelectorAll(".dsp-node:not(.removed)")].map((el) => el.getBoundingClientRect());
    const overlays = [...document.querySelectorAll(".node-command-center-dock, .node-workspace-toolbar")].map((el) => el.getBoundingClientRect());
    for (let y = r.top + 28; y < r.bottom - 28; y += 32) for (let x = r.left + 28; x < r.right - 28; x += 32) {
      const box = (b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      if (!nodes.some(box) && !overlays.some(box)) return { x, y };
    }
    throw new Error("could not find empty workspace point");
  });
  const beforePan = await page.evaluate(() => ({ ...nodeGraphMvp.pan }));
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down({ button: "middle" });
  const panStarted = await page.evaluate(() => ({ active: Boolean(nodeGraphMvp.workspacePanning) }));
  await page.mouse.move(empty.x + 90, empty.y + 55, { steps: 8 });
  const panDuring = await page.evaluate(() => ({ active: Boolean(nodeGraphMvp.workspacePanning), pan: { ...nodeGraphMvp.pan } }));
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(120);
  const afterPan = await page.evaluate(() => ({ ...nodeGraphMvp.pan }));
  assert.ok(Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y) > 20,
    `middle drag pans the workspace (${JSON.stringify({ empty, panStarted, panDuring, beforePan, afterPan })})`);

  const beforeZoom = await page.evaluate(() => nodeGraphZoom());
  await page.mouse.move(empty.x + 250, empty.y + 100);
  await page.mouse.wheel(0, -240);
  const afterZoom = await page.evaluate(() => nodeGraphZoom());
  assert.ok(Math.abs(afterZoom - beforeZoom) > 0.01, `workspace wheel zooms (${beforeZoom} -> ${afterZoom})`);

  await page.evaluate(() => {
    openNodeGraphUnifiedWindowPage("moduleBrowser");
    const panel = document.getElementById("nodeModuleShopView");
    panel.style.left = "10px"; panel.style.top = "58px";
    setNodeGraphModuleStoreDepartment("controller");
  });
  const midi = await page.locator('#nodeModuleShopView [data-context-module="keyboardController"]').count();
  assert.equal(midi, 1, "the MIDI module is available as a store drag source");
  const source = await page.locator('#nodeModuleShopView [data-context-module="keyboardController"]').boundingBox();
  const target = await page.evaluate(() => {
    const r = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
    return { x: r.right - 45, y: r.top + r.height * 0.55 };
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(source.x + source.width / 2 + (target.x - source.x - source.width / 2) * i / 12,
    source.y + source.height / 2 + (target.y - source.y - source.height / 2) * i / 12);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const placed = await page.evaluate(() => ({
    count: nodeGraphMvp.patch.nodes.filter((node) => node.type === "keyboardController").length,
    placing: Boolean(nodeGraphMvp.modulePlacement),
  }));
  assert.ok(placed.count > 0 && !placed.placing, `dragging MIDI from the store places it and ends placement (${JSON.stringify(placed)})`);
  assert.deepEqual(pageErrors, [], `no page errors: ${pageErrors.join("\n")}`);
  console.log("test_paste10_pointer_recovery: ok (boot, middle pan, workspace wheel zoom, MIDI store drag-in)");
} finally {
  await browser?.close();
  server?.kill();
}
