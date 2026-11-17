#!/usr/bin/env node
// MixStereo output (amplitude) spawn slider max is 0 dB. hardMax keeps the
// previous +12 dB typed ceiling so saved patches and typed values above 0 dB
// still work. Channel / pair volumes stay at +12 dB. Still dB, not linear.
//   node scripts/test_mix_stereo_output_spawn_max.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("ok  ", msg);
  }
};

function typeBlock(type) {
  const re = new RegExp(`\\n  ${type}: \\{[\\s\\S]*?\\n  \\w+: \\{`);
  const m = src.match(re);
  return m ? m[0] : "";
}

function paramBlock(block, key) {
  const re = new RegExp(`\\{[^{}]*key: "${key}"[^{}]*\\}`);
  const m = block.match(re);
  return m ? m[0] : "";
}

function field(block, name) {
  const m = block.match(new RegExp(`${name}: "([^"]*)"`));
  return m ? m[1] : null;
}

for (const type of ["mixStereo4", "mixStereo2", "mixStereo"]) {
  const block = typeBlock(type);
  check(Boolean(block), `${type} definition block found`);
  const amp = paramBlock(block, "amplitude");
  check(Boolean(amp), `${type} amplitude param found`);
  check(field(amp, "max") === "0", `${type} amplitude spawn max is 0 dB (got ${field(amp, "max")})`);
  check(field(amp, "hardMax") === "12", `${type} amplitude hardMax is 12 dB (got ${field(amp, "hardMax")})`);
  check(Number(field(amp, "defaultValue")) <= 0, `${type} amplitude default is <= 0 dB (got ${field(amp, "defaultValue")})`);
  check(field(amp, "unit") === "dB" && amp.includes('kind: "decibels"'), `${type} amplitude stays in dB`);

  const volumes = [...block.matchAll(/\{[^{}]*key: "volume\d+"[^{}]*\}/g)].map((m) => m[0]);
  check(volumes.length >= 2, `${type} has channel volume params (${volumes.length})`);
  for (const vol of volumes) {
    const key = field(vol, "key");
    check(field(vol, "max") === "12", `${type} ${key} spawn max stays 12 dB`);
    check(!vol.includes("hardMax"), `${type} ${key} is unchanged (no hardMax added)`);
  }
}

// Mono Mix2 / Mix4 are linear 0..1 and were not part of this change.
for (const type of ["mix2", "mix4"]) {
  const block = typeBlock(type);
  check(Boolean(block), `${type} definition block found`);
  check(!block.includes('kind: "decibels"') && !block.includes('unit: "dB"'), `${type} was left as linear amplitude, not dB`);
}

// Saved patches keep their own paramMeta.max; a stored +6 dB output and a
// stored slider max of 12 are not rewritten by the definition change.
const patchPath = path.join(root, "patches/journeytothehypersaw.json");
const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
const node = (patch.nodes || []).find((n) => n.type === "mixStereo2");
check(Boolean(node), "journeytothehypersaw has a mixStereo2 node");
if (node) {
  const meta = node.paramMeta?.amplitude;
  check(Number(meta?.max) === 12, `saved mixStereo2 amplitude paramMeta.max stays 12 (got ${meta?.max})`);
  check(Number.isFinite(Number(node.params?.amplitude)), `saved mixStereo2 amplitude value is kept (${node.params?.amplitude})`);
  check(Number(node.paramMeta?.volume1?.max) === 12, "saved channel volume max stays 12");
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("ok  MixStereo output spawn max 0 dB, hardMax +12 dB");