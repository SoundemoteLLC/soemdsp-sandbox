// HP-02 / Stage A1: the one param offset provider list.
//   1. List mechanics: order, replace, unregister, base path, effective params (node.params untouched), repaint only on change.
//   2. A dummy provider's offset reaches the live plan params (both builders) and what plugin-host.js posts; node.params is unchanged.
//   3. Pitch Mutator: same effective params as the code before the refactor (read from the baseline commit) on the acoustic-bass fixture
//      and on a fixture with real mutator lanes.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The commit before the refactor: its overlay exports pitchMutatorApplyLiveParams / pitchMutatorApplyToBase (the "old path").
const BASELINE = "8f6414e6";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function baseline(rel) {
  return execFileSync("git", ["show", `${BASELINE}:${rel}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function same(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}\n  got      ${JSON.stringify(a)}\n  expected ${JSON.stringify(b)}`);
}
function run(context, code, filename) {
  vm.runInContext(code, context, { filename });
}

// A context where browser-only globals exist but nothing is drawn: the overlay waits for DOMContentLoaded, so it touches no DOM at load.
function browserContext(extra = {}) {
  const context = {
    console,
    requestAnimationFrame: () => 1,
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById: () => null,
    },
    ...extra,
  };
  vm.createContext(context);
  return context;
}

// ---------------------------------------------------------------- 1. list mechanics
{
  const c = browserContext();
  const chrome = [];
  c.nodeGraphGlGraphNoteValueChrome = (id) => chrome.push(String(id));
  run(c, read("public/node-graph-param-offsets.js"), "node-graph-param-offsets.js");
  const node = { id: "n1", type: "x", params: { a: 1, b: 2, text: "keep" } };

  // no provider: values pass through, nothing repaints
  const empty = c.applyNodeGraphParamOffsets(node, { a: 1, b: 2 });
  same(empty, { a: 1, b: 2 }, "no providers leaves params alone");
  same(chrome, [], "no providers asks for no repaint");

  const calls = [];
  c.registerNodeGraphParamOffsetProvider({ id: "late", order: 20, applyParams: (n, p) => { calls.push("late"); p.a += 10; }, applyToBase: (n, k, v) => (k === "a" ? v + 10 : v) });
  c.registerNodeGraphParamOffsetProvider({ id: "early", order: 0, applyParams: (n, p) => { calls.push("early"); p.a *= 2; }, applyToBase: (n, k, v) => (k === "a" ? v * 2 : v) });
  const params = { a: 1, b: 2 };
  c.applyNodeGraphParamOffsets(node, params);
  same(calls, ["early", "late"], "providers run in ascending order, not registration order");
  same(params, { a: 12, b: 2 }, "gradients-first order: (1 * 2) + 10");
  same(chrome, ["n1"], "a changed value asks the GPU controls to repaint once");
  c.applyNodeGraphParamOffsets(node, { a: 1, b: 2 });
  same(chrome, ["n1"], "the same offsets again do not ask again");
  c.applyNodeGraphParamOffsets(node, { a: 1, b: 2 }, { notify: false });
  same(chrome, ["n1"], "notify: false never asks");
  same(c.applyNodeGraphParamOffsetsToBase(node, "a", 1, {}), 12, "single-value path runs the same order");
  same(c.applyNodeGraphParamOffsetsToBase(node, "b", 2, {}), 2, "single-value path leaves an untouched key alone");

  // effective params: a copy, numeric only, node.params is never written
  const before = JSON.stringify(node.params);
  same(c.nodeGraphEffectiveNodeParams(node), { a: 12, b: 2 }, "effective params carry the offsets");
  assert(JSON.stringify(node.params) === before, "node.params is unchanged");

  // replace by id, unregister
  c.registerNodeGraphParamOffsetProvider({ id: "late", order: 20, applyParams: (n, p) => { p.a += 100; } });
  same(c.nodeGraphEffectiveNodeParams(node), { a: 102, b: 2 }, "registering an id again replaces that provider");
  const off = c.registerNodeGraphParamOffsetProvider({ id: "temp", order: 30, applyParams: (n, p) => { p.b = 99; } });
  same(c.nodeGraphEffectiveNodeParams(node), { a: 102, b: 99 }, "a third provider applies");
  off();
  same(c.nodeGraphEffectiveNodeParams(node), { a: 102, b: 2 }, "unregister removes it");
  let threw = false;
  try { c.registerNodeGraphParamOffsetProvider({ id: "bad" }); } catch (_e) { threw = true; }
  assert(threw, "a provider without applyParams is rejected");
  console.log("ok  list mechanics");
}

