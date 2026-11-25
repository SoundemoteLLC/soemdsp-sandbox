// HP-03 / Stage A2: patch.gradients, the capture helpers and the gradient provider on the param offset list. Headless.
//   Part 1 (node, vm): the effective-value maths: sum, clamp (linear and nonlinear sliders), halfway snap, hold, capture, robustness,
//     the live plan builders and the plugin host.
//   Part 2 (real page, own server.py on a free port, never 8765 / 8766 / 8080, unless SANDBOX_URL is set): normalize / serialize / load /
//     undo round trip, the base never rewritten, the fingerprint ignoring gradients, and every file under patches/ and saved-patches/
//     keeping the same effective params (no gradients present).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
// values made inside a vm context have another Array prototype: compare through JSON
const deq = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const close = (a, b, eps = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} got ${a}, expected ${b}`);

function context(extra = {}) {
  const c = { console, requestAnimationFrame: () => 1, document: { readyState: "loading", addEventListener() {}, getElementById: () => null }, ...extra };
  vm.createContext(c);
  const run = (rel) => vm.runInContext(read(rel), c, { filename: path.basename(rel) });
  run("public/node-graph-stdlib/node-graph-param-surface-helpers.js");
  run("public/node-graph-param-offsets.js");
  c.nodeGraphMvp = { patch: null };
  c.nodeGraphReadPatchParameterMetadata = (node, key) => (node.paramMeta || {})[key] || null;
  c.nodeGraphGlGraphNoteValueChrome = () => {};
  run("public/node-graph-gradients.js");
  return { c, run };
}

const LIN = { min: 0, max: 1, step: "any" };
const LOG = { min: 20, max: 20000, mid: 1000, step: "any", nonlinearSlider: true };
const CHOICE = { min: 0, max: 3, step: 1, choices: ["a", "b", "c", "d"] };
const STEPS = { min: 1, max: 9, step: 1 };

// a gradient with two stops: pos 0 = zero offsets, pos 1 = the given slider offsets per "node:key"
function gradient(id, offsets, extra = {}) {
  const params = [];
  const at1 = {};
  for (const [tag, value] of Object.entries(offsets)) {
    const [nodeId, key] = tag.split(":");
    params.push({ nodeId, key });
    (at1[nodeId] || (at1[nodeId] = {}))[key] = value;
  }
  return { id, name: id, enabled: true, position: 1, origin: extra.origin || {}, params, stops: [{ id: "s1", pos: 0, offsets: {} }, { id: "s2", pos: 1, offsets: at1 }], ...extra };
}

{
  const { c } = context();
  const node = { id: "n1", type: "x", params: { cutoff: 0.3, freq: 1000, mode: 0, steps: 4, untouched: 0.77 }, paramMeta: { cutoff: LIN, freq: LOG, mode: CHOICE, steps: STEPS, untouched: LIN } };
  const patch = { nodes: [node], gradients: [] };
  c.nodeGraphMvp.patch = patch;
  const effective = () => c.nodeGraphEffectiveNodeParams(node);
  const baseBefore = JSON.stringify(node.params);

  // 1. two enabled gradients add; a disabled one is ignored
  patch.gradients = [gradient("g1", { "n1:cutoff": 0.2 }), gradient("g2", { "n1:cutoff": 0.1 })];
  close(effective().cutoff, 0.6, 1e-9, "two enabled gradients add:");
  patch.gradients[1].enabled = false;
  close(effective().cutoff, 0.5, 1e-9, "a disabled gradient is ignored:");
  patch.gradients[0].position = 0.5;
  close(effective().cutoff, 0.4, 1e-9, "linear between stops:");
  assert.equal(effective().untouched, 0.77, "a param nobody moves is exactly as it came");
  patch.gradients[0].position = 0;
  assert.equal(effective().cutoff, 0.3, "at the zero stop the value is the base, exactly");
  console.log("ok  two gradients add, disabled ignored, linear, untouched exact");

  // 2. the sum is clamped by the definition's min / max for a normal slider and a nonlinearSlider param
  patch.gradients = [gradient("g1", { "n1:cutoff": 0.6, "n1:freq": 0.8 }), gradient("g2", { "n1:cutoff": 0.6, "n1:freq": 0.8 })];
  node.params.cutoff = 0.5;
  let e = effective();
  assert.equal(e.cutoff, 1, "linear slider clamps at the definition max");
  close(e.freq, 20000, 1e-6, "nonlinear slider clamps at the definition max:");
  patch.gradients = [gradient("g1", { "n1:cutoff": -0.9, "n1:freq": -0.9 }), gradient("g2", { "n1:cutoff": -0.9, "n1:freq": -0.9 })];
  e = effective();
  assert.equal(e.cutoff, 0, "linear slider clamps at the definition min");
  close(e.freq, 20, 1e-6, "nonlinear slider clamps at the definition min:");
  // the offset is in SLIDER space: +0.1 of travel on the log-skewed slider is not +0.1 of the domain
  patch.gradients = [gradient("g1", { "n1:freq": 0.1 })];
  const slider0 = c.nodeGraphParamControlPosition(1000, LOG);
  close(c.nodeGraphParamControlPosition(effective().freq, LOG), slider0 + 0.1, 1e-9, "slider-space offset on a nonlinear param:");
  console.log("ok  clamp from the definition (linear and nonlinear), offsets in slider space");

  // 3. choice, switch and integer-step params snap at halfway; hard switch at equal positions
  const snap = (meta, key, originSlider, offsetAt1, positions) => {
    const g = gradient("gs", { [`n1:${key}`]: offsetAt1 }, { origin: { n1: { [key]: originSlider } } });
    patch.gradients = [g];
    return positions.map((p) => { g.position = p; return effective()[key]; });
  };
  node.params.mode = 0;
  deq(snap(CHOICE, "mode", 0, 1, [0, 0.49, 0.5, 0.75, 1]), [0, 0, 3, 3, 3], "a choice param snaps at the halfway point");
  node.params.steps = 4;
  const stepOrigin = c.nodeGraphParamControlPosition(4, STEPS);
  const stepNext = c.nodeGraphParamControlPosition(8, STEPS) - stepOrigin;
  deq(snap(STEPS, "steps", stepOrigin, stepNext, [0, 0.4, 0.5, 1]), [4, 4, 8, 8], "an integer-step param snaps at the halfway point");
  {
    const g = { id: "gh", name: "gh", enabled: true, position: 0.2, origin: { n1: { mode: 0 } }, params: [{ nodeId: "n1", key: "mode" }], stops: [{ id: "a", pos: 0.5, offsets: {} }, { id: "b", pos: 0.5, offsets: { n1: { mode: 1 / 3 } } }] };
    patch.gradients = [g];
    g.position = 0.4999; assert.equal(effective().mode, 0, "two stops at one position: before it");
    g.position = 0.5; assert.equal(effective().mode, 1, "two stops at one position switch hard there");
    g.position = 0.9; assert.equal(effective().mode, 1, "and hold after it");
  }
  console.log("ok  choice and integer-step snap at halfway, hard switch at equal positions");

  // 4 (model part). the base node.params is unchanged by every apply above
  assert.equal(JSON.stringify(node.params).includes('"cutoff":0.5'), true);
  node.params.cutoff = 0.3; node.params.steps = 4; node.params.mode = 0;
  patch.gradients = [gradient("g1", { "n1:cutoff": 0.2 })];
  effective(); effective();
  assert.equal(JSON.stringify(node.params), baseBefore, "node.params (the base) is never rewritten");
  console.log("ok  base params untouched by apply");

  // 7. hold outside the end stops
  {
    const g = { id: "gh", name: "gh", enabled: true, position: 0, origin: {}, params: [{ nodeId: "n1", key: "cutoff" }], stops: [{ id: "a", pos: 0.25, offsets: { n1: { cutoff: 0.1 } } }, { id: "b", pos: 0.75, offsets: { n1: { cutoff: 0.3 } } }] };
    patch.gradients = [g];
    const at = (p) => { g.position = p; return effective().cutoff; };
    close(at(0), 0.4, 1e-9, "hold before the first stop:");
    close(at(0.25), 0.4, 1e-9, "at the first stop:");
    close(at(0.5), 0.5, 1e-9, "between the stops:");
    close(at(0.75), 0.6, 1e-9, "at the last stop:");
    close(at(1), 0.6, 1e-9, "hold after the last stop:");
    console.log("ok  hold outside the end stops");
  }

  // 6. a gradient that references a deleted module / param applies without throwing and the stored list is unchanged
  {
    const g = gradient("g1", { "ghost:cutoff": 0.2, "n1:gone": 0.2, "n1:cutoff": 0.1 });
    patch.gradients = [g];
    const before = JSON.stringify(patch.gradients);
    let result;
    assert.doesNotThrow(() => { result = effective(); });
    close(result.cutoff, 0.4, 1e-9, "the live reference still applies:");
    assert.equal(result.gone, undefined, "a missing param is skipped");
    assert.equal(JSON.stringify(patch.gradients), before, "the stored list is not rewritten");
    patch.nodes = [];
    assert.doesNotThrow(() => c.applyNodeGraphParamOffsets({ id: "n9", type: "x", params: { cutoff: 0.5 } }, { cutoff: 0.5 }));
    assert.equal(JSON.stringify(patch.gradients), before, "still not rewritten with the module gone");
    patch.nodes = [node];
    console.log("ok  missing node ids and params are skipped, the list is untouched");
  }

  // 5. capture: only moved params register, an all-zero param is dropped, a later-stop param gets implicit zeros earlier
  {
    const p = { nodes: [{ id: "n1", type: "x", params: { cutoff: 0.3, freq: 1000, untouched: 0.77, mode: 0 }, paramMeta: { cutoff: LIN, freq: LOG, untouched: LIN, mode: CHOICE } }, { id: "stepper", type: "stepGraph", params: { level: 0.5 }, paramMeta: { level: LIN } }], gradients: [{ name: "Gradient 1", id: "g1" }] };
    const api = c.NodeGraphGradients;
    let g = api.createGradientFromSnapshot(p);
    assert.equal(g.name, "Gradient 2", "the next unused Gradient N");
    assert.equal(g.stops.length, 1); assert.equal(g.stops[0].pos, 0);
    deq(g.params, [], "nothing registered at the first snapshot");
    assert.ok(g.origin.n1 && Math.abs(g.origin.n1.cutoff - 0.3) < 1e-12, "origin = the base slider values");
    assert.equal(g.origin.stepper, undefined, "Step Graph holds still: it is not captured");
    p.nodes[0].params.cutoff = 0.5;            // moves
    p.nodes[0].params.untouched = 0.77 + 5e-5; // below the epsilon (1e-4 of travel)
    g = api.snapshotIntoGradient(p, g, 1);
    deq(g.params, [{ nodeId: "n1", key: "cutoff" }], "only moved params register");
    close(g.stops.find((s) => s.pos === 1).offsets.n1.cutoff, 0.2, 1e-9, "the stop stores the offset from the origin:");
    p.nodes[0].params.freq = 2000;             // first moves at a later stop
    g = api.snapshotIntoGradient(p, g, 0.5);
    deq(g.params.map((x) => x.key), ["cutoff", "freq"], "a later-stop param joins params");
    assert.equal(g.stops.find((s) => s.pos === 0).offsets.n1, undefined, "earlier stops keep an implicit zero");
    deq(g.stops.map((s) => s.pos), [0, 0.5, 1], "stops stay sorted");
    const first = g;
    g = api.snapshotIntoGradient(p, g, 1);      // re-snapshot on an existing stop replaces it (freq now registers at pos 1 too)
    assert.equal(g.stops.length, 3, "a re-snapshot replaces the stop");
    assert.ok(g.stops.find((s) => s.pos === 1).offsets.n1.freq !== undefined, "the replaced stop has the new offsets");
    assert.equal(JSON.stringify(first.stops.find((s) => s.pos === 1).offsets.n1.freq), undefined, "snapshots return new objects");
    // an all-zero param is dropped automatically: move freq back to its origin at every stop
    p.nodes[0].params.freq = 1000;
    let h = api.snapshotIntoGradient(p, g, 0.5);
    h = api.snapshotIntoGradient(p, h, 1);
    deq(h.params.map((x) => x.key), ["cutoff"], "a param that is zero at every stop is dropped");
    assert.ok(h.stops.every((s) => !(s.offsets.n1 && "freq" in s.offsets.n1)), "and removed from the stops");
    assert.equal(api.dropAllZeroParams(h).params.length, 1);
    // set start re-records the origin
    p.nodes[0].params.cutoff = 0.4;
    const s = api.setStart(p, h);
    close(s.origin.n1.cutoff, 0.4, 1e-12, "set start re-records the origin:");
    assert.equal(s.stops, h.stops, "and keeps the stops");
    console.log("ok  capture: moved only, all-zero dropped, implicit zeros, replace, set start");
  }

  // normalize: shape only, dangling refs kept, unique ids
  {
    const api = c.NodeGraphGradients;
    const out = api.normalize([{ id: "a", position: 4, stops: [{ pos: 2, offsets: { n1: { cutoff: "0.2", bad: "x" } } }, { id: "s1", pos: "nope" }], params: [{ nodeId: "ghost", key: "k" }, { nodeId: "ghost", key: "k" }, { bad: 1 }] }, { id: "a" }, "junk", null]);
    assert.equal(out.length, 2); assert.notEqual(out[0].id, out[1].id, "ids are unique");
    assert.equal(out[0].position, 1, "position is held to 0..1");
    assert.equal(out[0].stops.length, 1); assert.equal(out[0].stops[0].pos, 1);
    deq(out[0].stops[0].offsets, { n1: { cutoff: 0.2 } });
    deq(out[0].params, [{ nodeId: "ghost", key: "k" }], "a dangling reference is kept (it is skipped when applying)");
    deq(api.normalize(undefined), []);
    const again = api.normalize(JSON.parse(JSON.stringify(out)));
    deq(again, out, "normalize is idempotent through JSON");
    console.log("ok  normalize");
  }
}

// 8. plugin-host effective params include the gradient offsets; the live plan builders too (the HP-02 hook)
{
  const node = { id: "g1", type: "gainish", params: { gain: 0.5, tone: 0.25 }, paramMeta: { gain: LIN, tone: LIN } };
  const patch = { nodes: [node], connections: [], bypassedNodes: [], gradients: [gradient("gr", { "g1:gain": 0.25 })] };
  const posted = []; const listeners = {};
  const h = { nodeGraphMvp: { patch }, location: { search: "?host=plugin", pathname: "/index.html" }, __JUCE__: { backend: { emitEvent: (t, payload) => posted.push(payload), addEventListener() {} } }, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, fetch: () => Promise.resolve(), addEventListener() {}, nodeSandboxInterfaceReady: true, serializeNodeGraphPatch: (p) => JSON.stringify({ nodes: p.nodes.map((n) => ({ id: n.id, type: n.type, params: n.params })) }) };
  const { c } = context(h);
  c.window = c;
  c.document.addEventListener = (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); };
  c.document.documentElement = { classList: { add() {} }, dataset: {} };
  c.document.body = { classList: { add() {} }, dataset: {} };
  c.nodeGraphMvp.patch = patch;
  vm.runInContext(read("public/plugin-host.js"), c, { filename: "plugin-host.js" });
  assert.ok(posted.some((p) => p && p.event === "patch"), "plugin host booted");
  posted.length = 0;
  patch.gradients[0].position = 0.4;
  for (const fn of listeners.input || []) fn({});
  const event = posted.filter((p) => p && p.event === "param" && p.nodeId === "g1" && p.key === "gain").pop();
  assert.ok(event, "plugin host posts the gradient's value");
  close(event.value, 0.5 + 0.25 * 0.4, 1e-9, "plugin host effective value:");
  assert.ok(!posted.some((p) => p && p.event === "param" && p.key === "tone"), "an untouched param is not posted");
  assert.equal(node.params.gain, 0.5, "the base is unchanged after the plugin diff");
  console.log("ok  plugin host posts effective params with the gradient offset");
}

// ----------------------------------------------------------------------------------------------- part 2: the real page
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }
let server = null; let browser = null;
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "server.py"), "--port", String(port)], { cwd: root, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const patch = nodeGraphMvp.patch; const n = patch && patch.nodes ? patch.nodes.length : -1; const now = performance.now();
    if (!window.__settle || window.__settle.patch !== patch || window.__settle.n !== n) window.__settle = { patch, n, since: now };
    return now - window.__settle.since > 2000;
  }, null, { timeout: 120000, polling: 100 });

  const round = await page.evaluate(() => {
    const out = {};
    const id = showNodeGraphModule("flowerChildFilter", { x: 60, y: 60 }, { record: false, autosaveWorkingPatch: false, skipLivePlan: true });
    const node = nodeGraphPatchNode(id);
    const key = "frequency";
    out.base = Number(node.params[key]);
    const api = NodeGraphGradients;
    let g = api.createGradientFromSnapshot(nodeGraphMvp.patch);
    node.params[key] = out.base * 2;
    g = api.snapshotIntoGradient(nodeGraphMvp.patch, g, 1);
    node.params[key] = out.base; // back to the base: the gradient is an offset from it
    out.registered = g.params.map((p) => (p.nodeId === id ? p.key : null));
    g.position = 0.5;
    recordNodeGraphHistory();
    const before = JSON.stringify(node.params);
    nodeGraphMvp.patch.gradients = [g];
    commitNodeGraphPatch(nodeGraphMvp.patch, { status: "gradient test" });
    out.effective = nodeGraphEffectiveNodeParams(nodeGraphPatchNode(id))[key];
    out.baseAfterApply = Number(nodeGraphPatchNode(id).params[key]);
    // fingerprint: a position change is not a plan change; a base change is
    const f1 = nodeGraphPatchFingerprint();
    nodeGraphMvp.patch.gradients[0].position = 0.9;
    out.fingerprintIgnoresGradients = f1 === nodeGraphPatchFingerprint();
    nodeGraphMvp.patch.gradients[0].position = 0.5;
    nodeGraphPatchNode(id).params[key] = out.base * 1.01;
    out.fingerprintSeesBase = f1 !== nodeGraphPatchFingerprint();
    nodeGraphPatchNode(id).params[key] = out.base;
    // save / load round trip
    const text = serializeNodeGraphPatch(nodeGraphMvp.patch);
    const parsed = JSON.parse(text);
    out.savedGradients = JSON.stringify(parsed.gradients);
    const loaded = loadNodeGraphPatchFromScript(text);
    out.loadedGradients = JSON.stringify(loaded.gradients);
    out.loadedBase = Number(loaded.nodes.find((n) => n.id === id).params[key]);
    // no gradients -> the field is not written
    const bare = JSON.parse(serializeNodeGraphPatch({ ...nodeGraphMvp.patch, gradients: undefined }));
    out.bareHasField = Object.prototype.hasOwnProperty.call(bare, "gradients");
    out.id = id; out.key = key; out.beforeParams = before;
    return out;
  });
  // undo (it applies after a short glow, so wait for it): the gradient edit goes back, the base never moved
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForFunction(() => (nodeGraphMvp.patch.gradients || []).length === 0, null, { timeout: 15000 });
  round.undoGradients = await page.evaluate(() => (nodeGraphMvp.patch.gradients || []).length);
  round.undoBase = await page.evaluate(({ id, key }) => Number(nodeGraphPatchNode(id).params[key]), { id: round.id, key: round.key });
  assert.deepEqual(round.registered, ["frequency"], "the snapshot registered the moved param");
  assert.ok(round.effective > round.base && round.effective < round.base * 2, `the gradient moves the effective value (${round.base} -> ${round.effective})`);
  assert.equal(round.baseAfterApply, round.base, "the base is unchanged after apply");
  assert.ok(round.fingerprintIgnoresGradients, "nodeGraphPatchFingerprint ignores gradients");
  assert.ok(round.fingerprintSeesBase, "and still sees a changed base value");
  assert.equal(round.savedGradients, round.loadedGradients, "save then load round-trips patch.gradients");
  assert.equal(round.loadedBase, round.base, "the base is unchanged after save and load");
  assert.equal(round.bareHasField, false, "a patch without gradients does not write the field");
  assert.equal(round.undoGradients, 0, "undo removes the gradient edit");
  assert.equal(round.undoBase, round.base, "the base is unchanged after undo");
  console.log("ok  page: normalize / serialize / load / undo round trip, fingerprint ignores gradients");

  // every file under patches/ and saved-patches/: the same effective params with the gradient provider or without it (no gradients present)
  const files = [];
  for (const dir of ["patches", "saved-patches"]) {
    const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = `${d}/${e.name}`; if (e.isDirectory()) walk(rel); else if (e.name.endsWith(".json")) files.push(rel); } };
    if (fs.existsSync(path.join(root, dir))) walk(dir);
  }
  let compared = 0; let skipped = 0;
  const chunkSize = 25;
  const chunks = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    const texts = {};
    for (const rel of files.slice(i, i + chunkSize)) texts[rel] = read(rel);
    chunks.push(texts);
  }
  const effectiveOf = (texts) => {
    const out = {}; const bad = []; let skippedHere = 0;
    for (const [rel, text] of Object.entries(texts)) {
      let patch;
      try { patch = loadNodeGraphPatchFromScript(text); } catch (error) { skippedHere += 1; continue; }
      if (!patch || !Array.isArray(patch.nodes)) { skippedHere += 1; continue; }
      if (patch.gradients && patch.gradients.length) bad.push(`${rel}: has gradients`);
      const saved = nodeGraphMvp.patch;
      nodeGraphMvp.patch = patch;
      try { for (const node of patch.nodes) out[`${rel}#${node.id}`] = JSON.stringify(nodeGraphEffectiveNodeParams(node)); } finally { nodeGraphMvp.patch = saved; }
    }
    return { out, bad, skipped: skippedHere };
  };
  const withProvider = {};
  for (const texts of chunks) {
    const r = await page.evaluate(`(${effectiveOf.toString()})(${JSON.stringify(texts)})`);
    assert.deepEqual(r.bad, [], "no shipped patch has gradients yet");
    Object.assign(withProvider, r.out); skipped += r.skipped;
  }
  // the same files with the gradients provider replaced by a no-op
  await page.evaluate(() => registerNodeGraphParamOffsetProvider({ id: "gradients", order: 10, applyParams() {} }));
  for (const texts of chunks) {
    const r = await page.evaluate(`(${effectiveOf.toString()})(${JSON.stringify(texts)})`);
    for (const [k, v] of Object.entries(r.out)) { assert.equal(withProvider[k], v, `effective params unchanged by the gradient provider: ${k}`); compared += 1; }
  }
  console.log(`ok  ${files.length} shipped patch files: ${compared} nodes compared, ${skipped} files skipped (unloadable), no effective-param diff`);
  assert.deepEqual(errors, [], "no page errors");
  console.log("test_gradients: ok");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
