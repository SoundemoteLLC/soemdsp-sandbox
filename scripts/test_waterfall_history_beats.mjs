// Waterfall History = Beats (Argi 2026-11-16): Instant Waterfall / RGB / XYZ
// (and 1D Onset, a Waterfall-form face) get History Seconds | Beats; Beats =
// historyCycles beats at the transport tempo, through the shared scope-sync
// Beats math (nodeGraphScopeBeatsSeconds), not a copy.
//   node scripts/test_waterfall_history_beats.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };
const SR = 48000;
const ctx = {
  console, Math, Number, Boolean, String, Array, Object, Float64Array, Float32Array, JSON,
  performance: { now: () => 1 },
  nodeGraphFiniteNumber: (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb),
  nodeGraphScopeSampleRate: (b) => Number(b?.nodeGraphScopeSampleRate) || 0,
  clampNodeSliderValue: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  nodeGraphMvp: { patch: { timing: { tempoBpm: 100 } }, sampleRate: SR },
  nodeGraphModuleScopeState: { sampleRate: SR },
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const rel of ["public/lib/visual/scope-sync.js", "public/node-graph-module-scope-normalize.js", "public/node-graph-module-scope-waterfall.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), ctx, { filename: rel });
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Settings: default stays Seconds; Beats is kept; the count is historyCycles.
{
  const n = ctx.normalizeNodeGraphWaterfallHistory;
  check(n({ historySeconds: 8 }).historyMode === "seconds" && n({ historySeconds: 8 }).historySeconds === 8, "default History stays Seconds (8 s kept)");
  check(n({ historyMode: "beats", historyCycles: 2.5 }).historyMode === "beats" && n({ historyMode: "beats", historyCycles: 2.5 }).historyCycles === 2.5, "History Beats is kept, 2.5 beats stays fractional");
  check(n({ historyMode: "bogus" }).historyMode === "seconds", "an unknown History mode is Seconds");
}

// Seconds of history.
{
  const h = ctx.nodeGraphWaterfallHistorySeconds;
  check(near(h({ historySeconds: 8 }), 8), "Seconds: History (seconds) as before");
  // Ring with the engine's transport clock: 140 BPM at a 48 kHz ring.
  const ring = new Float32Array(16);
  ring.nodeGraphScopeSampleRate = SR;
  ring.nodeGraphScopeBeatEnd = 12.3;
  ring.nodeGraphScopeBeatsPerSample = 140 / (60 * SR);
  check(near(h({ historyMode: "beats", historyCycles: 4, historySeconds: 8 }, ring), 4 * 60 / 140), `Beats 4 at the engine's 140 BPM = ${(240 / 140).toFixed(4)} s`);
  // A decimated ring (12 kHz write rate) gives the same seconds.
  const slow = new Float32Array(16);
  slow.nodeGraphScopeSampleRate = 12000;
  slow.nodeGraphScopeBeatEnd = 1;
  slow.nodeGraphScopeBeatsPerSample = 140 / (60 * 12000);
  check(near(h({ historyMode: "beats", historyCycles: 4 }, slow), 4 * 60 / 140), "Beats on a decimated ring: same seconds");
  check(near(h({ historyMode: "beats", historyCycles: 2 }), 2 * 60 / 100), "Beats without the engine's clock: the patch tempo (2 beats at 100 BPM = 1.2 s)");
  check(near(ctx.nodeGraphScopeBeatsSeconds(1, ring, SR), 60 / 140), "shared helper: 1 beat at 140 BPM");
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
