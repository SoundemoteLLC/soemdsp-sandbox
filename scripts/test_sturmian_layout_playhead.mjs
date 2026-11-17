#!/usr/bin/env node
// Sturmian Grid: auto-fit whole-pixel cells, integer black margins, playhead step map.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function rowsNeeded(spread) {
  const spreadN = Math.max(1, Math.floor(Number(spread) + 0.5) || 1);
  return 3 * spreadN + 1;
}

function gridLayout(width, height, steps, spread, _zoom, _baseCell) {
  const playCols = Math.max(2, Math.floor(Number(steps) + 0.5) || 2);
  const need = Math.max(1, rowsNeeded(spread));
  const cell = Math.max(2, Math.floor(Math.min(
    Math.max(1, width) / playCols,
    Math.max(1, height) / need
  )));
  const cols = Math.max(1, Math.floor(Math.max(1, width) / cell));
  const rows = Math.max(1, Math.floor(Math.max(1, height) / cell));
  return {
    playCols, cell, cols, rows,
    padLeft: Math.max(0, Math.floor((cols - playCols) * 0.5)),
    ox: Math.floor((width - cols * cell) * 0.5),
    oy: Math.floor((height - rows * cell) * 0.5),
  };
}

// Engine writes phase = (step % steps) / steps. Face recovers the step.
function playStepFromPhase(phase, steps) {
  const stepCount = Math.max(1, Number(steps) || 1);
  if (!Number.isFinite(phase)) return { playStep: 0, playing: 0 };
  return {
    playStep: Math.max(0, Math.min(stepCount - 1, Math.floor(phase * stepCount + 1e-6))),
    playing: 1,
  };
}

const a = gridLayout(400, 300, 16, 1, 1, 14);
assert(a.cell === 25, `auto-fit 16x4 into 400x300 is 25, got ${a.cell}`);
assert(a.playCols === 16, "16 sounding columns");
assert(a.cols >= 16, "continuation columns may pack leftover");
assert(a.ox === Math.floor((400 - a.cols * a.cell) / 2), "integer centered ox");
assert((400 - a.cols * a.cell) - a.ox * 2 <= 1, "remainder is a whole-pixel margin");

const short = gridLayout(400, 300, 2, 1, 1, 14);
assert(short.cell === 75, `2 steps x spread 1 zooms in to 75, got ${short.cell}`);
assert(short.playCols === 2, "2 sounding columns");
assert(short.cols > 2, "leftover width is dimmed continuation squares");
assert(short.rows === 4, "Track Spread window is 4 rows");

const twelve = gridLayout(400, 300, 12, 1, 1, 14);
assert(twelve.cell === Math.floor(Math.min(400 / 12, 300 / 4)), "12 steps auto-fit larger than base 14");
assert(twelve.cell > 14, `12-step cell grows, got ${twelve.cell}`);

const c = gridLayout(800, 600, 16, 1, 2, 14);
assert(c.cell === 50, `800x600 / 16x4 auto-fit is 50, got ${c.cell}`);
const leftover = 800 - c.cols * c.cell;
assert(leftover < c.cell, "leftover is a sub-cell margin");
assert(c.ox === Math.floor(leftover / 2), "centered remainder");

const d1 = gridLayout(800, 600, 16, 1, 2.0, 14);
const d2 = gridLayout(800, 600, 16, 1, 2.07, 14);
assert(d1.cell === d2.cell, "cell is fit to the face, not baseCell * zoom");

const e = gridLayout(100, 80, 16, 1, 4, 14);
assert(e.cell === Math.floor(100 / 16), `fits 16 cols, got ${e.cell}`);
assert(e.cols >= 16, "sounding bar still fits");

for (let steps = 2; steps <= 32; steps += 1) {
  for (let step = 0; step < steps; step += 1) {
    const phase = step / steps;
    const got = playStepFromPhase(phase, steps);
    assert(got.playing === 1, "finite phase means playing");
    assert(got.playStep === step, `steps=${steps} step=${step} phase=${phase} -> ${got.playStep}`);
  }
}
assert(playStepFromPhase(Number.NaN, 16).playing === 0, "missing phase is not playing");

const ui = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid-ui.js"), "utf8");
assert(ui.includes("largest whole-device-pixel"), "UI auto-fits the playable area");
assert(!ui.includes("floor(base * z)"), "UI no longer starts from baseCell * zoom");
assert(ui.includes("layoutCell"), "shader gets JS layout uniforms");
assert(ui.includes("planScopeCapture"), "comments mention planScopeCapture");
const glsl = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid.glsl"), "utf8");
assert(glsl.includes("mix(base, vec3(1.0), 0.16)"), "0.16 white play column");
assert(glsl.includes("hitBits") && glsl.includes("(bits & bit) != 0u"), "binary hit bits, no fade");
assert(!glsl.includes("flashAmt"), "no smooth hit fade");
assert(!glsl.includes("mix(base, laneColor(trackHit), 0.85)"), "no inset 0.85 hit fill");
assert(glsl.includes("trackStrokeAlpha") && glsl.includes("playheadStrokeAlpha"), "separate stroke alphas");
assert(glsl.includes("sturmianGridVLine") && glsl.includes("sturmianOnRectLines"), "strokes sit on grid gutter/edge lines");
assert(ui.includes("sturmianAccumulateHits") && ui.includes("sturmianClearDrawnHits"), "hits latch until after the frame is drawn");
assert(glsl.includes("playing > 0.5"), "playhead gated on playing");
const reg = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid-register.js"), "utf8");
assert(reg.includes("planScopeCapture: true"), "register opts into scope capture");
assert(reg.includes('["reset", "walk", "snap"]'), "Reset After stays in the param band");
assert(ui.includes('kind === "reset"') && ui.includes("resetCellSize"), "Reset After drag cell on the strip");
assert(glsl.includes("l0 = 14") && glsl.includes("sturmianFitScale"), "reset label uses fitting strip glyphs");
assert(glsl.includes("cell >= 16.0"), "gutters only when the cell is at least 16px");
assert(glsl.includes("labelCount = 1") && glsl.includes("labelCount = 0"), "RESET compact forms: R+value then value only");
const plan = fs.readFileSync(path.join(root, "public/node-graph-execution-plan.js"), "utf8");
assert(plan.includes("planScopeCapture"), "execution plan honors planScopeCapture");

console.log("ok  sturmian whole-pixel cells and playhead step map");
