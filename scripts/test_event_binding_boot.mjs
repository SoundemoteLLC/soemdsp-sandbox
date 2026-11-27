// Regression: a normal boot must finish every event binder without an error.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
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
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const bindingErrors = [];
  page.on("console", (message) => {
    if (/Node graph event binding failed/.test(message.text())) bindingErrors.push(message.text());
  });
  await page.goto(`${url}?mode=circuitbuilder&v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  assert.deepEqual(bindingErrors, [], `event binding errors during boot: ${bindingErrors.join("\n")}`);
  assert.equal(await page.locator("#nodeGraphWorkspace").count(), 1, "workspace exists");
  console.log("test_event_binding_boot: ok");
} finally {
  await browser?.close();
  server?.kill();
}
