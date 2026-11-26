// HP-18: the compact IO label of one side (View A), under Argi's four rules and D-I2 (definition order decides "first").
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/node-graph-io-compact-label.js"), "utf8"), ctx, { filename: "node-graph-io-compact-label.js" });
const label = (ports) => ctx.nodeGraphIoCompactLabel(ports.map(([l, c]) => (typeof c === "number" ? { label: l, connections: c } : { label: l, connected: !!c })));

for (const side of ["input side", "output side"]) {
  // rule 1: one jack always shows its label, connected or not
  assert.equal(label([["📺", false]]), "📺", `${side}: one jack, no cable`);
  assert.equal(label([["📺", true]]), "📺", `${side}: one jack, cabled`);
  // rule 2: several jacks, nothing connected
  assert.equal(label([["a", false], ["⎍", false], ["c", false]]), "", `${side}: several jacks, none connected is blank`);
  // rule 3: several jacks, one connected: that jack's label (not the first jack's)
  assert.equal(label([["a", false], ["⎍", true], ["c", false]]), "⎍", `${side}: one connected shows it`);
  // rule 4 (HP-22): more than one connection shows only the count
  assert.equal(label([["a", false], ["⎍", true], ["c", true]]), "2", `${side}: two connected jacks is "2"`);
  assert.equal(label([["⎍", true], ["b", true], ["c", true], ["d", false]]), "3", `${side}: three connected is "3"`);
  assert.equal(label([["L", 2]]), "2", `${side}: one jack with two cables is "2"`);
  assert.equal(label([["L", 1]]), "L", `${side}: one jack with one cable keeps its label`);
  assert.equal(label([["L", 0], ["R", 3]]), "3", `${side}: three cables on one of two jacks is "3"`);
}


// the two sides of one module are computed independently
const inputs = [["f", true], ["g", false]];
const outputs = [["out", false]];
assert.equal(label(inputs), "f", "inputs: one of two connected");
assert.equal(label(outputs), "out", "outputs: a single jack still shows its label");

// degenerate input
assert.equal(label([]), "", "no jacks, no label");
assert.equal(ctx.nodeGraphIoCompactLabel(null), "", "null is blank");
assert.equal(label([["  spaced   name ", true], ["b", false]]), "spaced name", "labels are whitespace-normalized");

console.log("test_io_view_compact_label: ok");
