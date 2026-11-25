// HP-09g: the Pitch Mutator's output ports map to the native buffers the engine fills (Mono = f Hz, Saw = pitch in note units,
// Phase01 = the knob lane's value 0-1). Loads the shipped worklet host file into a vm with a stub processor class.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ console });
vm.runInContext("class NodeLiveAudioProcessor {}; globalThis.NodeLiveAudioProcessor = NodeLiveAudioProcessor;", ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/node-live-audio-worklet-native-graph.js"), "utf8"), ctx, { filename: "native-graph.js" });
const P = ctx.NodeLiveAudioProcessor;
const src = (port) => P.prototype.mapNativeGraphSrcPortId.call({}, port, "pitchMutator", "pm");
assert.equal(src("f"), P.NATIVE_GRAPH_PORT_MONO, "existing f cables keep working (Mono, Hz)");
assert.equal(src("ƒ"), P.NATIVE_GRAPH_PORT_MONO, "the symbol spelling of f too");
assert.equal(src("pitch"), P.NATIVE_GRAPH_PORT_SAW, "pitch = Saw (note units)");
assert.equal(src("unit"), P.NATIVE_GRAPH_PORT_PHASE01, "0-1 = Phase01");
assert.equal(src("0–1"), P.NATIVE_GRAPH_PORT_PHASE01, "0-1 by its label too");
assert.equal(src("Gate"), P.NATIVE_GRAPH_PORT_LEFT, "Gate unchanged");
assert.equal(src("Velocity"), P.NATIVE_GRAPH_PORT_RIGHT, "Velocity unchanged");
console.log("test_pitch_mutator_outputs: ok");
