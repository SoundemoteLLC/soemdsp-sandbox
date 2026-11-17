#!/usr/bin/env node
// Sturmian Grid: whole-pixel cell zoom, integer black margins, playhead step map.
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

function gridLayout(width, height, steps, spread, zoom, baseCell) {
  const playCols = Math.max(2, Math.floor(Number(steps) + 0.5) || 2);
  const need = Math.max(1, rowsNeeded(spread));
  const z = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;
  const base = Math.max(2, Math.floor(Number(baseCell) + 0.5) || 14);
  let cell = Math.max(2, Math.floor(base * z));
  const maxFit = Math.max(2, Math.floor(Math.min(
    Math.max(1, width) / playCols,
    Math.max(1, height) / need
  )));
  if (cell > maxFit) cell = maxFit;
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
assert(a.cell === 14, `zoom1 cell is 14, got ${a.cell}`);
assert(a.playCols === 16, "16 sounding columns");
assert(a.ox === Math.floor((400 - a.cols * 14) / 2), "integer centered ox");
assert((400 - a.cols * a.cell) - a.ox * 2 <= 1, "remainder is a whole-pixel margin");

const b = gridLayout(800, 600, 16, 1, 1.9, 14);
assert(b.cell === 26, `cell is floor(14*1.9)=26, got ${b.cell}`);

const c = gridLayout(800, 600, 16, 1, 2, 14);
assert(c.cell === 28, "zoom 2 doubles 14 to 28");
const leftover = 800 - c.cols * c.cell;
assert(leftover < c.cell, "leftover is a sub-cell margin");
assert(c.ox === Math.floor(leftover / 2), "centered remainder");

const d1 = gridLayout(800, 600, 16, 1, 2.0, 14);
const d2 = gridLayout(800, 600, 16, 1, 2.07, 14);
assert(d1.cell === 28 && d2.cell === 28, "cell stays 28 until floor(14*zoom) ticks");

const e = gridLayout(100, 80, 16, 1, 4, 14);
assert(e.cell === Math.floor(100 / 16), `shrunk to fit 16 cols, got ${e.cell}`);
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
assert(ui.includes("floor(base * z)"), "UI uses floor(baseCell * zoom)");
assert(ui.includes("layoutCell"), "shader gets JS layout uniforms");
assert(ui.includes("planScopeCapture"), "comments mention planScopeCapture");
const glsl = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid.glsl"), "utf8");
assert(glsl.includes("mix(base, vec3(1.0), 0.16)"), "0.16 white play column");
assert(glsl.includes("mix(base, laneColor(trackHit), flashAmt)"), "hit flash fills the square with track color");
assert(!glsl.includes("mix(base, laneColor(trackHit), 0.85)"), "no inset 0.85 hit fill");
assert(glsl.includes("trackStrokeAlpha") && glsl.includes("playheadStrokeAlpha"), "separate stroke alphas");
assert(glsl.includes("playing > 0.5"), "playhead gated on playing");
const reg = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid-register.js"), "utf8");
assert(reg.includes("planScopeCapture: true"), "register opts into scope capture");
const plan = fs.readFileSync(path.join(root, "public/node-graph-execution-plan.js"), "utf8");
assert(plan.includes("planScopeCapture"), "execution plan honors planScopeCapture");

console.log("ok  sturmian whole-pixel cells and playhead step map");
