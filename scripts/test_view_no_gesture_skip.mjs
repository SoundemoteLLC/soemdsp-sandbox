/**
 * Source-level check: Stage 3 deleted the HTML-renderer mid-gesture freeze,
 * ReplayMesh-only early return, settle timer, and deferred-until-release work.
 * Rendering must not skip the live camera update because a gesture or pan flag
 * is set. Run: node scripts/test_view_no_gesture_skip.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

const files = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
const checks = [];
let bad = 0;
const fail = (msg) => { bad += 1; console.log(`FAIL ${msg}`); };
const ok = (msg) => { console.log(`ok   ${msg}`); };

function read(name) {
  return fs.readFileSync(path.join(PUBLIC, name), "utf8");
}

const perf = read("node-graph-viewport-perf.js");
const gl = read("node-graph-gl-graph.js");
const styles = read("styles.css");

if (!perf.includes("function viewCameraSet") || !perf.includes("function viewFrame")) {
  fail("viewCameraSet / viewFrame missing from node-graph-viewport-perf.js");
} else {
  ok("viewCameraSet and viewFrame exist");
}

if (/function\s+nodeGraphViewportGestureActive\s*\(/.test(perf)) {
  fail("nodeGraphViewportGestureActive is still defined (render switch must be deleted)");
} else {
  ok("nodeGraphViewportGestureActive was deleted");
}

if (/htmlFrozen\s*=/.test(perf) || /function\s+nodeGraphFreezeHtmlCamera/.test(perf)) {
  fail("HTML camera freeze is still present");
} else {
  ok("HTML camera freeze was deleted");
}

if (/function\s+scheduleNodeGraphViewportSettle/.test(perf) || /settleTimer\s*=\s*window\.setTimeout/.test(perf)) {
  fail("scheduleNodeGraphViewportSettle or its timer is still present");
} else {
  ok("140ms settle timer was deleted");
}

if (/gesturingEarly[\s\S]{0,400}ReplayMesh/.test(gl) || /if\s*\([^)]*GestureActive[^)]*\)\s*\{[\s\S]{0,300}ReplayMesh/.test(gl)) {
  fail("Present still early-returns ReplayMesh while a gesture is active");
} else {
  ok("Present has no gesture-only ReplayMesh early return");
}

if (/if\s*\(\s*!full\s*\)\s*\{[\s\S]{0,200}Pause module lights/.test(perf) || /if\s*\(\s*nodeGraphViewportGestureActive\(\)\s*\)\s*\{\s*return;/.test(perf)) {
  fail("heavy chrome or a wake path still returns early while gesturing");
} else {
  ok("heavy chrome is not skipped mid-gesture");
}

if (/visibility:\s*hidden\s*!important[\s\S]{0,80}viewport-zooming|\.viewport-zooming[^{]*\.node-port[\s\S]{0,120}visibility:\s*hidden/.test(styles)) {
  fail("CSS still hides ports during viewport-zooming");
} else {
  ok("CSS no longer hides ports while zooming");
}

// Any leftover render skip that still *calls* the deleted flags.
const skipRe = /nodeGraphViewportGestureActive\s*\(|nodeGraphFreezeHtmlCamera\s*\(|nodeGraphHtmlFrozen\s*\(|nodeGraphViewportHoldsDisplays\s*\(/;
for (const name of files) {
  if (name === "node-graph-viewport-perf.js") continue;
  const text = read(name);
  if (skipRe.test(text)) {
    fail(`${name} still calls a deleted gesture/freeze flag`);
  }
}
if (bad === 0) ok("no file calls deleted gesture/freeze flags");

// Camera setters must go through viewCameraSet (not a private CSS-only path).
const zoom = read("node-graph-workspace-zoom.js");
const view = read("node-graph-workspace-view.js");
if (!zoom.includes("viewCameraSet")) fail("setNodeGraphZoom path does not call viewCameraSet");
else ok("zoom path calls viewCameraSet");
if (!view.includes("viewCameraSet")) fail("applyNodeGraphPan path does not call viewCameraSet");
else ok("pan path calls viewCameraSet");

if (/wheelActiveUntil|settleMs\s*:|wheelHoldMs\s*:/.test(perf) || /function\s+freezeNodeGraphViewportStrokeCompensate/.test(perf)) {
  fail("wheel/settle leftover or stroke-compensate freeze is still present");
} else {
  ok("wheelActiveUntil / settleTimer / stroke-compensate freeze were deleted");
}
if (/new IntersectionObserver/.test(perf) || /function\s+ensureNodeGraphViewportModuleCull/.test(perf)) {
  fail("IntersectionObserver cull is still present");
} else {
  ok("IntersectionObserver cull was deleted");
}
if (/function\s+scheduleNodeGraphViewportGesturePopIn/.test(perf) || /function\s+nodeGraphViewportGesturePopIn/.test(perf) || /function\s+nodeGraphViewportPopInSettleFull/.test(perf)) {
  fail("Moth pop-in pass is still present");
} else {
  ok("Moth pop-in pass was deleted");
}
if (/gestureHeatmapRaf/.test(perf) || /function\s+scheduleNodeGraphViewportGestureHeatmapPhase/.test(perf)) {
  fail("gestureHeatmapRaf is still present");
} else {
  ok("gestureHeatmapRaf was deleted; heatmap is folded into viewFrame");
}
if (!/function\s+nodeGraphViewportCullRefresh/.test(perf) || !/function\s+nodeGraphViewportCullMustStayAwake/.test(perf) || !/function\s+nodeGraphViewportCullSyncSelection/.test(perf)) {
  fail("live budgeted cull, MustStayAwake, or selection sync is missing");
} else {
  ok("live budgeted cull, MustStayAwake, and selection sync remain");
}
if (!/updateNodeGraphGridHeatmap\(\{\s*lite:\s*true,\s*phaseOnly:\s*true\s*\}/.test(perf)) {
  fail("viewFrame no longer runs the lite/phaseOnly heatmap update");
} else {
  ok("viewFrame runs lite/phaseOnly heatmap");
}



console.log(bad ? `\n${bad} check(s) FAILED` : "\nall source checks passed");
process.exit(bad ? 1 : 0);
