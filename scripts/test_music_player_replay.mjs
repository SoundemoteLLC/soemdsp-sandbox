#!/usr/bin/env node
// Music Player: Play after the track ends restarts it from the beginning.
// The engine parks at the range end and stays completed on a play mode, so Play must
// Stop (re-arm) and write the play mode back when the engine reports Stop (event-driven,
// no timers). Toggle on an ended track must Play, not Pause.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/modules/audioPlayer/audio-player-playlist.js"), "utf8");
function assert(c, m) { if (!c) throw new Error(m); }

const from = src.indexOf("const nodeGraphAudioPlayerTrackEnded");
const to = src.indexOf("function nodeGraphAudioPlayerPlaylistPickNeighbor");
assert(from > 0 && to > from, "ended-state block not found");
const block = src.slice(from, to);
assert(!/setInterval|setTimeout|requestAnimationFrame/.test(block), "ended-state block must be event-driven (no timers)");

const log = [];
const node = { id: "n1", type: "audioPlayer", params: { transport: "4", speed: "1", direction: "0", start: "0", end: "1" }, sample: { id: "s1" } };
const ctx = {
  console,
  nodeGraphFiniteNumber: (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f),
  nodeGraphMvp: { live: { context: { state: "running" } }, sampleBuffers: new Map([["s1", {}]]), sampleRuntimeStatus: new Map() },
  nodeGraphPatchNode: () => node,
  nodeGraphAudioPlayerTransportBase: () => Number(node.params.transport),
  nodeGraphAudioPlayerWriteTransport: (id, m) => { node.params.transport = String(m); log.push(`write ${m}`); },
  nodeGraphAudioPlayerPlaylistStop: () => { node.params.transport = "1"; log.push("stop"); },
  nodeGraphAudioPlayerRestartPhaseSet: (id, p) => log.push(`restart ${p}`),
  nodeGraphAudioPlayerEnsureLiveOutput: () => {},
  nodeGraphAudioPlayerPlaylistForNode: () => ({ items: [{ name: "a" }], index: 0, selectedIndex: 0, loopMode: "off" }),
  nodeGraphAudioPlayerPlaylistPlayModeForLoop: () => 4,
  nodeGraphAudioPlayerPlaylistPlayIndex: () => { log.push("playIndex"); },
  nodeGraphAudioPlayerPlaylistLoadBusy: new Map(),
  nodeGraphAudioPlayerPlaylistDebug: () => {},
};
vm.createContext(ctx);
vm.runInContext(block + "\nglobalThis.api = { Note: nodeGraphAudioPlayerPlaylistNoteEngineStatus, Ended: nodeGraphAudioPlayerPlaylistTrackEnded, Play: nodeGraphAudioPlayerPlaylistPlay, Toggle: nodeGraphAudioPlayerPlaylistTogglePlayPause };", ctx);
const { Note, Ended, Play, Toggle } = ctx.api;
const status = (reason, phase) => {
  ctx.nodeGraphMvp.sampleRuntimeStatus.set("n1", { reason, phase });
  Note("n1", node, reason);
};

// Playing: not ended, Toggle pauses.
status("engine playing", 0.4);
assert(!Ended("n1"), "mid-track must not be ended");

// Track runs to the end (engine parks at 1 on a play mode).
status("engine playing", 1);
assert(Ended("n1"), "phase at range end on a play mode means ended");
status("engine complete", 1);
assert(Ended("n1"), "engine complete means ended");

// Toggle on an ended track plays (restarts) instead of pausing.
log.length = 0;
Toggle("n1");
assert(!log.includes("write 2"), "Toggle on an ended track must not Pause");
assert(log.join("|") === "restart 0|stop", "Play on ended track stops from the start first, got " + log.join("|"));
assert(!log.includes("playIndex"), "restart in place must not reload the track");

// Engine reports Stop: the play mode is written back once, ended resets.
log.length = 0;
status("engine stopped", 0);
assert(log.join("|") === "write 4", "play mode must be written on engine stopped, got " + log.join("|"));
assert(!Ended("n1"), "ended must reset after restart");
status("engine playing", 0.01);
assert(!Ended("n1"), "playing again is not ended");
log.length = 0;
Toggle("n1");
assert(log.length === 0 || log.join("|") === "write 2", "Toggle while playing pauses");
assert(node.params.transport === "2", "Toggle while playing pauses, transport=" + node.params.transport);

// A queued restart is dropped if the user picks another transport meanwhile.
node.params.transport = "4";
status("engine complete", 1);
Play("n1");
node.params.transport = "2";
log.length = 0;
status("engine stopped", 0);
assert(log.length === 0, "queued restart must be dropped after the user changed transport");

// Custom range: ends at the range end, restarts at the range start.
node.params.transport = "4"; node.params.start = "0.25"; node.params.end = "0.75";
status("engine playing", 0.75);
assert(Ended("n1"), "range end counts as ended");
log.length = 0;
Play("n1");
assert(log[0] === "restart 0.25", "restart at range start, got " + log[0]);

console.log("test_music_player_replay: ok");