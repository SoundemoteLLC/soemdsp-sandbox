// Onset-1 chrome capture on the bass2 fixture copy.
// Onset is a scopeFace / waterfall module: Position lives as the playhead on
// the face, not a plate slider. The params band may be hidden and the
// Clock-style has-module-face class is absent, but the probe must not flag
// it as a chrome gap. Starts its own server.py on a free port; never
// touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const probeSrc = fs.readFileSync(path.join(ROOT, "public/node-graph-view-probe.js"), "utf8");

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

check(probeSrc.includes("nodeGraphModuleHasFace"), "view-probe classifies faces via nodeGraphModuleHasFace");
check(/const hasFace =[\s\S]*nodeGraphModuleHasFace/.test(probeSrc), "hasFace uses nodeGraphModuleHasFace, not only the CSS class");
check(probeSrc.includes("node-module-trace-display-window"), "hasFace also accepts a display / scope face in the DOM");
check(fs.existsSync(patchPath), `bass2 fixture exists at ${path.relative(ROOT, patchPath)}`);

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

const { chromium } = await import("playwright");
let server = null;
let browser = null;
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});

  const loaded = await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_onset_chrome" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(0.35);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((r) => setTimeout(r, 1500));
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)").length;
  }, patch);
  console.log(`loaded ${loaded} modules from ${path.relative(ROOT, patchPath)}`);

  const report = await page.evaluate(() => {
    const dump = typeof __viewDump === "function" ? __viewDump({ frames: 1 }) : null;
    const onset = document.querySelector('#nodeGraphWorkspace .dsp-node[data-node="onset-1"]');
    const type = onset?.dataset?.nodeType || "";
    const cache = typeof nodeGraphGlGraphChromeCache !== "undefined" ? nodeGraphGlGraphChromeCache.get("onset-1") : null;
    return {
      loaded: document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)").length,
      onset: onset ? {
        type,
        laidOut: !onset.classList.contains("viewport-asleep") && !onset.hidden,
        hasFaceClass: onset.classList.contains("has-module-face"),
        hasFaceFn: typeof nodeGraphModuleHasFace === "function" && nodeGraphModuleHasFace(type),
        displayFace: Boolean(onset.querySelector(".node-face, .node-module-face, .node-module-trace-display-window, .node-module-scope-window, .node-module-graph-display")),
        cacheTitles: cache?.lists?.titles?.length || 0,
        cacheLabels: cache?.lists?.labels?.length || 0,
        cacheJacks: cache?.lists?.jacks?.length || 0,
        cacheSliders: cache?.lists?.sliders?.length || 0,
      } : null,
      modules: dump?.modules || null,
    };
  });

  check(loaded >= 20, `loaded ${loaded} modules (want >= 20, bass2 is 22)`);
  check(Boolean(report.onset), "onset-1 is in the workspace");
  const onset = report.onset || {};
  check(onset.type === "onset", `onset-1 type is onset (got ${onset.type || "missing"})`);
  check(onset.laidOut, "onset-1 is laid out (awake, not hidden)");
  check(onset.hasFaceFn === true, "nodeGraphModuleHasFace('onset') is true");
  check(onset.displayFace === true, "onset-1 has a display / scope face in the DOM");
  check(onset.hasFaceClass === false, "onset-1 does not use the Clock-style has-module-face class (regression of the gap)");
  check(onset.cacheLabels >= 1, `onset-1 captured ${onset.cacheLabels} GL labels`);
  check(onset.cacheJacks >= 1, `onset-1 captured ${onset.cacheJacks} GL jacks`);
  const mods = report.modules;
  check(Boolean(mods), "__viewDump returned a modules visibility snapshot");
  const gaps = mods?.chromeGaps || [];
  const onsetGap = gaps.find((g) => g.id === "onset-1");
  check(!onsetGap, `onset-1 is not a chrome gap (${JSON.stringify(onsetGap || null)})`);
  const paramGaps = gaps.filter((g) => g.paramMissing);
  check(paramGaps.length === 0, `no paramMissing chrome gaps (${JSON.stringify(paramGaps)})`);
  check((mods?.blank || 0) === 0, `no in-view blank modules (blank=${mods?.blank || 0}, ids=${JSON.stringify(mods?.blankIds || [])})`);
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

if (bad) {
  console.error(`${bad} check(s) failed`);
  process.exit(1);
}
console.log("test_onset_chrome passed");
