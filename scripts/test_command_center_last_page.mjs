// The Command Center reopens on the last page looked at (the 🚀 button, C and ` reopen; closing keeps the page). A request for a
// specific page (a right-click on a module, a nav button) still opens that page. The last page survives a reload.
// Real page on its own server.py port unless SANDBOX_URL is set.
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const boot = async () => {
    await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
    await page.waitForTimeout(1500);
  };
  await boot();

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const showing = () => nodeGraphUnifiedWindowActivePage();
    const out = {};
    // 1. Look at the rainbow page, close the Command Center, reopen it the way the 🚀 button and C do.
    openNodeGraphUnifiedWindowPage("gradients");
    await wait(150);
    out.opened = showing();
    setNodeGraphCommandCenterPresentation("closed");
    await wait(150);
    out.closed = showing();
    cycleNodeGraphCommandCenterPresentation();
    await wait(200);
    out.reopened = showing();
    // 2. Closing the page itself (its ✕) then reopening: still that page.
    closeNodeGraphUnifiedWindowPage("gradients");
    await wait(150);
    out.closedByX = showing();
    setNodeGraphCommandCenterPresentation("open");
    await wait(200);
    out.reopenedAfterX = showing();
    // 3. A request for one page (what a right-click on a module does) opens that page, not the remembered one.
    setNodeGraphCommandCenterPresentation("closed");
    await wait(150);
    openNodeGraphUnifiedWindowPage("uiSettings");
    await wait(200);
    out.specific = showing();
    // ...and that page is now the one to come back to.
    setNodeGraphCommandCenterPresentation("closed");
    await wait(150);
    setNodeGraphCommandCenterPresentation("open");
    await wait(200);
    out.afterSpecific = showing();
    // 4. Back on the rainbow page for the reload check.
    openNodeGraphUnifiedWindowPage("gradients");
    await wait(150);
    setNodeGraphCommandCenterPresentation("closed");
    await wait(150);
    if (typeof persistSession === "function") persistSession({ reason: "uiSettings" });
    await wait(400);
    return out;
  });
  assert.equal(r.opened, "gradients", `opens the rainbow page ${JSON.stringify(r)}`);
  assert.equal(r.closed, "", "closed");
  assert.equal(r.reopened, "gradients", `reopening shows the last page looked at ${JSON.stringify(r)}`);
  assert.equal(r.closedByX, "", "closing the page itself closes it");
  assert.equal(r.reopenedAfterX, "gradients", `reopening after the page's own close is still the last page ${JSON.stringify(r)}`);
  assert.equal(r.specific, "uiSettings", `a request for one page opens that page ${JSON.stringify(r)}`);
  assert.equal(r.afterSpecific, "uiSettings", `and that becomes the page to come back to ${JSON.stringify(r)}`);

  // The last page survives a reload.
  await boot();
  const afterReload = await page.evaluate(async () => {
    setNodeGraphCommandCenterPresentation("open");
    await new Promise((res) => setTimeout(res, 300));
    return nodeGraphUnifiedWindowActivePage();
  });
  assert.equal(afterReload, "gradients", "after a reload the Command Center reopens on the last page");
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_command_center_last_page: ok");
} finally {
  await browser?.close();
  server?.kill();
}
