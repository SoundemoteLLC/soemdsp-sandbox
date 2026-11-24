// Step / Smooth Graph point editor (graph-point-editor-1).
//  - Typed-value expressions (node-graph-value-expression.js): absolute math,
//    every entry is the value itself (2-3, 0.5 -0.23, -0.5), invalid input -> NaN.
//  - Faces carry no DOM point fields; the editor lives on Display Settings,
//    shows only the selected point, follows face selection/drags live, and
//    edits the graph (shared slider-engine modifiers, type-in with math,
//    clamps, X order, undo). Smooth Graph has Tension, Step Graph Skew + Shape.
//   node scripts/test_graph_point_editor.mjs
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;

// ---- expressions (vm) ---------------------------------------------------------
{
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const rel of ["public/node-graph-slider-metadata.js", "public/node-graph-value-expression.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
  }
  const ev = (text, cur) => ctx.nodeGraphEvaluateValueExpression(text, cur);
  const cases = [
    ["0.25", 0, 0.25], [" 0.5 ", 0, 0.5], ["0.5*3-1", 0, 0.5], ["(1+2)/4", 0, 0.75], ["1e-3", 0, 0.001],
    ["2*(0.25+0.25)", 0, 1], ["2-3", 0.7, -1], ["0.5 -0.23", 0.7, 0.27], ["0.5 - 0.23", 0.7, 0.27],
    ["-0.5", 0.9, -0.5], ["+0.5", 0.9, 0.5], ["-1", 0.5, -1], ["-(0.1*2)", 0.5, -0.2], ["-0.5*2", 0.9, -1],
    ["0.5+-0.25", 0, 0.25], ["=0.5*3-1", 9, 0.5], ["=-0.5", 0.9, -0.5], ["(-0.5)", 0.9, -0.5],
    ["\u22120.2", 0.5, -0.2], ["2\u00d73", 0.1, 6], ["0,5", 0, 0.5],
  ];
  for (const [text, cur, want] of cases) {
    const got = ev(text, cur);
    check(near(got, want, 1e-9), `expression ${JSON.stringify(text)} on ${cur} = ${want} (got ${got})`);
  }
  for (const [text, cur] of [["", 0], ["abc", 0], ["1+", 0], ["/0", 1], ["2**3", 1], ["alert(1)", 0], ["((1)", 0], ["*", 1], ["-", 1], ["+-", 1], ["*2", 0.3], ["/4", 1], ["*(1+1)", 0.2], ["*-1", 0.4], ["=", 1], ["=*2", 1], ["1/0", 0], ["Infinity", 0], ["0x10", 0]]) {
    check(Number.isNaN(ev(text, cur)), `expression ${JSON.stringify(text)} is rejected (NaN)`);
  }
  const src = fs.readFileSync(path.join(ROOT, "public/node-graph-value-expression.js"), "utf8");
  check(!/\beval\s*\(|new Function|Function\(/.test(src), "expression evaluator uses no eval / Function");
}

// ---- static -----------------------------------------------------------------
{
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  check(!read("public/node-graph-module-rendering.js").includes("mountNodeGraphGraphPointStrip"), "graph faces mount no DOM point strip");
  check(!read("public/styles.css").includes(".node-module-graph-point-strip"), "no point-strip CSS");
  const editor = read("public/node-graph-graph-point-editor.js");
  check(/bindNodeSliderDragSurface\(surface\)/.test(editor) && /registerNodeSliderValueSink\(/.test(editor), "editor fields use the shared drag engine (bindNodeSliderDragSurface + value sink)");
  check(!/\.title\s*=|setAttribute\(\s*["']title["']/.test(editor), "editor sets no hover titles");
  for (const html of ["public/index.html", "public/perform.html"]) {
    const t = read(html);
    check(/node-graph-value-expression\.js\?v=/.test(t) && /node-graph-graph-point-editor\.js\?v=/.test(t), `${html} loads the expression + point editor scripts`);
  }
  let fixtureSame = false;
  try { execSync("git diff --quiet HEAD -- scripts/fixtures/keyboard-face-gl-draw-ops.json", { cwd: ROOT }); fixtureSame = true; } catch { fixtureSame = false; }
  check(fixtureSame, "keyboard golden fixture is byte-identical to HEAD");
}

// ---- browser ----------------------------------------------------------------
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
  const page = await (await browser.newContext({ viewport: { width: 2000, height: 1300 }, hasTouch: true })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function"
    && typeof mountNodeGraphGraphPointEditor === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    const mk = (type, id, gx) => {
      const n = createNodeGraphPatchNode(type, { id, gx, gy: 3 });
      const shape = type === "stepGraph" ? "hold" : "rational";
      n.graph = { ...(n.graph || {}), nodes: [{ x: 0, y: -0.5, c: 0, shape }, { x: 0.4, y: 0.2, c: 0, shape }, { x: 1, y: 0.5, c: 0, shape }] };
      return n;
    };
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes: [mk("stepGraph", "st", 2), mk("smoothGraph", "sm", 22)], cables: [] }, { status: "point editor test" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    nodeGraphGraphSelectionState().delete("st");
    nodeGraphGraphSelectionState().delete("sm");
    await new Promise((r) => setTimeout(r, 800));
  });

  const face = await page.evaluate(() => ["st", "sm"].map((id) => {
    const f = document.querySelector(`.dsp-node[data-node="${id}"] .node-module-graph-face`);
    return { id, face: Boolean(f), strip: Boolean(f?.querySelector(".node-module-graph-point-strip")), fields: f ? f.querySelectorAll("input, select, textarea").length : -1 };
  }));
  for (const f of face) check(f.face && !f.strip && f.fields === 0, `${f.id}: face has no DOM point fields (${JSON.stringify(f)})`);
  const switchRow = await page.evaluate(() => ["st", "sm"].map((id) => {
    const el = document.querySelector(`.dsp-node[data-node="${id}"]`);
    const spec = nodeGraphModuleFaceSpec(el.dataset.nodeType, nodeGraphPatchNode(id)) || [];
    return { id, face: el.classList.contains("has-module-face"), top: (spec[0]?.params || []).map((c) => c[0]) };
  }));
  for (const r of switchRow) check(r.face && JSON.stringify(r.top) === JSON.stringify(["mode", "lockEndpointY"]), `${r.id}: Mode and Lock Ends share one face row (${JSON.stringify(r)})`);

  const open = (id) => page.evaluate(async (id) => {
    if (typeof closeNodeGraphTraceDisplaySettings === "function") closeNodeGraphTraceDisplaySettings();
    setNodeGraphNodeSelection([id]);
    openNodeGraphTraceDisplaySettings(id, { clientX: 1500, clientY: 200 });
    await new Promise((r) => setTimeout(r, 300));
    const root = document.querySelector(`#nodeTraceDisplaySettingsPopover [data-graph-point-editor][data-graph-point-editor-node="${id}"]`);
    return {
      root: Boolean(root),
      visible: Boolean(root && root.getBoundingClientRect().height > 0),
      fields: root ? [...root.querySelectorAll("[data-graph-point-field]")].map((e) => e.dataset.graphPointField) : [],
      empty: root ? root.classList.contains("is-empty") : null,
      locked: root ? [...root.querySelectorAll(".node-graph-point-editor-value.is-locked")].map((e) => e.dataset.graphPointField) : [],
      titles: root ? root.querySelectorAll("[title]").length : -1,
    };
  }, id);

  // ---- Step Graph ----
  let st = await open("st");
  check(st.root && st.visible, "Step Graph: Display Settings shows the point editor");
  check(JSON.stringify(st.fields) === JSON.stringify(["x", "y", "c", "shape"]), `Step Graph fields X, Y, Skew, Shape (${st.fields})`);
  check(st.empty === true && st.locked.includes("x") && st.locked.includes("y") && st.locked.includes("c"), `no selection: "No point selected", fields disabled (${st.locked})`);
  check(st.titles === 0, "no hover titles in the editor");

  const pointAt = (id, i) => page.evaluate(({ id, i }) => {
    const hit = document.querySelector(`.dsp-node[data-node="${id}"] .node-module-graph-node-hit[data-graph-node-index="${i}"]`);
    const r = hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { id, i });
  const ed = (id) => page.evaluate((id) => {
    const root = document.querySelector(`[data-graph-point-editor][data-graph-point-editor-node="${id}"]`);
    if (!root) {
      const pop = document.getElementById("nodeTraceDisplaySettingsPopover");
      throw new Error(`no editor for ${id}: popover hidden=${pop?.hidden} target=${nodeGraphMvp.traceDisplaySettingsTargetNode} sel=${typeof nodeGraphSelectedNodeIds === "function" ? [...nodeGraphSelectedNodeIds()] : "?"} editors=${[...document.querySelectorAll("[data-graph-point-editor]")].map((e) => e.dataset.graphPointEditorNode)} formType=${pop?.dataset?.formType || ""}`);
    }
    const out = { empty: root.classList.contains("is-empty"), which: root.querySelector("[data-graph-point-editor-which]")?.textContent || "" };
    for (const el of root.querySelectorAll("[data-graph-point-field]")) out[el.dataset.graphPointField] = el.tagName === "SELECT" ? el.value : el.textContent;
    const node = nodeGraphPatchNode(id);
    out.graph = node.graph.nodes.map((n) => ({ x: +n.x.toFixed(5), y: +n.y.toFixed(5), c: +(n.c || 0).toFixed(5), shape: n.shape }));
    out.tension = Number(node.params?.tension);
    return out;
  }, id);

  // Select point 2 (index 1) by clicking it on the face.
  let p = await pointAt("st", 1);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(450);
  let e = await ed("st");
  check(!e.empty && e.which.startsWith("2 / 3") && near(Number(e.x), 0.4, 1e-4) && near(Number(e.y), 0.2, 1e-4), `clicking a point on the face shows it in the editor (${e.which}: x ${e.x} y ${e.y})`);
  // Face drag updates the editor live (before release).
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 20, p.y - 15, { steps: 4 });
  const mid = await ed("st");
  await page.mouse.up(); await page.waitForTimeout(450);
  e = await ed("st");
  check(Number(mid.x) > 0.4 && Number(mid.y) > 0.2 && mid.x === String(Number(e.graph[1].x.toFixed(4))), `editor follows a face drag live (x ${mid.x}, y ${mid.y})`);

  // Panel drags through the shared engine (synthetic pointer events).
  const field = (id, key, steps, opts = {}) => page.evaluate(({ id, key, steps, opts }) => {
    nodeGraphMvp.sliderLastPointerDown = null;
    const el = document.querySelector(`[data-graph-point-editor-node="${id}"] [data-graph-point-field="${key}"]`);
    const r = el.getBoundingClientRect();
    const x0 = opts.atLeft ? r.left + 1 : r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    const mods = { shiftKey: !!opts.shift, ctrlKey: !!opts.ctrl, altKey: !!opts.alt };
    const pt = opts.touch ? { pointerType: "touch", pointerId: 61 } : { pointerType: "mouse", pointerId: 1 };
    const fire = (target, type, x, buttons) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y0, button: 0, buttons, isPrimary: true, ...pt, ...mods }));
    fire(document.elementFromPoint(x0, y0), "pointerdown", x0, 1);
    let x = x0;
    for (const dx of steps) { x += dx; fire(document, "pointermove", x, 1); }
    fire(document, "pointerup", x, 0);
    return el.textContent;
  }, { id, key, steps, opts });
  const yOf = async (id, i) => (await ed(id)).graph[i].y;
  let y0 = await yOf("st", 1);
  await field("st", "y", [6, 6, 6, 6]);
  let y1 = await yOf("st", 1);
  check(near(y1 - y0, 0.2, 2e-3), `drag right 24px on Y adds 24/240 of the -1..+1 range (+${(y1 - y0).toFixed(4)})`);
  await field("st", "y", [-24], { shift: true });
  let y2 = await yOf("st", 1);
  check(near(y1 - y2, 0.02, 1e-3), `Shift drag is x0.1 (-${(y1 - y2).toFixed(4)})`);
  await field("st", "y", [-24], { shift: true, ctrl: true });
  const y3 = await yOf("st", 1);
  check(near(y2 - y3, 0.002, 3e-4), `Shift+Ctrl drag is x0.01 (-${(y2 - y3).toFixed(4)})`);
  await field("st", "y", [], { ctrl: true });
  check(near(await yOf("st", 1), 0, 1e-9), "Ctrl+click resets Y to 0");
  await field("st", "y", [], { alt: true, atLeft: true });
  const yAlt = await yOf("st", 1);
  check(yAlt < -0.9, `Alt+click jumps to the pointer (left edge -> ${yAlt.toFixed(3)})`);
  await field("st", "y", []);
  check(near(await yOf("st", 1), yAlt, 1e-9), "plain click without moving does not jump");
  // Clamp at the top of the zoom.
  await field("st", "y", [-100, -100, -100]);
  let yc = await yOf("st", 1);
  check(near(yc, -1, 1e-9), `Y clamps to the visible zoom (-1) (${yc})`);
  await field("st", "y", [-100, 24]);
  yc = await yOf("st", 1);
  check(near(yc, -0.8, 2e-3), `backing off the Y clamp moves at once (${yc})`);
  // X stays between neighbours, and backing off the limit responds at once.
  await field("st", "x", [50, 50, 50, 50]);
  e = await ed("st");
  check(e.graph[1].x < 1 && e.graph[1].x >= 0.99 && e.graph[2].x === 1, `X stops before the next point (x ${e.graph[1].x})`);
  await page.evaluate(() => { nodeGraphMvp.sliderLastPointerDown = null; });
  await field("st", "x", [50, 50, 50, 50, -24]);
  e = await ed("st");
  check(near(e.graph[1].x, 0.999 - 0.1, 3e-3), `backing off the X limit moves at once, no pointer debt (x ${e.graph[1].x})`);
  // End point X is locked.
  await page.evaluate(() => { setNodeGraphGraphSelectedNodeIndex("st", nodeGraphGraphForNode(nodeGraphPatchNode("st")), 0); syncNodeGraphGraphPointEditor("st"); });
  const endLocked = await page.evaluate(() => document.querySelector('[data-graph-point-editor-node="st"] [data-graph-point-field="x"]').classList.contains("is-locked"));
  check(endLocked, "the first point's X is locked (graph ends stay at 0 / 1)");
  await page.evaluate(() => { setNodeGraphGraphSelectedNodeIndex("st", nodeGraphGraphForNode(nodeGraphPatchNode("st")), 1); syncNodeGraphGraphPointEditor("st"); });
  // Skew: drag + ctrl reset; Shape select.
  await field("st", "c", [12]);
  e = await ed("st");
  check(e.graph[1].c > 0.01, `Skew drags (c ${e.graph[1].c})`);
  await field("st", "c", [], { ctrl: true });
  check((await ed("st")).graph[1].c === 0, "Ctrl+click resets Skew to 0");
  await page.evaluate(() => { const s = document.querySelector('[data-graph-point-editor-node="st"] [data-graph-point-field="shape"]'); s.value = "smoothstep"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  check((await ed("st")).graph[1].shape === "smoothstep", "Shape select sets the point's shape");
  // Touch: double-tap resets.
  await field("st", "y", [30]);
  await field("st", "y", [], { touch: true });
  await field("st", "y", [], { touch: true });
  check(near(await yOf("st", 1), 0, 1e-9), "touch double-tap resets Y to 0");
  await page.waitForTimeout(450);

  // Type-in with math.
  const typeIn = (id, key, text, finishKey = "Enter") => page.evaluate(async ({ id, key, text, finishKey }) => {
    nodeGraphMvp.sliderLastPointerDown = null;
    const el = document.querySelector(`[data-graph-point-editor-node="${id}"] [data-graph-point-field="${key}"]`);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    for (let i = 0; i < 2; i += 1) {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerType: "mouse", pointerId: 1, isPrimary: true }));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0, pointerType: "mouse", pointerId: 1, isPrimary: true }));
    }
    const input = el.querySelector("input.node-graph-point-editor-typein");
    if (!input) return { opened: false };
    const focused = document.activeElement === input;
    input.value = text;
    if (finishKey === "blur") input.blur();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: finishKey, bubbles: true, cancelable: true }));
    await new Promise((r2) => setTimeout(r2, 30));
    return { opened: true, focused, closed: !el.querySelector("input"), text: el.textContent };
  }, { id, key, text, finishKey });
  await field("st", "y", [], { ctrl: true }); // y = 0
  await page.evaluate(() => { const n = nodeGraphPatchNode("st"); return n; });
  let t = await typeIn("st", "y", "0.25");
  check(t.opened && t.focused && t.closed && near(await yOf("st", 1), 0.25, 1e-9), `double-click opens type-in; "0.25" Enter sets Y (${JSON.stringify(t)})`);
  await typeIn("st", "y", "*2");
  check(near(await yOf("st", 1), 0.25, 1e-9), `"*2" (leading operator) is invalid and reverts`);
  await typeIn("st", "y", "2-3");
  check(near(await yOf("st", 1), -1, 1e-9), `"2-3" = -1`);
  await typeIn("st", "y", "0.5 -0.23");
  check(near(await yOf("st", 1), 0.27, 1e-9), `"0.5 -0.23" = 0.27`);
  await typeIn("st", "y", "-0.5");
  check(near(await yOf("st", 1), -0.5, 1e-9), `"-0.5" sets -0.5`);
  await typeIn("st", "y", "+0.5");
  check(near(await yOf("st", 1), 0.5, 1e-9), `"+0.5" sets 0.5`);
  await typeIn("st", "y", "0.5*3-1");
  check(near(await yOf("st", 1), 0.5, 1e-9), `"0.5*3-1" = 0.5`);
  await typeIn("st", "y", "(1+2)/4");
  check(near(await yOf("st", 1), 0.75, 1e-9), `"(1+2)/4" = 0.75`);
  await typeIn("st", "y", "=-0.25");
  check(near(await yOf("st", 1), -0.25, 1e-9), `a leading "=" is tolerated ("=-0.25")`);
  t = await typeIn("st", "y", "abc");
  check(near(await yOf("st", 1), -0.25, 1e-9) && t.text === "-0.25", `invalid "abc" reverts (${t.text})`);
  await typeIn("st", "y", "0.9", "Escape");
  check(near(await yOf("st", 1), -0.25, 1e-9), "Escape cancels the type-in");
  await typeIn("st", "y", "0.3", "blur");
  check(near(await yOf("st", 1), 0.3, 1e-9), "leaving the field (blur) commits");
  await typeIn("st", "y", "5");
  check(near(await yOf("st", 1), 1, 1e-9), `typed "5" clamps to the zoom max (1)`);
  await typeIn("st", "x", "0.95");
  e = await ed("st");
  check(near(e.graph[1].x, 0.95, 1e-9), "typed X moves the point");
  await typeIn("st", "x", "2");
  e = await ed("st");
  check(e.graph[1].x < 1 && e.graph[1].x > 0.99, `typed X keeps the point before the next one (${e.graph[1].x})`);
  // Undo restores the last panel edit.
  const beforeUndo = (await ed("st")).graph[1].x;
  await typeIn("st", "x", "0.5");
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForTimeout(200);
  e = await ed("st");
  check(near(e.graph[1].x, beforeUndo, 1e-9) && near(Number(e.x), Number(beforeUndo.toFixed(4)), 1e-9), `undo restores the point and the editor follows (x ${e.graph[1].x}, field ${e.x})`);

  // ---- Smooth Graph ----
  const sm = await open("sm");
  check(sm.root && JSON.stringify(sm.fields) === JSON.stringify(["x", "y", "tension"]), `Smooth Graph fields X, Y, Tension (no per-point skew) (${sm.fields})`);
  check(sm.empty === true && !sm.locked.includes("tension"), "Smooth Graph: no selection, Tension (whole curve) still editable");
  await typeIn("sm", "tension", "0.25");
  check(near((await ed("sm")).tension, 0.25, 1e-9), "Tension type-in sets the curve tension");
  await typeIn("sm", "tension", "5*2");
  check(near((await ed("sm")).tension, 1, 1e-9), "Tension clamps to its parameter max (1)");
  const tensionSlider = await page.evaluate(() => Number(document.querySelector('.dsp-node[data-node="sm"] input[data-param="tension"]')?.value));
  check(!Number.isFinite(tensionSlider) || near(tensionSlider, 1, 1e-9), `module Tension slider follows (${tensionSlider})`);
  p = await pointAt("sm", 1);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(450);
  e = await ed("sm");
  check(!e.empty && e.which.startsWith("2 / 3"), `Smooth Graph: face click selects into the editor (${e.which})`);
  y0 = (await ed("sm")).graph[1].y;
  await field("sm", "y", [12]);
  y1 = (await ed("sm")).graph[1].y;
  check(near(y1 - y0, 0.1, 2e-3), `Smooth Graph Y drag (+${(y1 - y0).toFixed(4)})`);
  // Right-click on a face point still deletes it.
  p = await pointAt("sm", 1);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.waitForTimeout(300);
  e = await ed("sm");
  check(e.graph.length === 2, `right-click on a face point still deletes it (${e.graph.length} points)`);
  const leftover = await page.evaluate(() => ({ drags: nodeGraphSliderActiveDrags().length, flag: Boolean(nodeGraphMvp.sliderDragging), cls: document.body.classList.contains("node-slider-dragging") }));
  check(leftover.drags === 0 && !leftover.flag && !leftover.cls, "no drag state left behind");
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
