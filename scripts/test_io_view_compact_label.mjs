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
const label = (ports) => ctx.nodeGraphIoCompactLabel(ports.map(([l, c]) => ({ label: l, connected: !!c })));

for (const side of ["input side", "output side"]) {
  // rule 1: one jack always shows its label, connected or not
  assert.equal(label([["📺", false]]), "📺", `${side}: one jack, no cable`);
  assert.equal(label([["📺", true]]), "📺", `${side}: one jack, cabled`);
  // rule 2: several jacks, nothing connected
  assert.equal(label([["a", false], ["⎍", false], ["c", false]]), "", `${side}: several jacks, none connected is blank`);
  // rule 3: several jacks, one connected: that jack's label (not the first jack's)
  assert.equal(label([["a", false], ["⎍", true], ["c", false]]), "⎍", `${side}: one connected shows it`);
  // rule 4: several connected: first connected (definition order), then the count of the OTHERS
  assert.equal(label([["a", false], ["⎍", true], ["c", true]]), "⎍, 1", `${side}: two connected is "label, 1"`);
  assert.equal(label([["⎍", true], ["b", true], ["c", true], ["d", false]]), "⎍, 2", `${side}: three connected is "label, 2"`);
}

// definition order, not the order the caller's DOM or y happens to give: only the array order counts
assert.equal(label([["z-first-in-definition", true], ["a", true]]), "z-first-in-definition, 1", "the first connected in the given (definition) order leads");

// the two sides of one module are computed independently
const inputs = [["f", true], ["g", false]];
const outputs = [["out", false]];
assert.equal(label(inputs), "f", "inputs: one of two connected");
assert.equal(label(outputs), "out", "outputs: a single jack still shows its label");

// degenerate input
assert.equal(label([]), "", "no jacks, no label");
assert.equal(ctx.nodeGraphIoCompactLabel(null), "", "null is blank");
assert.equal(label([["  spaced   name ", true], ["b", true]]), "spaced name, 1", "labels are whitespace-normalized");

console.log("test_io_view_compact_label: ok");
