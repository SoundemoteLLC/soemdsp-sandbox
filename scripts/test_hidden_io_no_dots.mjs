#!/usr/bin/env node
// Hide In/Out: no wire/IO dots over the module. A dot is rendered only where
// a visible inlet or outlet exists. nodeGraphPortCenter must not synthesize
// an edge fallback; PushWire already skips a cable when either end has no center.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const portSrc = read("public/node-graph-port-geometry.js");
const glSrc = read("public/node-graph-gl-graph.js");
const styles = read("public/styles.css");

const portCenter = portSrc.slice(
  portSrc.indexOf("function nodeGraphPortCenter"),
  portSrc.indexOf("function nodeGraphModulationPortCenter"),
);
assert(
  /nodeGraphNodeSignalIoCollapsed\(nodeId\)/.test(portCenter),
  "PortCenter must bail out when the visual node's signal IO is hidden",
);
assert(
  !/nodeGraphIoHiddenPortFallbackCenter\(/.test(portCenter),
  "PortCenter must not call the hidden-IO edge fallback",
);

const fallback = portSrc.slice(
  portSrc.indexOf("function nodeGraphIoHiddenPortFallbackCenter"),
  portSrc.indexOf("function nodeGraphPortHasLayoutJack"),
);
assert(
  /return null;/.test(fallback),
  "hidden-IO fallback must be a no-op that returns null",
);
assert(
  !/rect\.(left|right)/.test(fallback),
  "hidden-IO fallback must not still compute an edge anchor",
);

assert(
  /if \(!from \|\| !to\) return;/.test(glSrc),
  "PushWire must still skip a cable when either end has no center",
);

assert(
  /Dots exist only with visible inlets\/outlets/.test(styles),
  "io-hidden CSS comment must state dots need visible inlets/outlets",
);
assert(
  !/Connected wires keep endpoint dots only/.test(styles),
  "io-hidden CSS must not still promise endpoint dots without jacks",
);

const hiddenIds = new Set(["hidden"]);
const publishedHits = [];
const ctx = {
  console,
  nodeGraphMvp: null,
  nodeGraphMetamoduleWireVisualEndpoint: () => null,
  nodeGraphNodeIoHidden: (node) => hiddenIds.has(String(node)),
  nodeGraphNodeElement: (node) => ({
    classList: { contains: (name) => name === "io-hidden" && hiddenIds.has(String(node)) },
    getBoundingClientRect: () => ({ left: 10, right: 110, top: 20, width: 100, height: 80 }),
  }),
  nodeGraphModuleGeometryAttach: (nodeId, port, io) => {
    publishedHits.push({ nodeId, port, io });
    return { x: 12, y: 34 };
  },
  nodeGraphPortElementForWireEndpoint: () => null,
  nodeGraphElementCenter: () => null,
  nodeGraphClientToZoomSurfacePoint: (x, y) => ({ x, y }),
  nodeGraphPatchNode: () => ({ type: "gain" }),
  nodeGraphPatchNodeInputPorts: () => ["In"],
  nodeGraphPatchNodeOutputPorts: () => ["Out"],
  nodeGraphCanonicalPortForNode: (_node, port) => String(port || ""),
};

vm.createContext(ctx);
vm.runInContext(portSrc, ctx, { filename: "node-graph-port-geometry.js" });

assert(ctx.nodeGraphNodeSignalIoCollapsed("hidden") === true, "hidden module is signal-IO collapsed");
assert(ctx.nodeGraphNodeSignalIoCollapsed("shown") === false, "shown module is not signal-IO collapsed");
assert(ctx.nodeGraphIoHiddenPortFallbackCenter("hidden", "In", "input") === null, "fallback returns null");

const hiddenIn = ctx.nodeGraphPortCenter("hidden", "In", "input");
const hiddenOut = ctx.nodeGraphPortCenter("hidden", "Out", "output");
assert(hiddenIn === null, "hidden input has no port center (no dot, no cable end)");
assert(hiddenOut === null, "hidden output has no port center (no dot, no cable end)");
assert(
  publishedHits.length === 0,
  "hidden signal IO must not use published geometry for a fake center",
);

const shown = ctx.nodeGraphPortCenter("shown", "Out", "output");
assert(shown && shown.x === 12 && shown.y === 34, "visible IO may use published geometry");
assert(publishedHits.some((hit) => hit.nodeId === "shown"), "visible IO consults published geometry");

const mod = ctx.nodeGraphModulationPortCenter("hidden", "gain");
assert(mod && mod.x === 12 && mod.y === 34, "param/mod jacks are not suppressed by Hide In/Out");

console.log("ok  hidden IO does not render dots over the module");
