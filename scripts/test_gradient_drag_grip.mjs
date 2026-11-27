// PASTE-8 item 2 (and the Mutator half of item 3): the visible drag grip. On the 🌈 page every gradient card has a grip button; dragging
// it into the circuit places a Gradient module bound to that gradient and the drop finishes on release (the press no longer starts a
// marquee that kept the placement open). Dragging the name text does nothing. A second drag of the same gradient selects its module.
// The Mutator page has the same grip; dragging it places a Pitch Mutator. The grip is static (no :hover rule, no animation, the move
// cursor, no title tooltip). At phone width the card head and the Mutator chrome hold their grips without overflow.
// Real page on its own server.py port unless SANDBOX_URL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }

// Static: no hover or animation on the grip.
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8") + fs.readFileSync(path.join(root, "public/node-graph-pitch-mutator.css"), "utf8");
assert.ok(!/\.node-drag-grip[^{]*:hover/.test(css), "no :hover rule on the grip");
const gripRules = [...css.matchAll(/\.node-drag-grip[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
assert.ok(/cursor:\s*move/.test(gripRules) && !/animation|transition/.test(gripRules), "the grip uses the move cursor and never animates");

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

  await page.evaluate(async () => {
    const osc = nodeGraphMvp.patch.nodes.find((n) => n.type === "polyBlep");
    const meta = nodeGraphReadPatchParameterMetadata(osc, "frequency");
    const s0 = nodeGraphParamControlPosition(osc.params.frequency, meta);
    nodeGraphMvp.patch.gradients = NodeGraphGradients.normalize([{ id: "g1", name: "Sweep", enabled: true, position: 0,
      origin: { [osc.id]: { frequency: s0 } }, params: [{ nodeId: osc.id, key: "frequency" }],
      stops: [{ id: "s1", pos: 0, offsets: {} }, { id: "s2", pos: 1, offsets: { [osc.id]: { frequency: 0.2 } } }] }]);
    recordNodeGraphHistory();
    openNodeGraphUnifiedWindowPage("gradients");
    const panel = document.getElementById("nodeGradientsPage");
    panel.style.left = "10px";
    panel.style.top = "60px";
    await new Promise((r) => setTimeout(r, 150));
  });
  const center = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  const drag = async (at, dx = 45, dy = 25) => {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 15; i += 1) await page.mouse.move(at.x + i * dx, at.y + i * dy);
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  const state = (type) => page.evaluate((t) => ({
    modules: nodeGraphMvp.patch.nodes.filter((n) => n.type === t).map((n) => ({ id: n.id, gradientId: n.gradientId || "" })),
    placing: Boolean(nodeGraphMvp.modulePlacement),
    selected: [...nodeGraphSelectedNodeIds()].map(String),
  }), type);

  // The grip: a button with a label, the move cursor, no title tooltip; the name is a plain label.
  const looks = await page.evaluate(() => {
    const grip = document.querySelector('#nodeGradientsBody .node-gradient-card[data-gradient-id="g1"] .node-drag-grip');
    const name = document.querySelector('#nodeGradientsBody .node-gradient-card[data-gradient-id="g1"] .node-gradient-name');
    return { tag: grip?.tagName, drag: grip?.dataset.gradientDrag, label: grip?.getAttribute("aria-label"), title: grip?.hasAttribute("title"),
      cursor: grip ? getComputedStyle(grip).cursor : "", w: grip?.getBoundingClientRect().width, nameDrag: name?.hasAttribute("data-gradient-drag"), name: name?.textContent };
  });
  assert.ok(looks.tag === "BUTTON" && looks.drag === "g1" && looks.label && !looks.title && looks.cursor === "move" && looks.w >= 24,
    `each gradient card has a visible grip button ${JSON.stringify(looks)}`);
  assert.ok(looks.nameDrag === false && looks.name === "Sweep", `the name is only a label ${JSON.stringify(looks)}`);

  // Dragging the name does nothing.
  await drag(await center('#nodeGradientsBody .node-gradient-card[data-gradient-id="g1"] .node-gradient-name'));
  let s = await state("gradient");
  assert.ok(s.modules.length === 0 && !s.placing, `dragging the name text places nothing ${JSON.stringify(s)}`);

  // Dragging the grip places a Gradient module bound to the gradient, and the release finishes the drop.
  await drag(await center('#nodeGradientsBody [data-gradient-drag="g1"]'));
  s = await state("gradient");
  assert.ok(s.modules.length === 1 && s.modules[0].gradientId === "g1", `the grip places a bound Gradient module ${JSON.stringify(s)}`);
  assert.equal(s.placing, false, "the release finishes the drop (no placement left following the pointer)");
  const placed = s.modules[0].id;
  const undoSteps = await page.evaluate(() => (typeof nodeGraphHistoryUndoCount === "function" ? nodeGraphHistoryUndoCount() : null));

  // Again: selects that module, places nothing.
  await page.evaluate(() => setNodeGraphNodeSelection([]));
  await drag(await center('#nodeGradientsBody [data-gradient-drag="g1"]'), 30, 30);
  s = await state("gradient");
  assert.ok(s.modules.length === 1 && !s.placing, `a second drag makes no second module ${JSON.stringify(s)}`);
  assert.deepEqual(s.selected, [placed], `a second drag selects the existing module ${JSON.stringify(s)}`);
  void undoSteps;

  // The Mutator page: the same grip places a Pitch Mutator.
  await page.evaluate(async () => { togglePitchMutatorOverlay(true); await new Promise((r) => setTimeout(r, 200)); });
  const mlook = await page.evaluate(() => {
    const grip = document.querySelector('#pitchMutatorOverlay [data-pm="grip"]');
    return { cls: grip?.className, tag: grip?.tagName, label: grip?.getAttribute("aria-label"), title: grip?.hasAttribute("title"), cursor: grip ? getComputedStyle(grip).cursor : "" };
  });
  assert.ok(mlook.tag === "BUTTON" && /node-drag-grip/.test(mlook.cls) && mlook.label && !mlook.title && mlook.cursor === "move",
    `the Mutator page has the same grip ${JSON.stringify(mlook)}`);
  const before = (await state("pitchMutator")).modules.length;
  const mAt = await center('#pitchMutatorOverlay [data-pm="grip"]');
  await drag(mAt, 20, -30);
  s = await state("pitchMutator");
  assert.ok(s.modules.length === before + 1 && !s.placing, `dragging the Mutator grip places a Pitch Mutator ${JSON.stringify({ before, ...s })}`);

  // Phone width: the card head and the Mutator chrome hold their grips (inside their box, no horizontal page scroll).
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  const phone = await page.evaluate(async () => {
    openNodeGraphUnifiedWindowPage("gradients");
    await new Promise((r) => setTimeout(r, 300));
    const inside = (el, box) => { if (!el || !box) return false; const a = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return a.width > 0 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5; };
    const head = document.querySelector('#nodeGradientsBody .node-gradient-card[data-gradient-id="g1"] .node-gradient-card-head');
    const grip = head?.querySelector(".node-drag-grip");
    const card = head?.closest(".node-gradient-card");
    const mgrip = document.querySelector('#pitchMutatorOverlay [data-pm="grip"]');
    const overlay = document.getElementById("pitchMutatorOverlay");
    return {
      cardGrip: inside(grip, card), headFits: head ? head.scrollWidth <= head.clientWidth + 1 : false,
      mutGrip: inside(mgrip, overlay) && mgrip.getBoundingClientRect().right <= window.innerWidth + 0.5,
      pageScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  assert.ok(phone.cardGrip && phone.headFits, `phone width: the gradient card head fits with its grip ${JSON.stringify(phone)}`);
  assert.ok(phone.mutGrip, `phone width: the Mutator grip is on screen ${JSON.stringify(phone)}`);

  assert.deepEqual(errors, [], "no page errors");
  console.log("test_gradient_drag_grip: ok");
} finally {
  await browser?.close();
  server?.kill();
}
