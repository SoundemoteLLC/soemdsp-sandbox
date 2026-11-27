// PASTE-8 item 1: one Gradient module per gradient (different gradients each have their own). Every route leaves at most one module per
// gradient: dragging from the 🌈 page (a second drag selects the existing module), duplicate (Ctrl+C / Copy selects it), tapping a face
// (skips gradients that already have a module), and loading a patch where two modules share a gradient (the first stays bound, the rest
// are unbound, no crash). Real page on its own server.py port unless SANDBOX_URL.
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

  // Three gradients on the oscillator's Frequency; the 🌈 page open at the left.
  await page.evaluate(async () => {
    const osc = nodeGraphMvp.patch.nodes.find((n) => n.type === "polyBlep");
    const meta = nodeGraphReadPatchParameterMetadata(osc, "frequency");
    const s0 = nodeGraphParamControlPosition(osc.params.frequency, meta);
    const g = (id, name) => ({ id, name, enabled: true, position: 0, origin: { [osc.id]: { frequency: s0 } }, params: [{ nodeId: osc.id, key: "frequency" }],
      stops: [{ id: `${id}a`, pos: 0, offsets: {} }, { id: `${id}b`, pos: 1, offsets: { [osc.id]: { frequency: 0.2 } } }] });
    nodeGraphMvp.patch.gradients = NodeGraphGradients.normalize([g("g1", "One"), g("g2", "Two"), g("g3", "Three")]);
    recordNodeGraphHistory();
    openNodeGraphUnifiedWindowPage("gradients");
    const panel = document.getElementById("nodeGradientsPage");
    panel.style.left = "10px";
    panel.style.top = "60px";
    await new Promise((r) => setTimeout(r, 150));
  });
  const modules = () => page.evaluate(() => nodeGraphMvp.patch.nodes.filter((n) => n.type === "gradient").map((n) => ({ id: n.id, gradientId: n.gradientId || "" })));
  const atMostOne = async (where) => {
    const list = await modules();
    const counts = {};
    for (const m of list) if (m.gradientId) counts[m.gradientId] = (counts[m.gradientId] || 0) + 1;
    assert.ok(Object.values(counts).every((c) => c <= 1), `${where}: at most one module per gradient ${JSON.stringify(list)}`);
    return list;
  };
  const dragIn = async (gradientId, dx = 45, dy = 25) => {
    const at = await page.evaluate((id) => {
      const el = document.querySelector(`#nodeGradientsBody [data-gradient-drag="${id}"]`);
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, gradientId);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 15; i += 1) await page.mouse.move(at.x + i * dx, at.y + i * dy);
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const selected = () => page.evaluate(() => [...nodeGraphSelectedNodeIds()].map(String));

  // 1. Drag One in: one module bound to it.
  await dragIn("g1");
  let list = await atMostOne("first drag");
  assert.equal(list.filter((m) => m.gradientId === "g1").length, 1, `dragging One in places its module ${JSON.stringify(list)}`);
  const first = list.find((m) => m.gradientId === "g1").id;

  // 2. Drag One in again: no second module; the existing one is selected.
  await page.evaluate(() => setNodeGraphNodeSelection([]));
  await dragIn("g1", 30, 30);
  list = await atMostOne("second drag");
  assert.equal(list.length, 1, `a second drag of One does not make a second module ${JSON.stringify(list)}`);
  assert.deepEqual(await selected(), [first], "a second drag selects the existing module");

  // 3. Duplicate (Ctrl+C / Copy): selects the existing module.
  const copied = await page.evaluate((id) => { setNodeGraphNodeSelection([]); return copyNodeGraphModule(nodeGraphPatchNode(id)); }, first);
  list = await atMostOne("duplicate");
  assert.equal(copied, first, "duplicate returns the existing module");
  assert.equal(list.length, 1, `duplicate makes no second module ${JSON.stringify(list)}`);
  assert.deepEqual(await selected(), [first], "duplicate selects the existing module");

  // 4. Drag Two in: its own module.
  await dragIn("g2", 45, 5);
  list = await atMostOne("drag Two");
  assert.equal(list.length, 2, `a different gradient gets its own module ${JSON.stringify(list)}`);

  // 5. Tap One's face: Two is taken, so it plays Three; tap again: back to One (free again).
  const cycle = await page.evaluate((id) => {
    nodeGraphGradientModuleCycle(id);
    const a = nodeGraphPatchNode(id).gradientId;
    nodeGraphGradientModuleCycle(id);
    const b = nodeGraphPatchNode(id).gradientId;
    return { a, b };
  }, first);
  assert.deepEqual(cycle, { a: "g3", b: "g1" }, `a face tap skips the gradient another module plays ${JSON.stringify(cycle)}`);
  await atMostOne("face taps");

  // 6. Load a patch where two modules share One: the first stays bound, the other is unbound, nothing throws.
  const loaded = await page.evaluate((id) => {
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const src = patch.nodes.find((n) => n.id === id);
    const dup = { ...JSON.parse(JSON.stringify(src)), id: "gradient-99", gx: Number(src.gx) + 12 };
    patch.nodes.push(dup);
    const validated = validateNodeGraphPatch(JSON.parse(JSON.stringify(patch)));
    const fromValidate = validated.nodes.filter((n) => n.type === "gradient").map((n) => ({ id: n.id, gradientId: n.gradientId || "" }));
    commitNodeGraphPatch(loadNodeGraphPatchFromScript(typeof serializeNodeGraphPatch === "function" ? serializeNodeGraphPatch(patch) : JSON.stringify(patch)), { patchDirtyState: "saved" });
    return { fromValidate, live: nodeGraphMvp.patch.nodes.filter((n) => n.type === "gradient").map((n) => ({ id: n.id, gradientId: n.gradientId || "" })) };
  }, first).catch((e) => ({ error: String(e) }));
  assert.ok(!loaded.error, `loading a patch with two modules on one gradient does not throw ${loaded.error || ""}`);
  for (const set of [loaded.fromValidate, loaded.live]) {
    const one = set.filter((m) => m.gradientId === "g1");
    assert.equal(one.length, 1, `only one module stays on One ${JSON.stringify(set)}`);
    assert.equal(one[0].id, first, `the first one keeps it ${JSON.stringify(set)}`);
    assert.ok(set.some((m) => m.id === "gradient-99" && !m.gradientId), `the later one is unbound ${JSON.stringify(set)}`);
  }
  await atMostOne("load");

  assert.deepEqual(errors, [], "no page errors");
  console.log("test_gradient_one_per_gradient: ok");
} finally {
  await browser?.close();
  server?.kill();
}
