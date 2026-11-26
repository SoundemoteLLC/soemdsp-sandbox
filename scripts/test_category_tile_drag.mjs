// HP-22: dragging a category tile out of the Modules page places that category's default module and the store stays on the
// category list (the click that follows the drag does not open the category). A plain click on a tile still opens it.
// Real page on its own server.py port (never 8765 / 8766 / 8080) unless SANDBOX_URL is set. Real mouse events.
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });

  // Open Modules on the category list.
  const tile = await page.evaluate(async () => {
    openNodeGraphUnifiedWindowPage("moduleBrowser");
    setNodeGraphModuleStoreDepartment("");
    await new Promise((r) => setTimeout(r, 120));
    // Argi's case: the Oscillator tile (default DSF Oscillator); any visible single-default tile if the id ever changes.
    const tiles = [...document.querySelectorAll("[data-store-department]")].filter((b) => {
      const types = nodeGraphModuleStoreDepartmentDefaultModules(b.dataset.storeDepartment);
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return types.length === 1 && r.width > 0 && r.height > 0 && b.contains(hit);
    });
    const button = tiles.find((b) => /oscillator/i.test(b.dataset.storeDepartment)) || tiles[0];
    const r = button.getBoundingClientRect();
    return {
      id: button.dataset.storeDepartment,
      type: nodeGraphModuleStoreDepartmentDefaultModules(button.dataset.storeDepartment)[0],
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  });
  const state = () => page.evaluate((type) => ({
    search: String(nodeGraphMvp.moduleStoreDepartmentSearch || ""),
    count: nodeGraphMvp.patch.nodes.filter((n) => n.type === type).length,
  }), tile.type);

  // 1. Real drag out of the tile onto the canvas.
  const before = await state();
  await page.mouse.move(tile.x, tile.y);
  await page.mouse.down();
  // Drop on open canvas away from the Modules panel.
  const panelBox = await page.evaluate(() => { const r = document.getElementById("nodeModuleShopView").getBoundingClientRect(); return { left: r.left, right: r.right }; });
  const dropX = panelBox.left > 500 ? panelBox.left / 2 : (panelBox.right + 1400) / 2;
  const dropY = 600;
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(tile.x + (dropX - tile.x) * i / 12, tile.y + (dropY - tile.y) * i / 12);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterDrag = await state();
  assert.equal(afterDrag.count, before.count + 1, `drag places one ${tile.type} ${JSON.stringify({ before, afterDrag, tile })}`);
  assert.equal(afterDrag.search, "", `after the drag the store stays on the category list ${JSON.stringify(afterDrag)}`);

  // 2. Plain click on the same tile still opens the category.
  const tile2 = await page.evaluate((id) => {
    const r = document.querySelector(`[data-store-department="${id}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, tile.id);
  await page.mouse.click(tile2.x, tile2.y);
  await page.waitForTimeout(100);
  const afterClick = await state();
  assert.ok(afterClick.search !== "", `a plain click opens the category ${JSON.stringify(afterClick)}`);
  assert.equal(afterClick.count, afterDrag.count, "a plain click places nothing");
  assert.deepEqual(errors, [], "no page errors");
  console.log(`test_category_tile_drag: ok (${tile.id} -> ${tile.type}: drag places it and stays on the list; click opens the category)`);
} finally {
  await browser?.close();
  server?.kill();
}