// ---------------------------------------------------------------- 2. live plan and plugin host see a dummy provider
{
  const c = browserContext();
  c.nodeGraphMvp = { patch: null };
  c.nodeGraphGlGraphNoteValueChrome = () => {};
  const definitions = { gainish: { parameters: [{ key: "gain" }, { key: "tone" }] } };
  Object.assign(c, {
    nodeGraphModuleDefinitions: definitions,
    nodeGraphParameterChoiceKeys: () => null,
    nodeGraphReadPatchParameterValue: (node, key) => Number(node.params[key]),
    nodeGraphParameterFallback: () => 0,
    nodeGraphReadPatchParameterMetadata: () => ({}),
    normalizeNodeGraphPatchParameterMetadata: () => ({}),
    nodeGraphParameterDefinitionMetadata: () => ({}),
    nodeGraphFiniteNumber: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
    nodeGraphModuleIsGraphType: () => false,
    nodeGraphIsNamedPortalType: () => false,
    nodeGraphModuleBypassSpec: () => null,
  });
  run(c, read("public/node-graph-param-offsets.js"), "node-graph-param-offsets.js");
  let loaded = true;
  try {
    run(c, read("public/node-graph-live-plan-runtime.js"), "node-graph-live-plan-runtime.js");
  } catch (error) {
    loaded = false;
    console.log(`note: live-plan-runtime could not load headless (${String(error.message).slice(0, 80)})`);
  }
  assert(loaded, "node-graph-live-plan-runtime.js loads in the headless context");

  const node = { id: "g1", type: "gainish", params: { gain: 0.5, tone: 0.25 } };
  const patch = { nodes: [node], connections: [], bypassedNodes: [] };
  c.nodeGraphMvp.patch = patch;
  c.registerNodeGraphParamOffsetProvider({ id: "dummy", order: 0, applyParams: (n, p) => { if (n.id === "g1") p.gain += 0.125; } });

  const live = c.nodeGraphBuildLiveParameterNodes();
  same(live.find((n) => n.id === "g1").params.gain, 0.625, "live plan params (patch on screen) carry the offset");
  const forPatch = c.nodeGraphBuildLiveParameterNodesForPatch(patch);
  same(forPatch.find((n) => n.id === "g1").params.gain, 0.625, "live plan params (any patch) carry the offset");
  same(node.params, { gain: 0.5, tone: 0.25 }, "node.params is unchanged after building live params");

  // plugin-host.js: load it as the plugin would (interface already up) and watch what it posts
  const posted = [];
  const listeners = {};
  const h = browserContext({
    nodeGraphMvp: { patch },
    location: { search: "?host=plugin", pathname: "/index.html" },
    __JUCE__: { backend: { emitEvent: (type, payload) => posted.push(payload), addEventListener() {} } },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    fetch: () => Promise.resolve(),
    addEventListener() {},
    nodeSandboxInterfaceReady: true,
    serializeNodeGraphPatch: (p) => JSON.stringify({ nodes: p.nodes.map((n) => ({ id: n.id, type: n.type, params: n.params })) }),
  });
  h.window = h;
  h.document.addEventListener = (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); };
  h.document.documentElement = { classList: { add() {} }, dataset: {} };
  h.document.body = { classList: { add() {} }, dataset: {} };
  run(h, read("public/node-graph-param-offsets.js"), "node-graph-param-offsets.js");
  run(h, read("public/plugin-host.js"), "plugin-host.js");
  assert(h.soemdspPluginHost === true, "plugin host is on in the headless plugin context");
  assert(posted.some((p) => p && p.event === "patch"), "plugin host sent the patch and snapshotted its params at boot");
  assert((listeners.input || []).length > 0, "plugin host listens for page edits");
  posted.length = 0;
  // the provider arrives after the snapshot: its offset must be sent although node.params did not change
  h.registerNodeGraphParamOffsetProvider({ id: "dummy", order: 0, applyParams: (n, p) => { if (n.id === "g1") p.gain += 0.125; } });
  for (const fn of listeners.input) fn({});
  const paramEvents = posted.filter((p) => p && p.event === "param");
  assert(paramEvents.some((p) => p.nodeId === "g1" && p.key === "gain" && Math.abs(p.value - 0.625) < 1e-12), "plugin host posts the provider's offset");
  assert(!paramEvents.some((p) => p.nodeId === "g1" && p.key === "tone"), "an untouched param is not posted");
  same(node.params, { gain: 0.5, tone: 0.25 }, "node.params is unchanged after the plugin diff");
  console.log("ok  live plan and plugin host see the dummy provider");
}

