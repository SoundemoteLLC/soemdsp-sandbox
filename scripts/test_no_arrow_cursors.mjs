// Fail if left-right, up-down, diagonal, or all-direction arrow cursors
// reappear in public/. Shared cursor: --node-adjust-cursor and
// nodeGraphAdjustCursor() (see APP_POLICY section 24, public/cursors/README.md).
//   node scripts/test_no_arrow_cursors.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

// MasterBot-owned / forbidden files this change could not edit. Listed
// explicitly so the lint stays scoped to files we are allowed to fix.
const EXCLUDED = new Set([
  "public/node-graph-gl-graph.js",
  "public/lib/visual/gl-line-renderer.js",
  "public/node-graph-workspace-geometry.js",
  "public/node-graph-viewport-perf.js",
  "public/node-live-audio-worklet-native-graph.js",
  "public/node-graph-ui-settings-persistence.js",
  "public/node-graph-ui-settings-sync.js",
  "public/node-graph-ui-settings-definitions.js",
].map((rel) => rel.replaceAll("\\\\", "/")));

const EXTS = new Set([".css", ".js", ".mjs", ".html", ".htm"]);

const BANNED = [
  "nwse-resize", "nesw-resize",
  "ew-resize", "ns-resize", "col-resize", "row-resize",
  "ne-resize", "nw-resize", "se-resize", "sw-resize",
  "n-resize", "s-resize", "e-resize", "w-resize",
  "all-scroll", "move",
];
const BANNED_RE = new RegExp(
  `(?<![-A-Za-z0-9_])(${BANNED.join("|")})(?![-A-Za-z0-9_])`,
  "g",
);

const CURSOR_RES = [
  /(?:^|[\s;{])cursor\s*:\s*([^;{}]+)/gi,
  /\.style\.cursor\s*=\s*([^;]+)/gi,
  /setProperty\(\s*(['"`])cursor\1\s*,\s*([^)]+)\)/gi,
  /--[-A-Za-z0-9_]*cursor[-A-Za-z0-9_]*\s*:\s*([^;]+)/gi,
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function toPosixRel(full) {
  return path.relative(ROOT, full).split(path.sep).join("/");
}

function isExcluded(rel) {
  if (EXCLUDED.has(rel)) return true;
  const base = path.posix.basename(rel);
  if (base.includes("workspace-geometry")) return true;
  if (base.includes("native-graph") && base.includes("worklet")) return true;
  return false;
}

// Replace comment bodies with spaces, keep newlines so line numbers stay valid.
function stripComments(src, ext) {
  let out = "";
  let i = 0;
  const n = src.length;
  const isJs = ext === ".js" || ext === ".mjs" || ext === ".html" || ext === ".htm";
  const isCss = ext === ".css" || ext === ".html" || ext === ".htm" || isJs;
  const isHtml = ext === ".html" || ext === ".htm";
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (isHtml && src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const stop = end < 0 ? n : end + 3;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (isCss && c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (isJs && c === "/" && c2 === "/") {
      const end = src.indexOf("\n", i + 2);
      const stop = end < 0 ? n : end;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === "\"" || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      out += c;
      while (j < n) {
        const ch = src[j];
        out += ch;
        if (ch === "\\") {
          if (j + 1 < n) {
            out += src[j + 1];
            j += 2;
            continue;
          }
        } else if (ch === q) {
          j += 1;
          break;
        } else if (q !== "`" && ch === "\n") {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function lineAt(src, index) {
  return src.slice(0, index).split("\n").length;
}

function bannedIn(value) {
  BANNED_RE.lastIndex = 0;
  const hits = [];
  let m;
  while ((m = BANNED_RE.exec(value))) hits.push(m[1]);
  return hits;
}

const hits = [];
for (const full of walk(PUBLIC)) {
  const rel = toPosixRel(full);
  if (isExcluded(rel)) continue;
  const ext = path.extname(full).toLowerCase();
  const src = fs.readFileSync(full, "utf8");
  const stripped = stripComments(src, ext);
  for (const re of CURSOR_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped))) {
      const value = m[2] || m[1];
      const found = bannedIn(value);
      if (!found.length) continue;
      hits.push(`${rel}:${lineAt(src, m.index)} cursor value uses ${found.join(", ")}: ${value.trim()}`);
    }
  }
}

const styles = fs.readFileSync(path.join(PUBLIC, "styles.css"), "utf8");
const slider = fs.readFileSync(path.join(PUBLIC, "node-graph-slider-dragging.js"), "utf8");
const checks = [];
const check = (ok, msg) => {
  checks.push({ ok, msg });
};
check(/--node-adjust-cursor\s*:\s*var\(\s*--node-slider-dot-cursor\s*\)/.test(styles), "styles.css defines --node-adjust-cursor from the slider mouse-dot");
check(/\.node-adjust-cursor\s*\{[^}]*cursor\s*:\s*var\(\s*--node-adjust-cursor\s*\)/.test(styles), "styles.css has .node-adjust-cursor shared class");
check(/function\s+nodeGraphAdjustCursor\s*\(\s*\)\s*\{[^}]*--node-adjust-cursor/.test(slider), "nodeGraphAdjustCursor() returns the shared mouse-dot cursor");

let bad = 0;
for (const c of checks) {
  if (!c.ok) bad += 1;
  console.log(`${c.ok ? "ok  " : "FAIL"} ${c.msg}`);
}
if (hits.length) {
  bad += hits.length;
  for (const h of hits) console.log(`FAIL ${h}`);
} else {
  console.log("ok   no banned arrow cursor values in public/ (excluding listed forbidden files)");
}

if (bad) {
  console.error(`FAIL test_no_arrow_cursors: ${bad} issue(s)`);
  process.exit(1);
}
console.log("ok   test_no_arrow_cursors");
