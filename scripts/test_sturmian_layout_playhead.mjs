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
assert(!ui.includes("baseCell: base"), "no leftover baseCell: base from removed baseCell");
assert(ui.includes("layoutCell"), "shader gets JS layout uniforms");
assert(ui.includes("planScopeCapture"), "comments mention planScopeCapture");
const glsl = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid.glsl"), "utf8");
assert(glsl.includes("mix(base, vec3(1.0), 0.16)"), "0.16 white play column");
assert(glsl.includes("hitBits") && glsl.includes("(bits & bit) != 0u"), "binary hit bits, no fade");
assert(!glsl.includes("flashAmt"), "no smooth hit fade");
assert(!glsl.includes("mix(base, laneColor(trackHit), 0.85)"), "no inset 0.85 hit fill");
assert(glsl.includes("trackStrokeAlpha") && glsl.includes("playheadStrokeAlpha"), "separate stroke alphas");
assert(glsl.includes("sturmianGridLeading") && glsl.includes("sturmianGridTrailing") && glsl.includes("sturmianOnRectLines"), "strokes use leading/trailing cell-edge lines");
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


// Track-span and playhead frames: all 4 sides land on packed-grid pixels
// at every auto-fit size, Steps, Track Spread, and gutter state.
function gridLineStart(i, cellDev) {
  return Math.floor(Math.max(0, i) * cellDev + 1e-4);
}
function gridLeading(i, count, cellDev, gridEnd) {
  const last = Math.max(0, gridEnd - 1);
  if (i <= 0) return 0;
  if (i >= count) return last;
  return Math.min(last, Math.max(0, gridLineStart(i, cellDev)));
}
function gridTrailing(i, count, cellDev, gridEnd, guttersOn) {
  const last = Math.max(0, gridEnd - 1);
  if (i >= count) return last;
  const start = gridLineStart(i, cellDev);
  const line = guttersOn ? start : start - 1;
  return Math.min(last, Math.max(0, line));
}
function assertRectOnCanvas(lineL, lineR, lineT, lineB, lastX, lastY, label) {
  assert(lineL >= 0 && lineT >= 0, `${label} left/top on-canvas`);
  assert(lineR <= lastX && lineB <= lastY, `${label} right/bottom on-canvas, got R=${lineR}/${lastX} B=${lineB}/${lastY}`);
  assert(lineR > lineL, `${label} right is past left (L=${lineL} R=${lineR})`);
  assert(lineB > lineT, `${label} bottom is past top (T=${lineT} B=${lineB})`);
  const sides = [lineL, lineR, lineT, lineB];
  assert(sides.every((v) => Number.isFinite(v) && Math.floor(v) === v), `${label} whole-pixel edges`);
}

let spanCases = 0;
const widths = [64, 100, 101, 240, 400, 401, 800, 1920];
const heights = [32, 80, 81, 200, 300, 600];
const stepList = [2, 3, 7, 12, 16, 24, 32];
const spreads = [1, 2, 3, 4];
for (const width of widths) {
  for (const height of heights) {
    for (const steps of stepList) {
      for (const spread of spreads) {
        const layout = gridLayout(width, height, steps, spread, 1, 14);
        const { playCols, cell, cols, rows, padLeft, ox, oy } = layout;
        const guttersOn = cell >= 16;
        const cellDev = cell;
        const gridEndX = cols * cell;
        const gridEndY = rows * cell;
        const lastX = gridEndX - 1;
        const lastY = gridEndY - 1;
        const faceLastX = width - ox - 1;
        const faceLastY = height - oy - 1;
        const span = 3 * spread + 1;
        const above = Math.max(0, Math.floor((rows - span) * 0.5));
        for (let track = 0; track < 4; track += 1) {
          const trackRow = above + track * spread;
          if (trackRow < 0 || trackRow >= rows) continue;
          const lineL = gridLeading(padLeft, cols, cellDev, gridEndX);
          const lineR = gridTrailing(padLeft + playCols, cols, cellDev, gridEndX, guttersOn);
          const lineT = gridLeading(trackRow, rows, cellDev, gridEndY);
          const lineB = gridTrailing(trackRow + 1, rows, cellDev, gridEndY, guttersOn);
          assertRectOnCanvas(lineL, lineR, lineT, lineB, lastX, lastY, `span ${width}x${height} steps=${steps} spread=${spread} track=${track}`);
          assert(lineR <= faceLastX && lineB <= faceLastY, `span stays on the face (not in the margin) at ${width}x${height} steps=${steps}`);
          if (padLeft + playCols >= cols) {
            assert(lineR === lastX, "span at packed right edge clamps inward");
          } else if (guttersOn) {
            assert(lineR === (padLeft + playCols) * cell, "gutter-on right sits on the next cell leading gutter");
          } else {
            assert(lineR === (padLeft + playCols) * cell - 1, "gutter-off right sits on the last pixel of the last span cell");
          }
          if (trackRow + 1 >= rows) {
            assert(lineB === lastY, "span at packed bottom edge clamps inward");
          } else if (guttersOn) {
            assert(lineB === (trackRow + 1) * cell, "gutter-on bottom sits on the next row leading gutter");
          } else {
            assert(lineB === (trackRow + 1) * cell - 1, "gutter-off bottom sits on the last pixel of the track row");
          }
          spanCases += 1;
        }
        for (let step = 0; step < playCols; step += 1) {
          const stepCol = padLeft + step;
          const lineL = gridLeading(stepCol, cols, cellDev, gridEndX);
          const lineR = gridTrailing(stepCol + 1, cols, cellDev, gridEndX, guttersOn);
          const lineT = gridLeading(0, rows, cellDev, gridEndY);
          const lineB = gridTrailing(rows, rows, cellDev, gridEndY, guttersOn);
          assertRectOnCanvas(lineL, lineR, lineT, lineB, lastX, lastY, `playhead ${width}x${height} steps=${steps} step=${step}`);
          assert(lineT === 0 && lineB === lastY, "playhead top/bottom span the packed grid and clamp inward at the edge");
          assert(lineR <= faceLastX && lineB <= faceLastY, "playhead stays on the face");
        }
      }
    }
  }
}
assert(spanCases > 1000, `sweep covered many span frames, got ${spanCases}`);
assert(glsl.includes("sturmianGridTrailing(padLeft + playCols"), "track span uses trailing right edge");
assert(glsl.includes("clamp(line, 0.0, last)"), "edge lines clamp inward onto the last cell pixel");

console.log("ok  sturmian whole-pixel cells and playhead step map");