// ---------------------------------------------------------------- 3. Pitch Mutator: identical before and after
{
  const patchFiles = ["tests/fixtures/view-real-acoustic-bass.json"];
  function engineFiles(ctx) {
    for (const rel of ["public/node-graph-segment-curves.js", "public/pitch-mutator-engine.js"]) run(ctx, read(rel), path.basename(rel));
  }

  // lanes: a copy of the fixture whose mutator really offsets two params (the shipped fixture mutator has no lanes)
  function withLanes(fixture) {
    const copy = JSON.parse(JSON.stringify(fixture));
    const target = copy.nodes.find((n) => n.type !== "pitchMutator" && n.params && Object.keys(n.params).length >= 2);
    const mutator = copy.nodes.find((n) => n.type === "pitchMutator");
    const keys = Object.keys(target.params).filter((k) => Number.isFinite(target.params[k])).slice(0, 2);
    target.paramMeta = target.paramMeta || {};
    for (const key of keys) {
      const v = Math.abs(target.params[key]) || 1;
      target.paramMeta[key] = { ...(target.paramMeta[key] || {}), min: -4 * v, max: 4 * v, nonlinearSlider: false, kind: "plain" };
    }
    mutator.mutator.lanes = keys.map((paramKey, i) => ({
      target: { nodeId: target.id, paramKey },
      keys: [{ x: 48, offset: 0.05 * (i + 1) }, { x: 60, offset: -0.1 }, { x: 72, offset: 0.2 }],
    }));
    mutator.mutator.freqLane = { keys: [{ x: 48, hz: 110 }, { x: 72, hz: 880 }] };
    return { copy, targetId: target.id, keys };
  }

  function paramsOf(node) {
    const out = {};
    for (const [k, v] of Object.entries(node.params || {})) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    return out;
  }

  function compare(label, fixture, auditionNote) {
    // old path: the baseline overlay, called the way the baseline live plan called it
    const oldCtx = browserContext();
    oldCtx.nodeGraphMvp = { patch: JSON.parse(JSON.stringify(fixture)) };
    engineFiles(oldCtx);
    run(oldCtx, baseline("public/node-graph-pitch-mutator-overlay.js"), "overlay@baseline");
    // new path: the provider list with the current overlay registered
    const newCtx = browserContext();
    newCtx.nodeGraphMvp = { patch: JSON.parse(JSON.stringify(fixture)) };
    engineFiles(newCtx);
    run(newCtx, read("public/node-graph-param-offsets.js"), "node-graph-param-offsets.js");
    run(newCtx, read("public/node-graph-pitch-mutator-overlay.js"), "overlay@now");
    assert(typeof oldCtx.pitchMutatorApplyLiveParams === "function", "baseline overlay exposes the old function");
    assert(typeof newCtx.pitchMutatorApplyLiveParams === "undefined", "the old export is gone (no dead code)");
    let differing = 0;
    let moved = 0;
    for (let i = 0; i < fixture.nodes.length; i += 1) {
      const oldNode = oldCtx.nodeGraphMvp.patch.nodes[i];
      const newNode = newCtx.nodeGraphMvp.patch.nodes[i];
      const oldParams = paramsOf(oldNode);
      const newParams = paramsOf(newNode);
      const base = JSON.stringify(newParams);
      oldCtx.pitchMutatorApplyLiveParams(oldNode, oldParams);
      newCtx.applyNodeGraphParamOffsets(newNode, newParams, { notify: false });
      // HP-09c: the Mutator's live playheadHz follows the incoming Hz when Freq In is wired, otherwise the audition key (C4 here, nothing wired),
      // instead of the stale stored value the baseline sent. Assert that value; then the rest of the params must be identical.
      if (oldNode.type === "pitchMutator") {
        const expected = newCtx.PitchMutatorEngine.hzFromNote(60);
        assert(Math.abs(newParams.playheadHz - expected) < 1e-9, `${label}: ${newNode.id} playheadHz is the audition-key Hz (${expected}), got ${newParams.playheadHz}`);
        oldParams.playheadHz = newParams.playheadHz;
      }
      if (JSON.stringify(oldParams) !== JSON.stringify(newParams)) {
        differing += 1;
        console.log("  differs", oldNode.id, JSON.stringify(oldParams), JSON.stringify(newParams));
      }
      if (JSON.stringify(newParams) !== base) moved += 1;
      // single-value path (applyToBase)
      for (const key of Object.keys(paramsOf(oldNode))) {
        const meta = oldNode.paramMeta?.[key] || {};
        const base1 = Number(oldNode.params[key]);
        const o = oldCtx.pitchMutatorApplyToBase(oldNode, key, base1, meta);
        const n = newCtx.applyNodeGraphParamOffsetsToBase(newNode, key, base1, meta);
        if (!Object.is(o, n)) {
          differing += 1;
          console.log("  base differs", oldNode.id, key, o, n);
        }
      }
      // the mutator's frequency table, set on the node as a side effect
      // HP-09d: a Frequency lane with keys is no longer valid (the Mutator's own frequency is not pinnable): they are dropped on load.
      if (oldNode._mutatorFreqLut?.valid) assert(newNode._mutatorFreqLut?.valid === false && newNode.mutator.freqLane.keys.length === 0, `${label}: ${oldNode.id} Frequency pins dropped`);
      else same(newNode._mutatorFreqLut ?? null, oldNode._mutatorFreqLut ?? null, `${label}: ${oldNode.id} frequency table`);
    }
    assert(differing === 0, `${label}: effective params identical before and after (${differing} differ)`);
    return moved;
  }

  const fixture = JSON.parse(read(patchFiles[0]));
  const movedPlain = compare("acoustic-bass fixture", fixture);
  const { copy } = withLanes(fixture);
  const movedLanes = compare("fixture with mutator lanes", copy);
  assert(movedLanes > movedPlain, "the lane fixture really moves params (the comparison is not trivially empty)");
  console.log(`ok  Pitch Mutator identical (fixture: ${movedPlain} nodes moved; with lanes: ${movedLanes} moved)`);
}

console.log("all HP-02 checks passed");
