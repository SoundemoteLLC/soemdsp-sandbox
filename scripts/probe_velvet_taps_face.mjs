// Dark Velvet Reverb tap face in a real browser: loads the darkvelvetnoise demo
// patch and a bare Dark Velvet Reverb, checks the face mounts, draws, reads the
// native layout, and that the tap count follows Taps (Length only spreads them). Screenshots to
// SHOT_DIR (default: none).
//   SANDBOX_URL=http://127.0.0.1:8766/ node scripts/probe_velvet_taps_face.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SANDBOX_URL || "http://127.0.0.1:8766/";
const SHOT_DIR = process.env.SHOT_DIR || "";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err.message || err)));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const start = page.locator("#nodeBootStartButton");
if (await start.count()) await start.click().catch(() => {});
await page.waitForFunction(() => typeof window.loadNodeGraphPatchFromObject === "function" && typeof window.commitNodeGraphPatch === "function" && typeof window.createNodeGraphVelvetTapsDisplay === "function", null, { timeout: 120000 });
await page.waitForTimeout(1500);

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };

const demo = JSON.parse(fs.readFileSync(path.join(root, "patches", "demo_patches", "darkvelvetnoise.json"), "utf8"));
const loadAndRead = async (patch, label) => {
  await page.evaluate((p) => commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "velvet taps probe" }), patch);
  // Headless software GL is slow: wait for the face to hold a layout (wasm loaded, drawn).
  await page.waitForFunction(() => document.querySelector(".node-velvet-taps-display")?._velvetTapsLayout, null, { timeout: 300000, polling: 1000 }).catch(() => {});
  return page.evaluate(() => {
    const el = document.querySelector(".node-velvet-taps-display");
    if (!el) return { mounted: false };
    const lay = el._velvetTapsLayout;
    const node = nodeGraphPatchNode(el.dataset.node);
    const def = nodeGraphModuleDefinitions?.[node?.type]?.defaultDisplaySettings || {};
    const look = normalizeNodeGraphPulseTrainFaceSettings({ ...def, ...(node?.traceDisplaySettings || {}) });
    const lv = lay ? [...lay.level, ...lay.levelR] : [];
    const n = lay?.count || 0;
    const mean = n ? Array.from(lay.pos).reduce((a, b) => a + b, 0) / n / lay.length : -1;
    const q = Math.max(1, Math.floor(n / 10));
    let first = 0, last = 0;
    for (let k = 0; k < q && n; k += 1) { first += Math.abs(lay.level[k]); last += Math.abs(lay.level[n - 1 - k]); }
    const knobs = (nodeGraphModuleDefinitions?.velvetReverb?.parameters || []).filter((p) => p.key === "ampDecay" || p.key === "densitySkew" || p.key === "minGap").map((p) => `${p.key} ${p.min}..${p.max} = ${p.defaultValue}`);
    return { mounted: true, left: look.leftPaint, right: look.rightPaint, mean, endDb: first > 0 ? 20 * Math.log10(last / first) : 0, knobs, neg: lv.filter((v) => v < 0).length, pos: lv.filter((v) => v > 0).length, dot: look.dotThickness, count: lay?.count ?? -1, length: lay?.length ?? -1, flags: lay?.flags ?? -1, id: el.dataset.node, rect: el.getBoundingClientRect().toJSON() };
  }).then((r) => ({ ...r, label }));
};

const before = errors.length;
const r1 = await loadAndRead(demo, "demo");
const node = demo.nodes.find((n) => n.type === "velvetReverb");
const want1 = Math.min(4096, Math.ceil(Number(node.params.density) - 1e-9));
check(r1.mounted, "demo patch (old saved velvet settings) loads and mounts the tap face");
// Min Gap (default 1 ms) may hold back taps that would bunch up: then the face shows fewer and flags it.
check(r1.count === want1 || (r1.count > 0 && r1.count < want1 && (r1.flags & 4)), `demo face shows ${r1.count} taps (Taps = ${want1}, flags ${r1.flags})`);
if (SHOT_DIR && r1.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_demo.png") });

const bare = { ...demo, nodes: [{ id: "velvetReverb-9", type: "velvetReverb", gx: 2, gy: 2, params: { density: 40, decay: 0.8, darkness: 1, tailDarkness: 300, seed: 5 } }], connections: [] };
const r2 = await loadAndRead(bare, "bare");
check(r2.dot === 0, `bare module: Dot size defaults to ${r2.dot} (0, from defaultDisplaySettings)`);
check(r2.pos > 0 && r2.neg > 0, `bipolar: ${r2.pos} + taps, ${r2.neg} - taps in the face layout`);
check(r2.mounted && r2.count === 40, `bare module, Taps 40 over Length 0.8 s: face shows ${r2.count} taps (40)`);
if (SHOT_DIR && r2.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_32.png") });
check(r2.left === "rgb(255 113 113)" && r2.right === "rgb(84 84 249)", `default inks: Left ${r2.left} (#FF7171), Right ${r2.right} (#5454F9)`);
check(r2.knobs?.length === 3, `definitions carry Amp Decay, Density Skew and Min Gap: ${(r2.knobs || []).join("; ")}`);
// Tail Darkness off: wider late pulses get their lost energy back, which would tilt the levels.
const knobbed = { ...bare, nodes: [{ ...bare.nodes[0], params: { ...bare.nodes[0].params, density: 200, tailDarkness: 0, ampDecay: 0, densitySkew: 0.6, minGap: 0.083 } }] };
const rk = await loadAndRead(knobbed, "knobs");
check(rk.count === 200 && Math.abs(rk.endDb) < 0.5 && rk.mean < 0.4, `Amp Decay 0 dB + Skew 0.6 on the face: ${rk.count} taps, end ${rk.endDb.toFixed(2)} dB (flat), mean position ${rk.mean.toFixed(3)} of Length (packed early)`);
if (SHOT_DIR && rk.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_knobs.png") });
const big = { ...bare, nodes: [{ ...bare.nodes[0], params: { density: 20000, decay: 1, darkness: 2, tailDarkness: 0, seed: 5, minGap: 0 } }] };
const r3 = await loadAndRead(big, "big");
// Taps: spawn slider max 300, hardMax = the engine's table (4096); a typed value past the slider max
// still works and stops at hardMax, so no limit flag is needed.
{
  const tapsDef = await page.evaluate(() => (nodeGraphModuleDefinitions?.velvetReverb?.parameters || []).find((p) => p.key === "density"));
  check(tapsDef?.max === "300" && tapsDef?.hardMax === "4096", `Taps spawn max ${tapsDef?.max}, hardMax ${tapsDef?.hardMax}`);
}
check(r3.mounted && r3.count === 4096 && !(r3.flags & 1), `Taps 20000 typed: past the 300 slider max, hardMax holds it at ${r3.count} taps (limit flag ${r3.flags & 1})`);
if (SHOT_DIR && r3.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_max.png") });
const newErrors = errors.slice(before);
check(newErrors.length === 0, `no page errors (${newErrors.slice(0, 3).join(" | ")})`);
await browser.close();
if (failed) process.exit(1);
console.log("velvet taps face probe passed");