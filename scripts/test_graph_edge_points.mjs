// Step Graph + Smooth Graph: a point at any corner of the plot (top-left,
// top-right, bottom-left, bottom-right) is grabbed by a press anywhere in its
// hit circle, even where the layout-B IO rows or the module plate sit over or
// beside the plot. The module title away from points still drags the module.
//   node scripts/test_graph_edge_points.mjs
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const utils = fs.readFileSync(path.join(ROOT, "public/node-graph-graph-utils.js"), "utf8");
check(/function nodeGraphGraphEdgeHandleAtClient\(/.test(utils) && /addEventListener\("pointerdown", handleNodeGraphGraphEdgePointerDown, true\)/.test(utils),
  "graph utils route plot-edge presses to the point (document capture)");
for (const html of ["public/index.html", "public/perform.html"]) {
  check(/node-graph-graph-utils\.js\?v=[^"]*sg-edge-1"/.test(fs.readFileSync(path.join(ROOT, html), "utf8")), `${html} bumps graph utils`);
}
let fixtureSame = false;
try { execSync("git diff --quiet HEAD -- scripts/fixtures/keyboard-face-gl-draw-ops.json", { cwd: ROOT }); fixtureSame = true; } catch { fixtureSame = false; }
check(fixtureSame, "keyboard golden fixture is byte-identical to HEAD");

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const { chromium } = await import("playwright");
let server = null;
let browser = null;
let baseUrl = process.env.SANDBOX_URL || "";
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
  }
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 2400, height: 1500 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Corner Y: +1 = top, -1 = bottom (both endpoints share Y; the middle
  // point stays at 0 so only the corner points are near the plot edge).
  const layout = (cornerY) => page.evaluate(async (cornerY) => {
    const mk = (type, id, gx) => {
      const n = createNodeGraphPatchNode(type, { id, gx, gy: 3 });
      const shape = type === "stepGraph" ? "hold" : "rational";
      n.graph = { ...(n.graph || {}), nodes: [{ x: 0, y: cornerY, c: 0, shape }, { x: 0.5, y: 0, c: 0, shape }, { x: 1, y: cornerY, c: 0, shape }] };
      return n;
    };
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes: [mk("stepGraph", "step", 3), mk("smoothGraph", "smooth", 25)], cables: [] }, { status: "edge test" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    await new Promise((r) => setTimeout(r, 800));
    const out = { gl: Boolean(document.querySelector(".gl-graph-on")) };
    for (const id of ["step", "smooth"]) {
      const art = document.querySelector(`.dsp-node[data-node="${id}"]`);
      const disp = art?.querySelector(".node-module-graph-display");
      const t = art?.querySelector(".node-header-title")?.getBoundingClientRect();
      const d = disp?.getBoundingClientRect();
      out[id] = {
        // Just outside each jack's module edge (where the jack hit area reaches past the module rect).
        jacks: [...(art?.querySelectorAll(".node-io-row .node-port") || [])].map((port) => {
          const b = port.getBoundingClientRect();
          const out = port.classList.contains("output");
          return { out, port: port.dataset.port, box: [b.left, b.top, b.width, b.height].map(Math.round), x: out ? b.right + 4 : b.left - 4, y: b.top + b.height / 2 };
        }),
        title: t ? { x: t.left + t.width / 2, y: t.top + t.height / 2 } : null,
        display: d ? { left: d.left, top: d.top, right: d.right, bottom: d.bottom } : null,
        pts: [...(disp?.querySelectorAll(".node-module-graph-node-hit") || [])].map((c) => {
          const b = c.getBoundingClientRect();
          return { i: Number(c.dataset.graphNodeIndex), x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(b.width, b.height) / 2 };
        }),
      };
    }
    return out;
  }, cornerY);
  const state = () => page.evaluate(() => ({
    point: nodeGraphMvp.graphNodeDragging ? nodeGraphMvp.graphNodeDragging.index : null,
    module: Boolean(nodeGraphMvp.nodeDragging),
    wire: Boolean(nodeGraphMvp.wireDragging || nodeGraphMvp.portMovePointer),
  }));
  const press = async (x, y) => {
    const under = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).trim().split(/\s+/)[0]}` : "none";
    }, { x, y });
    await page.mouse.move(x, y);
    await page.mouse.down();
    const s = await state();
    await page.mouse.up();
    await page.waitForTimeout(450); // past the double-click window
    return { ...s, under };
  };

  const jackRef = {};
  for (const [cornerY, edge] of [[-1, "bottom"], [1, "top"]]) {
    const L = await layout(cornerY);
    check(L.gl, `GL graph mode on (${edge} corners)`);
    for (const id of ["step", "smooth"]) {
      const name = id === "step" ? "Step Graph" : "Smooth Graph";
      const info = L[id];
      check(info.pts.length === 3 && info.display, `${name}: three points on screen (${edge})`);
      for (const p of info.pts.filter((q) => q.i !== 1)) {
        const side = p.i === 0 ? "left" : "right";
        check(Math.abs(p.y - (cornerY > 0 ? info.display.top : info.display.bottom)) < p.r + 2,
          `${name}: ${edge}-${side} point sits on the plot edge`);
        // Centre, and 70% of the hit radius toward and away from each edge.
        const k = p.r * 0.7;
        for (const [dx, dy, label] of [[0, 0, "centre"], [0, -k, "above"], [0, k, "below"], [-k, 0, "left"], [k, 0, "right"]]) {
          const r = await press(p.x + dx, p.y + dy);
          const outsideModule = (side === "left" && dx < 0) || (side === "right" && dx > 0);
          if (outsideModule) {
            // Outside the module rect is the jack's / wire layer's, not the point's.
            check(r.point === null || r.point === p.i, `${name}: ${edge}-${side} ${label} (outside the module) does not grab another point [${r.under}]`);
            continue;
          }
          check(r.point === p.i && !r.module, `${name}: ${edge}-${side} point grabbed at ${label} [${r.under}] (point ${r.point}, module ${r.module})`);
        }
      }
      const mid = info.pts.find((q) => q.i === 1);
      if (mid) {
        const r = await press(mid.x, mid.y);
        check(r.point === 1 && !r.module, `${name}: middle point still grabbed (${edge})`);
      }
      // Jack presses just outside the module must do exactly what they do
      // when no point is near (the bottom-corner layout is the reference).
      for (const j of info.jacks) {
        const r = await press(j.x, j.y);
        const key = `${id}:${j.out ? "out" : "in"}:${j.port}`;
        if (cornerY > 0) {
          check(JSON.stringify(jackRef[key]) === JSON.stringify(r) && r.point === null,
            `${name}: ${j.out ? "output" : "input"} jack ${j.port} beside the corner point acts as with no point near (${JSON.stringify(r)})`);
        } else {
          jackRef[key] = r;
        }
      }
      if (info.title) {
        const r = await press(info.title.x, info.title.y);
        check(r.module && r.point === null, `${name}: title away from points still drags the module [${r.under}] (${edge})`);
      }
    }
  }
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
