#!/usr/bin/env node
// Debug toggle moved from D (camera pan) / documented Shift+D to plain G.
// Source checks + a vm of handleNodeGraphKeydown, then a headless page on a
// free port. Never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shortcutSrc = fs.readFileSync(path.join(ROOT, "public/node-graph-keyboard-shortcuts.js"), "utf8");
const cameraSrc = fs.readFileSync(path.join(ROOT, "public/node-graph-camera-keys.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const performHtml = fs.readFileSync(path.join(ROOT, "public/perform.html"), "utf8");

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const gBind = /!event\.shiftKey && event\.key\.toLowerCase\(\) === "g"[\s\S]{0,280}toggleNodeGraphKeyboardDebugVisibility\(\)/;
check(gBind.test(shortcutSrc), "G (no modifiers) calls toggleNodeGraphKeyboardDebugVisibility");
check(
  /event\.shiftKey && event\.key\.toLowerCase\(\) === "d"[\s\S]{0,280}toggleNodeGraphConstraintGuideVisibility\(\)/.test(shortcutSrc),
  "Shift+D still toggles the constraint guide",
);
const debugCallIdx = shortcutSrc.indexOf("toggleNodeGraphKeyboardDebugVisibility()");
const debugSlice = shortcutSrc.slice(Math.max(0, debugCallIdx - 400), debugCallIdx + 80);
check(
  debugCallIdx >= 0 && !/toLowerCase\(\) === "d"/.test(debugSlice),
  "Debug toggle is not bound to D",
);
check(/PAN_KEYS = \{[^}]*\bd:\s*\[/.test(cameraSrc), "WASD camera still owns D");
check(
  !/!event\.shiftKey && event\.key\.toLowerCase\(\) === "d"[\s\S]{0,280}toggleNodeGraphKeyboardDebugVisibility/.test(shortcutSrc),
  "No bare-D Debug binding remains in shortcuts",
);

for (const [name, html] of [["index.html", indexHtml], ["perform.html", performHtml]]) {
  check(
    /<div class="node-hotkeys-row"><kbd>G<\/kbd><span>Debug<\/span><\/div>/.test(html),
    `${name} hotkeys page lists G for Debug`,
  );
  check(!/<kbd>Shift\+D<\/kbd><span>Debug<\/span>/.test(html), `${name} no longer lists Shift+D as Debug`);
  check(
    /id="nodeKeyboardDebugToggleButton"[\s\S]{0,200}<kbd>G<\/kbd>/.test(html),
    `${name} Visibility (eye) Debug button shows kbd G`,
  );
  check(
    html.includes("node-graph-keyboard-shortcuts.js?v=pt-preset-2-sg-fix-1-cam1-hk7-debug-g-1"),
    `${name} cache-bust includes debug-g-1`,
  );
  check(/W \/ A \/ S \/ D/.test(html), `${name} still documents WASD camera`);
}

function makeEvent(key, { shiftKey = false, ctrlKey = false, metaKey = false, altKey = false } = {}) {
  let prevented = false;
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    target: { closest() { return null; } },
    preventDefault() { prevented = true; },
    stopPropagation() {},
    get defaultPrevented() { return prevented; },
  };
}

const debugCalls = [];
const guideCalls = [];
const ctx = {
  window: {},
  Element: class Element {},
  HTMLElement: class HTMLElement {},
  Node: class Node {},
  document: { getElementById() { return null; } },
  nodeGraphAppHotkeysLocked() { return false; },
  handleNodeGraphFloatingWindowKeyboardNudge() { return false; },
  nodeGraphWireInteractions: null,
  nodeGraphMvp: {},
  toggleNodeGraphKeyboardDebugVisibility() { debugCalls.push("debug"); },
  toggleNodeGraphConstraintGuideVisibility() { guideCalls.push("guide"); },
  alignNodeGraphViewToGrid() {},
  setNodeInteractionHelp() {},
  Math,
};
vm.createContext(ctx);
vm.runInContext(shortcutSrc, ctx);

debugCalls.length = 0;
guideCalls.length = 0;
ctx.handleNodeGraphKeydown(makeEvent("g"));
check(debugCalls.length === 1 && guideCalls.length === 0, "vm: G toggles Debug once");
ctx.handleNodeGraphKeydown(makeEvent("g"));
check(debugCalls.length === 2 && guideCalls.length === 0, "vm: second G toggles Debug again");
ctx.handleNodeGraphKeydown(makeEvent("d"));
ctx.handleNodeGraphKeydown(makeEvent("D"));
check(debugCalls.length === 2 && guideCalls.length === 0, "vm: D does not toggle Debug or the guide");
ctx.handleNodeGraphKeydown(makeEvent("d", { shiftKey: true }));
check(debugCalls.length === 2 && guideCalls.length === 1, "vm: Shift+D toggles the constraint guide, not Debug");
ctx.handleNodeGraphKeydown(makeEvent("g", { ctrlKey: true, shiftKey: true }));
check(debugCalls.length === 2, "vm: Ctrl+Shift+G does not toggle Debug (grid align keeps that combo)");
ctx.handleNodeGraphKeydown(makeEvent("g", { shiftKey: true }));
check(debugCalls.length === 2, "vm: Shift+G does not toggle Debug");

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
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof handleNodeGraphKeydown === "function" && typeof toggleNodeGraphKeyboardDebugVisibility === "function" && typeof nodeGraphMvp === "object" && nodeGraphMvp, null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});

  const snap = () => ({
    debug: nodeGraphMvp.keyboardDebugInfoVisible === true,
    hiddenClass: document.body.classList.contains("keyboard-debug-hidden"),
    guide: nodeGraphMvp.constraintGuideVisible === true,
    kbd: document.querySelector("#nodeKeyboardDebugToggleButton kbd")?.textContent || "",
    hotkey: [...document.querySelectorAll(".node-hotkeys-row")].find((row) => row.querySelector("span")?.textContent === "Debug")?.querySelector("kbd")?.textContent || "",
  });

  const before = await page.evaluate(snap);
  check(before.debug === false && before.hiddenClass === true, `page: Debug starts off (debug=${before.debug}, hiddenClass=${before.hiddenClass})`);
  check(before.kbd === "G" && before.hotkey === "G", `page: Visibility + Hotkeys show G (kbd=${before.kbd}, hotkey=${before.hotkey})`);

  const afterD = await page.evaluate(() => {
    const snap = () => ({
      debug: nodeGraphMvp.keyboardDebugInfoVisible === true,
      hiddenClass: document.body.classList.contains("keyboard-debug-hidden"),
      guide: nodeGraphMvp.constraintGuideVisible === true,
    });
    const fire = (key, shiftKey = false) => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, shiftKey }));
    };
    fire("d");
    fire("D");
    return snap();
  });
  check(afterD.debug === false && afterD.hiddenClass === true, "page: D does not toggle Debug");
  check(afterD.guide === false, "page: D does not toggle the constraint guide");

  const afterG = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g", code: "KeyG", bubbles: true, cancelable: true }));
    return {
      debug: nodeGraphMvp.keyboardDebugInfoVisible === true,
      hiddenClass: document.body.classList.contains("keyboard-debug-hidden"),
    };
  });
  check(afterG.debug === true && afterG.hiddenClass === false, `page: G turns Debug on (debug=${afterG.debug}, hiddenClass=${afterG.hiddenClass})`);

  const afterG2 = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g", code: "KeyG", bubbles: true, cancelable: true }));
    return {
      debug: nodeGraphMvp.keyboardDebugInfoVisible === true,
      hiddenClass: document.body.classList.contains("keyboard-debug-hidden"),
    };
  });
  check(afterG2.debug === false && afterG2.hiddenClass === true, "page: second G turns Debug back off");

  const afterShiftD = await page.evaluate(() => {
    const beforeDebug = nodeGraphMvp.keyboardDebugInfoVisible === true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", code: "KeyD", bubbles: true, cancelable: true, shiftKey: true }));
    return {
      debug: nodeGraphMvp.keyboardDebugInfoVisible === true,
      beforeDebug,
      guide: nodeGraphMvp.constraintGuideVisible === true,
    };
  });
  check(afterShiftD.debug === afterShiftD.beforeDebug && afterShiftD.guide === true, "page: Shift+D toggles constraint guide, not Debug");

  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "page has no errors");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
  }
}

if (bad) {
  console.error(`FAILED ${bad} check(s)`);
  process.exit(1);
}
console.log("all checks passed");
