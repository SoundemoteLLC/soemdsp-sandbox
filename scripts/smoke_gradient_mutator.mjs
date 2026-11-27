// PASTE-8 release smoke (reports; not a unit test): gradients and Pitch Mutators after the store / grip / one-per-gradient changes.
//   - a patch with two gradients, a Gradient module on each and a Pitch Mutator with a knob lane: the gradient moves its param with
//     the playhead, the Mutator moves its param with its note; serialize -> load -> serialize and clone give the same patch; no error
//     dialog, no page or console error;
//   - the old patches that hold Pitch Mutators (patches/acoustic/bass.json, bass2.json, read only) load and round-trip the same way.
// Real page on its own server.py port unless SANDBOX_URL.   node scripts/smoke_gradient_mutator.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }

const problems = [];
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
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  const roundTrip = `
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const dialogs = () => [...document.querySelectorAll(".node-patch-load-fault, [role=alertdialog]")].filter((el) => !el.hidden && el.getBoundingClientRect().width > 0).length;
    const trip = async () => {
      const s1 = serializeNodeGraphPatch(nodeGraphMvp.patch);
      commitNodeGraphPatch(loadNodeGraphPatchFromScript(s1), { patchDirtyState: "saved" });
      await wait(300);
      const s2 = serializeNodeGraphPatch(nodeGraphMvp.patch);
      const s3 = serializeNodeGraphPatch(cloneNodeGraphPatch(nodeGraphMvp.patch));
      return { saveLoad: s1 === s2, clone: s2 === s3, dialogs: dialogs() };
    };`;

  // 1. Two gradients with their modules, and a Pitch Mutator with a knob lane.
  const built = await page.evaluate(new Function(`return (async () => { ${roundTrip}
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const osc = patch.nodes.find((n) => n.type === "polyBlep");
    const metaF = nodeGraphReadPatchParameterMetadata(osc, "frequency");
    const other = Object.keys(osc.params).find((k) => k !== "frequency" && Number.isFinite(Number(osc.params[k])) && !NodeGraphGradients.isDiscrete(nodeGraphReadPatchParameterMetadata(osc, k) || {}));
    const g = (id, name, key) => ({ id, name, enabled: true, position: 0, origin: { [osc.id]: { [key]: nodeGraphParamControlPosition(osc.params[key], nodeGraphReadPatchParameterMetadata(osc, key)) } },
      params: [{ nodeId: osc.id, key }], stops: [{ id: id + "a", pos: 0, offsets: {} }, { id: id + "b", pos: 1, offsets: { [osc.id]: { [key]: 0.2 } } }] });
    patch.gradients = [g("g1", "Pitch", "frequency")];
    const m1 = createNodeGraphPatchNode("gradient", { id: "gradient-1", gx: 4, gy: 40 });
    m1.gradientId = "g1";
    const mut = createNodeGraphPatchNode("pitchMutator", { id: "pitchMutator-1", gx: 30, gy: 40 });
    mut.mutator = { freqLane: { keys: [] }, lanes: [{ id: "L1", target: { nodeId: osc.id, paramKey: other }, keys: [{ x: 40, offset: 0 }, { x: 80, offset: 0.3 }] }], autoPin: false, snap: true, activeLane: "L1" };
    patch.nodes.push(m1, mut);
    commitNodeGraphPatch(loadNodeGraphPatchFromScript(JSON.stringify(patch)), { patchDirtyState: "saved" });
    await wait(400);
    const live = () => nodeGraphPatchNode(osc.id);
    const sounding = (key) => applyNodeGraphParamOffsetsToBase(live(), key, Number(live().params[key]), nodeGraphReadPatchParameterMetadata(live(), key));
    const grad = nodeGraphMvp.patch.gradients.find((x) => x.id === "g1");
    grad.position = 0; nodeGraphGradientsNotifyChanged("smoke"); const f0 = sounding("frequency");
    grad.position = 1; nodeGraphGradientsNotifyChanged("smoke"); const f1 = sounding("frequency");
    const mnode = nodeGraphPatchNode("pitchMutator-1");
    mnode.params = { ...mnode.params, playhead: 40 }; const o40 = sounding(other);
    mnode.params = { ...mnode.params, playhead: 80 }; const o80 = sounding(other);
    grad.position = 0;
    const rt = await trip();
    return { other, gradientDrives: f1 !== f0, f0, f1, mutatorDrives: o80 !== o40, o40, o80, ...rt,
      modules: nodeGraphMvp.patch.nodes.filter((n) => n.type === "gradient" || n.type === "pitchMutator").map((n) => n.id + ":" + (n.gradientId || "")) };
  })()`));
  console.log("built patch:", JSON.stringify(built));
  if (!built.gradientDrives) problems.push(`the gradient does not move its param (${built.f0} -> ${built.f1})`);
  if (!built.mutatorDrives) problems.push(`the Pitch Mutator does not move ${built.other} (${built.o40} -> ${built.o80})`);
  if (!built.saveLoad) problems.push("built patch: serialize -> load -> serialize differs");
  if (!built.clone) problems.push("built patch: clone differs");
  if (built.dialogs) problems.push(`built patch: ${built.dialogs} error dialog(s)`);

  // 2. The old patches that hold Pitch Mutators (read only).
  for (const file of ["patches/acoustic/bass.json", "patches/acoustic/bass2.json"]) {
    const r = await page.evaluate(new Function("url", `return (async () => { ${roundTrip}
      const text = await (await fetch(url)).text();
      commitNodeGraphPatch(loadNodeGraphPatchFromScript(text), { patchDirtyState: "saved" });
      await wait(500);
      const mutators = nodeGraphMvp.patch.nodes.filter((n) => n.type === "pitchMutator").length;
      return { mutators, ...(await trip()) };
    })()`), baseUrl + file);
    console.log(`${file}:`, JSON.stringify(r));
    if (!r.mutators) problems.push(`${file}: no Pitch Mutator after load`);
    if (!r.saveLoad) problems.push(`${file}: serialize -> load -> serialize differs`);
    if (!r.clone) problems.push(`${file}: clone differs`);
    if (r.dialogs) problems.push(`${file}: ${r.dialogs} error dialog(s)`);
  }
  for (const e of errors) problems.push(e);
} finally {
  await browser?.close();
  server?.kill();
}
for (const p of problems) console.log(`PROBLEM ${p}`);
console.log(`smoke_gradient_mutator: ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
