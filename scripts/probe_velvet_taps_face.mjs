// Dark Velvet Reverb tap face in a real browser: loads the darkvelvetnoise demo
// patch and a bare Dark Velvet Reverb, checks the face mounts, draws, reads the
// native layout, and that the tap count follows Density x Decay. Screenshots to
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
    return { mounted: true, count: lay?.count ?? -1, length: lay?.length ?? -1, flags: lay?.flags ?? -1, id: el.dataset.node, rect: el.getBoundingClientRect().toJSON() };
  }).then((r) => ({ ...r, label }));
};

const before = errors.length;
const r1 = await loadAndRead(demo, "demo");
const node = demo.nodes.find((n) => n.type === "velvetReverb");
const want1 = Math.ceil(Number(node.params.density) * Number(node.params.decay) - 1e-9);
check(r1.mounted, "demo patch (old saved velvet settings) loads and mounts the tap face");
check(r1.count === want1, `demo face shows ${r1.count} taps (Density x Decay = ${want1})`);
if (SHOT_DIR && r1.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_demo.png") });

const bare = { ...demo, nodes: [{ id: "velvetReverb-9", type: "velvetReverb", gx: 2, gy: 2, params: { density: 40, decay: 0.8, darkness: 1, tailDarkness: 300, seed: 5 } }], connections: [] };
const r2 = await loadAndRead(bare, "bare");
check(r2.mounted && r2.count === 32, `bare module, Density 40 Hz x Decay 0.8 s: face shows ${r2.count} taps (32)`);
if (SHOT_DIR && r2.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_32.png") });
const big = { ...bare, nodes: [{ ...bare.nodes[0], params: { density: 20000, decay: 1, darkness: 2, tailDarkness: 0, seed: 5 } }] };
const r3 = await loadAndRead(big, "big");
check(r3.mounted && r3.count === 4096 && (r3.flags & 1), `Density 20000 x Decay 1 s: ${r3.count} taps, limit flag ${r3.flags & 1}`);
if (SHOT_DIR && r3.mounted) await page.locator(".node-velvet-taps-display").first().screenshot({ timeout: 120000, path: path.join(SHOT_DIR, "velvet_taps_max.png") });
const newErrors = errors.slice(before);
check(newErrors.length === 0, `no page errors (${newErrors.slice(0, 3).join(" | ")})`);
await browser.close();
if (failed) process.exit(1);
console.log("velvet taps face probe passed");