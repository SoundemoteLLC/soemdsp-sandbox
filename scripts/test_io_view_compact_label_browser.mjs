// HP-18: IO View A compact labels on the real page: real modules, real cables, the DOM label text the GL chrome draws; View B unchanged.
// Starts its own server.py on a free port (never 8765 / 8766 / 8080) unless SANDBOX_URL is set. No fixed sleeps.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(path.join(ROOT, "package.json"))("playwright")); }
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const MARK = "⁣";

let server = null, browser = null, step = "";
const errors = [];
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  // the late working-patch load can replace the graph: wait until the patch and its node count stop changing
  await page.waitForFunction(() => {
    const w = window; const patch = nodeGraphMvp.patch; const n = patch && patch.nodes ? patch.nodes.length : -1; const now = performance.now();
    if (!w.__settle || w.__settle.patch !== patch || w.__settle.n !== n) w.__settle = { patch, n, since: now };
    return now - w.__settle.since > 2000;
  }, null, { timeout: 120000, polling: 100 });
  await page.evaluate(() => { if (nodeGraphIoView() !== "A") setNodeGraphIoView("A"); });
  const shotIf = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + ".png") }); };

  step = "add modules";
  const ids = await page.evaluate(() => {
    const o = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    return {
      kb: showNodeGraphModule("keyboard", { x: 60, y: 60 }, o),
      osc: showNodeGraphModule("polyBlep", { x: 700, y: 60 }, o),
      flt: showNodeGraphModule("flowerChildFilter", { x: 1100, y: 60 }, o),
      out: showNodeGraphModule("output", { x: 700, y: 500 }, o),
    };
  });
  await page.waitForFunction((i) => Object.values(i).every((id) => document.querySelector(`.dsp-node[data-node="${id}"] .node-io-compact-label`)), ids);
  // each module's sides, straight from the DOM the app built
  const sides = () => page.evaluate(({ i, mark }) => {
    const out = {};
    for (const [name, id] of Object.entries(i)) {
      const el = document.querySelector(`.dsp-node[data-node="${id}"]`);
      out[name] = {};
      for (const io of ["input", "output"]) {
        const col = el.querySelector(`:scope > .node-solid-module-shell > .node-io-column.${io}`);
        const rows = col ? [...col.querySelectorAll(":scope > .node-io-row")] : [];
        out[name][io] = {
          ports: rows.map((r) => ({ port: r.dataset.port, label: r.querySelector(":scope > .node-io-label").textContent })),
          compact: col && col.querySelector(":scope > .node-io-compact-label") ? col.querySelector(":scope > .node-io-compact-label").textContent.replace(mark, "") : null,
        };
      }
    }
    return out;
  }, { i: ids, mark: MARK });
  const s0 = await sides();
  console.log("sides", JSON.stringify(Object.fromEntries(Object.entries(s0).map(([k, v]) => [k, { in: v.input.ports.map((p) => p.label), out: v.output.ports.map((p) => p.label) }]))));

  step = "nothing connected";
  // (showNodeGraphModule("output") returns the patch's existing Output, which already has cables: only uncabled modules are checked here)
  const cabled = await page.evaluate((i) => Object.fromEntries(Object.entries(i).map(([name, id]) => [name, nodeGraphMvp.patch.connections.some((c) => c.sourceNode === id || c.destinationNode === id)])), ids);
  for (const [name, side] of Object.entries(s0)) {
    if (cabled[name]) continue;
    for (const io of ["input", "output"]) {
      const n = side[io].ports.length;
      if (n === 1) assert.equal(side[io].compact, side[io].ports[0].label, `${name} ${io}: one jack shows its label with no cable`);
      else if (n > 1) assert.equal(side[io].compact, "", `${name} ${io}: several jacks, none connected, blank`);
    }
  }
  const compactOf = (id, io) => `.dsp-node[data-node="${id}"] .node-io-column.${io} > .node-io-compact-label`;
  const wire = (src, sp, dst, dp) => page.evaluate(({ src, sp, dst, dp }) => {
    nodeGraphMvp.patch.connections.push({ sourceNode: src, sourcePort: sp, destinationNode: dst, destinationPort: dp });
    commitNodeGraphPatch(nodeGraphMvp.patch, { status: "wire" });
  }, { src, sp, dst, dp });
  const unwire = (src, sp, dst, dp) => page.evaluate(({ src, sp, dst, dp }) => {
    nodeGraphMvp.patch.connections = nodeGraphMvp.patch.connections.filter((c) => !(c.sourceNode === src && c.sourcePort === sp && c.destinationNode === dst && c.destinationPort === dp));
    commitNodeGraphPatch(nodeGraphMvp.patch, { status: "unwire" });
  }, { src, sp, dst, dp });
  const compact = async (name, io) => (await sides())[name][io].compact;
  const waitText = (sel, test) => page.waitForFunction(({ sel, src }) => new Function("t", "return " + src)(document.querySelector(sel).textContent.replace("⁣", "")), { sel, src: test });

  step = "one connected";
  const kbOuts = s0.kb.output.ports;
  assert.ok(kbOuts.length > 1, "the Keyboard has several outputs");
  const kbF = kbOuts.find((p) => p.port === "f") || kbOuts[3];
  const oscIn = s0.osc.input.ports.find((p) => p.port === "f") || s0.osc.input.ports[0];
  await wire(ids.kb, kbF.port, ids.osc, oscIn.port);
  await waitText(compactOf(ids.kb, "output"), `t === ${JSON.stringify(kbF.label)}`);
  assert.equal(await compact("kb", "output"), kbF.label, "several outputs, one connected: that jack's label");
  if (s0.osc.input.ports.length > 1) assert.equal(await compact("osc", "input"), oscIn.label, "the other end: the connected input's label");
  await shotIf("one-connected");

  step = "two connected";
  const kbOther = kbOuts.find((p) => p.port !== kbF.port && p.port !== "Play Keys") || kbOuts.find((p) => p.port !== kbF.port);
  const fltIn = s0.flt.input.ports.find((p) => p.port === "f") || s0.flt.input.ports[0];
  await wire(ids.kb, kbOther.port, ids.flt, fltIn.port);
  // HP-22: more than one connection on a side shows only the count.
  await waitText(compactOf(ids.kb, "output"), 't === "2"');
  assert.equal(await compact("kb", "output"), "2", "two connected: the count of connections");
  await shotIf("two-connected");

  step = "unwire";
  await unwire(ids.kb, kbOther.port, ids.flt, fltIn.port);
  await waitText(compactOf(ids.kb, "output"), `t === ${JSON.stringify(kbF.label)}`);
  assert.equal(await compact("kb", "output"), kbF.label, "removing a cable updates the label");
  await unwire(ids.kb, kbF.port, ids.osc, oscIn.port);
  await waitText(compactOf(ids.kb, "output"), 't === ""');
  assert.equal(await compact("kb", "output"), "", "no cable on a several-jack side: blank again");

  step = "one jack per side";
  {
    const type = await page.evaluate(() => Object.keys(nodeGraphModuleDefinitions).find((k) => {
      const d = nodeGraphModuleDefinitions[k];
      return Array.isArray(d.inputs) && d.inputs.length === 1 && Array.isArray(d.outputs) && d.outputs.length === 1 && d.layout !== "canvas" && typeof nodeGraphModuleUsesLayoutB === "function" && nodeGraphModuleUsesLayoutB(k);
    }));
    assert.ok(type, "a module with one jack on each side exists");
    const one = await page.evaluate((ty) => showNodeGraphModule(ty, { x: 1100, y: 500 }, { record: false, autosaveWorkingPatch: false, skipLivePlan: true }), type);
    await page.waitForFunction((id) => document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.input > .node-io-compact-label`) && document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.output > .node-io-compact-label`), one);
    const read = () => page.evaluate(({ id, mark }) => ({
      inLabel: document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.input > .node-io-row > .node-io-label`).textContent,
      outLabel: document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.output > .node-io-row > .node-io-label`).textContent,
      inCompact: document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.input > .node-io-compact-label`).textContent.replace(mark, ""),
      outCompact: document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.output > .node-io-compact-label`).textContent.replace(mark, ""),
    }), { id: one, mark: MARK });
    let r = await read();
    assert.equal(r.inCompact, r.inLabel, `${type}: one input jack shows its label with no cable`);
    assert.equal(r.outCompact, r.outLabel, `${type}: one output jack shows its label with no cable`);
    await wire(ids.kb, "f", one, (await sides()) && (await page.evaluate((id) => document.querySelector(`.dsp-node[data-node="${id}"] .node-io-column.input > .node-io-row`).dataset.port, one)));
    r = await read();
    assert.equal(r.inCompact, r.inLabel, `${type}: and still when it is cabled`);
    await shotIf("one-jack");
  }

  step = "view B";
  await wire(ids.kb, kbF.port, ids.osc, oscIn.port);
  await waitText(compactOf(ids.kb, "output"), 't !== ""');
  await page.evaluate(() => setNodeGraphIoView("B"));
  const b = await page.evaluate((i) => {
    const col = document.querySelector(`.dsp-node[data-node="${i.kb}"] .node-io-column.output`);
    const c = col.querySelector(":scope > .node-io-compact-label");
    return {
      compactText: c.textContent,
      compactDisplay: getComputedStyle(c).display,
      jackNames: [...col.querySelectorAll(":scope > .node-io-row > .node-io-label")].map((e) => e.textContent),
      gl: nodeGraphIoViewLabelText("name"),
    };
  }, ids);
  assert.equal(b.compactText, "", "View B writes no compact label");
  assert.equal(b.compactDisplay, "none");
  assert.deepEqual(b.jackNames, s0.kb.output.ports.map((p) => p.label), "View B still has every jack's full name");
  assert.equal(b.gl, "name", "View B draws full jack names");
  await shotIf("view-b");
  await page.evaluate(() => setNodeGraphIoView("A"));
  await waitText(compactOf(ids.kb, "output"), 't !== ""');
  assert.equal(await page.evaluate(() => nodeGraphIoViewLabelText("name")), "", "View A hides per-jack names");
  assert.equal(await page.evaluate((m) => nodeGraphIoViewLabelText(m + "⎍, 1"), MARK), "⎍, 1", "but lets a compact label through");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".node-io-compact-label[title]").length), 0, "no title on the labels");
  await shotIf("view-a");

  assert.deepEqual(errors, [], "no page errors");
  console.log("test_io_view_compact_label_browser: ok");
} catch (e) {
  console.error(`FAILED at "${step}":`, e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
