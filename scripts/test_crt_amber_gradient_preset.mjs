// CRT Amber (id crt-amber, label "crt amber") is the shared P3-style phosphor
// ramp used as the Tube Saturation face default. The last stop (t=1) is pure
// white; earlier stops stay as authored. Patches store copied gradientStops.
//   node scripts/test_crt_amber_gradient_preset.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("ok  ", msg);
  }
};

const wantColors = ["#050200", "#1a0a00", "#4a1c00", "#8a3a00", "#d07008", "#ffb020", "#ffe08a", "#ffffff"];
const wantStops = [
  { t: 0, color: "#050200" },
  { t: 0.08, color: "#1a0a00" },
  { t: 0.22, color: "#4a1c00" },
  { t: 0.42, color: "#8a3a00" },
  { t: 0.62, color: "#d07008" },
  { t: 0.78, color: "#ffb020" },
  { t: 0.9, color: "#ffe08a" },
  { t: 1, color: "#ffffff" },
];
const pack = (stops) => JSON.stringify(stops.map((s) => [Number(s.t), String(s.color).toLowerCase()]));

const ctx = { console, Math, Number, Boolean, String, Array, Object, JSON, Infinity, undefined };
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "public/modules/spectrogram/spectrogram-gradient-editor.js"), "utf8"),
  ctx,
);

const presets = vm.runInContext("SHARED_GRADIENT_PRESETS", ctx);
const amber = presets.find((p) => p.id === "crt-amber");
const defaults = vm.runInContext("CRT_AMBER_DEFAULT_GRADIENT_STOPS", ctx);
const faceDefaults = vm.runInContext("NodeGraphGradientSelector.defaultStops('crtAmber')", ctx);

check(Boolean(amber), "SHARED_GRADIENT_PRESETS includes crt-amber");
check(amber?.label === "crt amber", `crt-amber label is "crt amber" (got ${amber?.label})`);
check(
  Array.isArray(amber?.colors) && amber.colors.map((c) => String(c).toLowerCase()).join(",") === wantColors.join(","),
  `crt-amber colors keep the authored ramp and end in #ffffff (${amber?.colors?.join(", ")})`,
);
check(Boolean(amber?.stops), "crt-amber ships explicit stop positions");
check(pack(amber.stops) === pack(wantStops), "crt-amber stops match DEFAULT_CRT_AMBER_STOPS with a white tip");
check(pack(defaults) === pack(wantStops), "CRT_AMBER_DEFAULT_GRADIENT_STOPS has t=1 #ffffff and unchanged earlier stops");
check(
  pack(faceDefaults) === pack(wantStops),
  "defaultStops('crtAmber') returns the same white-tipped ramp",
);
check(
  !amber.stops.some((s) => String(s.color).toLowerCase() === "#fff6d8")
    && !defaults.some((s) => String(s.color).toLowerCase() === "#fff6d8"),
  "the old cream tip #fff6d8 is gone from the crt-amber default",
);

const defs = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");
const tubeStart = defs.indexOf("tubeSaturation: {");
const tubeBlock = defs.slice(tubeStart, tubeStart + 5000);
const gMatch = tubeBlock.match(/gradientStops:\s*\[([\s\S]*?)\]/);
check(Boolean(gMatch), "Tube Saturation defaultDisplaySettings includes gradientStops");
if (gMatch) {
  const colors = [...gMatch[1].matchAll(/color:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const ts = [...gMatch[1].matchAll(/t:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  const last = colors[colors.length - 1];
  check(
    last === "#ffffff" && colors.length === 8 && ts[ts.length - 1] === 1,
    `Tube Saturation spawn default last stop is #ffffff at t=1 (got ${last} t=${ts[ts.length - 1]}, ${colors.length} stops)`,
  );
  check(
    colors.slice(0, -1).join(",") === wantColors.slice(0, -1).join(",")
      && ts.slice(0, -1).join(",") === wantStops.slice(0, -1).map((s) => s.t).join(","),
    "Tube Saturation default earlier stops stay as authored",
  );
}

const editorSrc = fs.readFileSync(path.join(root, "public/modules/spectrogram/spectrogram-gradient-editor.js"), "utf8");
check(
  /if \(Array\.isArray\(preset\.stops\) && preset\.stops\.length >= 2\)/.test(editorSrc)
    && /next = preset\.stops\.map/.test(editorSrc),
  "Picking a preset copies its current authored stops, so crt-amber gets the white tip",
);

const formIo = fs.readFileSync(path.join(root, "public/node-graph-module-scope-settings-form-io.js"), "utf8");
check(
  /next\.gradientStops = editor\.getStops\(\)/.test(formIo)
    && !/gradientPresetId|presetId.*crt-amber/.test(formIo),
  "Saved settings store a copy of gradientStops, not a crt-amber name, so custom stops are not rewritten",
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("ok  crt-amber last stop is pure white, earlier stops unchanged");
