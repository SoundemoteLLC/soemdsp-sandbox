// Right-click on a module's title opens that module's Module Settings (real mouse, through the GL hit layer). A right-click elsewhere
// on the module still only selects it and leaves the Command Center page alone. Real page on its own server.py port unless SANDBOX_URL.
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

  const spot = await page.evaluate(async () => {
    const id = showNodeGraphModule("polyBlep", { x: 300, y: 300 }, { record: false, autosaveWorkingPatch: false });
    if (typeof frameNodeGraphPatchViewAfterLoad === "function") frameNodeGraphPatchViewAfterLoad();
    setNodeGraphCommandCenterPresentation("closed");
    await new Promise((r) => setTimeout(r, 500));
    const el = nodeGraphNodeElement(id);
    const title = el.querySelector(".node-header-title-row") || el.querySelector(".node-header-title");
    const t = title.getBoundingClientRect();
    const row = el.querySelector(".node-parameter-row") || el;
    const n = el.getBoundingClientRect();
    return { id, title: { x: t.left + t.width / 2, y: t.top + t.height / 2 }, body: { x: n.left + n.width / 2, y: n.bottom - 6 } };
  });
  const state = () => page.evaluate((id) => ({
    page: nodeGraphUnifiedWindowActivePage(),
    selected: [...(nodeGraphMvp.selectedNodeIds || nodeGraphMvp.selectedNodes || [])].map(String).includes(id) || nodeGraphMvp.selectedNodeId === id,
  }), spot.id);

  // Right-click on the body: select only, no page.
  await page.mouse.click(spot.body.x, spot.body.y, { button: "right" });
  await page.waitForTimeout(300);
  const body = await state();
  assert.notEqual(body.page, "moduleActions", `a right-click off the title does not open Module Settings ${JSON.stringify(body)}`);

  // Right-click on the title: Module Settings for this module.
  await page.mouse.click(spot.title.x, spot.title.y, { button: "right" });
  await page.waitForTimeout(400);
  const title = await state();
  assert.equal(title.page, "moduleActions", `a right-click on the title opens Module Settings ${JSON.stringify(title)}`);
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_title_right_click_module_settings: ok");
} finally {
  await browser?.close();
  server?.kill();
}
