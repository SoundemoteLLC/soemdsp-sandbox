// PASTE-7 release smoke (not a unit test; it reports). Real page on its own server.py port unless SANDBOX_URL is set.
//   node scripts/smoke_release.mjs [modules|patches|phone ...]   (default: all three)
//   modules  spawn every store module: console errors, the module renders, a spawn never hangs (60 s). Audio NaN / silence is
//            swept headless against the wasm by scripts/smoke_native_audio.mjs.
//   patches  load every factory patch (patches/**, not acoustic/): console errors; serialize -> load -> serialize and clone keep it.
//   phone    390 px wide: the rainbow page, UI Settings, the module store and the G window must not clip rows sideways.
// Writes scripts/smoke_release.json and prints a summary. Exit 1 when anything failed.
import fs from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parts = process.argv.slice(2).length ? process.argv.slice(2) : ["modules", "patches", "phone"];
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(path.join(root, "package.json"))("playwright")); }

const report = {};
let server = null;
let browser = null;
const boot = async (viewport) => {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  return { page, errors };
};
let baseUrl = process.env.SANDBOX_URL;
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "server.py"), "--port", String(port)], { cwd: root, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(baseUrl)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });

  if (parts.includes("modules")) {
    const { page, errors } = await boot({ width: 1280, height: 900 });
    // No Live audio here: headless software GL makes every frame cost seconds. Audio (NaN / silence) is swept headless against the
    // real wasm instead: scripts/smoke_native_audio.mjs.
    const types = await page.evaluate(() => Object.keys(nodeGraphModuleDefinitions)
      .filter((t) => typeof nodeGraphModuleIsEfficientProductShopType !== "function" || nodeGraphModuleIsEfficientProductShopType(t))
      .filter((t) => t !== "rgbaHsla")
      .filter((t) => typeof nodeGraphModuleTypeIsUnderConstruction !== "function" || !nodeGraphModuleTypeIsUnderConstruction(t))
      .filter((t) => t !== "output"));
    // SMOKE_MODULES=<regex> limits the sweep to matching module types.
    if (process.env.SMOKE_MODULES) {
      const only = new RegExp(process.env.SMOKE_MODULES);
      types.splice(0, types.length, ...types.filter((t) => only.test(t)));
    }
    const rows = [];
    for (const [index, type] of types.entries()) {
      const before = errors.length;
      // A module that never returns is a finding, not a frozen run: 15 s each.
      const run = page.evaluate(async (type) => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        const out = { type };
        let id = "";
        try {
          id = showNodeGraphModule(type, { x: 300, y: 300 }, { record: false, autosaveWorkingPatch: false });
        } catch (e) { out.spawnError = String(e).slice(0, 200); return out; }
        if (!id) { out.spawnError = "no id"; return out; }
        const def = nodeGraphModuleDefinitions[type] || {};
        await wait(300);
        const el = nodeGraphNodeElement(id);
        const rect = el?.getBoundingClientRect();
        out.rendered = Boolean(rect && rect.width > 4 && rect.height > 4);
        out.finite = true;
        out.source = def.planRole === "source";
        // Remove it again (and its cable).
        const back = cloneNodeGraphPatch(nodeGraphMvp.patch);
        back.nodes = back.nodes.filter((n) => n.id !== id);
        back.connections = (back.connections || []).filter((c) => c.sourceNode !== id && c.destinationNode !== id);
        back.modulations = (back.modulations || []).filter((m) => m.sourceNode !== id && m.destinationNode !== id);
        commitNodeGraphPatch(back, { status: "smoke", record: false });
        await wait(120);
        return out;
      }, type);
      const r = await Promise.race([run, new Promise((res) => setTimeout(() => res({ type, hung: true }), 60000))]);
      r.errors = errors.slice(before);
      rows.push(r);
      console.log(`[${index + 1}/${types.length}] ${type}${r.hung ? " HUNG" : r.spawnError ? " spawn error" : !r.finite ? " NaN" : ""}`);
      if (r.hung) break; // the page is stuck in that module: stop here and report it
    }
    report.modules = {
      count: rows.length,
      hung: rows.filter((r) => r.hung).map((r) => r.type),
      spawnErrors: rows.filter((r) => r.spawnError).map((r) => `${r.type}: ${r.spawnError}`),
      consoleErrors: rows.filter((r) => r.errors.length).map((r) => `${r.type}: ${r.errors[0]}`),
      notRendered: rows.filter((r) => !r.spawnError && !r.rendered).map((r) => r.type),
      nonFinite: rows.filter((r) => !r.spawnError && !r.finite).map((r) => r.type),

    };
    await page.close();
  }

  if (parts.includes("patches")) {
    const files = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== "acoustic") walk(p); } else if (f.name.endsWith(".json")) files.push(p);
      }
    };
    walk(path.join(root, "patches"));
    // SMOKE_PATCHES=<regex> limits the run to matching files (relative path).
    if (process.env.SMOKE_PATCHES) {
      const only = new RegExp(process.env.SMOKE_PATCHES);
      files.splice(0, files.length, ...files.filter((f) => only.test(path.relative(root, f).split(path.sep).join("/"))));
    }
    const { page, errors } = await boot({ width: 1280, height: 900 });
    const rows = [];
    for (const file of files) {
      console.log(`[patch ${rows.length + 1}/${files.length}] ${path.relative(root, file).replace(/\\/g, "/")}`);
      const text = fs.readFileSync(file, "utf8");
      const before = errors.length;
      const r = await page.evaluate(async (text) => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        const out = {};
        let obj;
        try { obj = JSON.parse(text); } catch { out.notJson = true; return out; }
        if (!obj || !Array.isArray(obj.nodes)) { out.notPatch = true; return out; }
        try {
          // What Load Patch does (node-graph-file-actions.js): parse + validate, then commit into the editor.
          commitNodeGraphPatch(loadNodeGraphPatchFromScript(text), { patchDirtyState: "saved", status: "smoke" });
        } catch (e) { out.loadError = String(e).slice(0, 200); return out; }
        await wait(500);
        out.nodes = nodeGraphMvp.patch.nodes.length;
        out.fileNodes = obj.nodes.length;
        const a = serializeNodeGraphPatch(nodeGraphMvp.patch, { pretty: false });
        const b = serializeNodeGraphPatch(loadNodeGraphPatchFromScript(a), { pretty: false });
        const c = serializeNodeGraphPatch(cloneNodeGraphPatch(nodeGraphMvp.patch), { pretty: false });
        out.roundTrip = a === b;
        out.cloneKeeps = a === c;
        if (!out.roundTrip) {
          const x = JSON.parse(a); const y = JSON.parse(b);
          out.diff = Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).slice(0, 5);
        }
        if (!out.cloneKeeps) {
          const x = JSON.parse(a); const y = JSON.parse(c);
          out.cloneDiff = Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).slice(0, 5);
        }
        return out;
      }, text);
      r.file = path.relative(root, file).replace(/\\/g, "/");
      r.errors = errors.slice(before);
      rows.push(r);
    }
    report.patches = {
      count: rows.filter((r) => !r.notJson && !r.notPatch).length,
      skipped: rows.filter((r) => r.notJson || r.notPatch).map((r) => r.file),
      loadErrors: rows.filter((r) => r.loadError).map((r) => `${r.file}: ${r.loadError}`),
      consoleErrors: rows.filter((r) => r.errors.length).map((r) => `${r.file}: ${r.errors[0]}`),
      roundTripFails: rows.filter((r) => r.roundTrip === false).map((r) => `${r.file}: ${r.diff?.join(",")}`),
      cloneFails: rows.filter((r) => r.cloneKeeps === false).map((r) => `${r.file}: ${r.cloneDiff?.join(",")}`),
      nodesDropped: rows.filter((r) => r.nodes !== undefined && r.nodes < r.fileNodes).map((r) => `${r.file}: ${r.fileNodes} -> ${r.nodes}`),
    };
    await page.close();
  }

  if (parts.includes("phone")) {
    const { page, errors } = await boot({ width: 390, height: 844 });
    const clip = await page.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const res = {};
      const check = (panel) => {
        if (!panel || panel.hidden) return { missing: true };
        const pr = panel.getBoundingClientRect();
        const bad = [];
        for (const el of panel.querySelectorAll("button, input, select, label, .node-gradient-card, .node-gradient-param, p, summary")) {
          const r = el.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0)) continue;
          if (r.right > pr.right + 1 || r.left < pr.left - 1 || r.right > innerWidth + 1) bad.push(`${el.tagName.toLowerCase()}.${String(el.className || "").split(" ")[0]} "${String(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`);
        }
        return { width: Math.round(pr.width), panelPastScreen: pr.right > innerWidth + 1 || pr.left < -1, clipped: bad.slice(0, 8), clippedCount: bad.length };
      };
      for (const [key, id] of [["gradients", "nodeGradientsPage"], ["uiSettings", "nodeUserUiSettingsPanel"], ["moduleBrowser", "nodeModuleShopView"]]) {
        openNodeGraphUnifiedWindowPage(key);
        await wait(250);
        res[key] = check(document.getElementById(id));
      }
      closeNodeGraphUnifiedWindowPage?.("moduleBrowser");
      // The Mutator page is a separate full-width overlay, not a unified page.
      const mutatorId = showNodeGraphModule("pitchMutator", { x: 300, y: 300 }, { record: false, autosaveWorkingPatch: false });
      togglePitchMutatorOverlay(true);
      await wait(250);
      res.mutator = check(document.getElementById("pitchMutatorOverlay"));
      togglePitchMutatorOverlay(false);
      if (mutatorId) {
        const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
        patch.nodes = patch.nodes.filter((n) => n.id !== mutatorId);
        patch.connections = (patch.connections || []).filter((c) => c.sourceNode !== mutatorId && c.destinationNode !== mutatorId);
        patch.modulations = (patch.modulations || []).filter((m) => m.sourceNode !== mutatorId && m.destinationNode !== mutatorId);
        commitNodeGraphPatch(patch, { status: "smoke", record: false });
      }
      // G window: the debug guide with the Engine rows open.
      nodeGraphMvp.keyboardDebugInfoVisible = true;
      renderNodeGraphKeyboardDebugToggle();
      const engine = document.getElementById("nodeEngineStatusToggle");
      if (engine) { engine.checked = true; engine.dispatchEvent(new Event("change")); }
      await wait(250);
      const guide = document.querySelector(".node-constraint-color-guide");
      const gr = guide?.getBoundingClientRect();
      res.gWindow = gr ? { width: Math.round(gr.width), pastScreen: gr.right > innerWidth + 1 || gr.left < -1 } : { missing: true };
      return res;
    });
    report.phone = { ...clip, errors: errors.slice(0, 5) };
    await page.close();
  }
} finally {
  await browser?.close();
  server?.kill();
}
fs.writeFileSync(path.join(root, "scripts", "smoke_release.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).slice(0, 6000));
const bad = (report.modules && (report.modules.hung.length + report.modules.spawnErrors.length + report.modules.consoleErrors.length + report.modules.notRendered.length + report.modules.nonFinite.length))
  || (report.patches && (report.patches.loadErrors.length + report.patches.consoleErrors.length + report.patches.roundTripFails.length + report.patches.cloneFails.length))
  || (report.phone && Object.values(report.phone).some((v) => v && (v.clippedCount || v.panelPastScreen || v.pastScreen)));
process.exit(bad ? 1 : 0);
