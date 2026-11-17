// Bit-identity: new velvet_reverb.wasm IRs must match SHA-256 of engine v11.
// Compare new wasm IRs (via sample()) against recorded v11 SHA-256.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gold = JSON.parse(fs.readFileSync(path.join(root, "scripts", "test_velvet_reverb_v11_sha.json"), "utf8"));
const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules", "velvet_reverb", "velvet_reverb.wasm")));
const x = (await WebAssembly.instantiate(mod, {})).exports;
const FS = 48000;
const sha = (a) => crypto.createHash("sha256").update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

function run({ taps = 64, dark = 1, spread = 1, mix = 1, decay = 0.025, tail = 0, seed = 1, amp = -60, skew = 0, gap = 1, tailRand = 1, tailCurve = 0, n, input, midChange } = {}) {
  const h = x.soemdsp_velvet_reverb_create(FS);
  if (!h) throw new Error("create failed");
  x.soemdsp_velvet_reverb_set_seed(h, seed);
  const len = n ?? Math.ceil(decay * FS) + 2048;
  const L = new Float64Array(len);
  const R = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    let t = taps, d = dark, dec = decay, tl = tail, m = mix;
    if (midChange && i >= midChange.at) {
      if (midChange.dark != null) d = midChange.dark;
      if (midChange.decay != null) dec = midChange.decay;
      if (midChange.taps != null) t = midChange.taps;
      if (midChange.mix != null) m = midChange.mix;
      if (midChange.tail != null) tl = midChange.tail;
    }
    const v = input ? input(i) : (i === 0 ? 1 : 0);
    L[i] = x.soemdsp_velvet_reverb_sample(h, v, v, t, d, spread, m, FS, dec, tl, amp, skew, gap, tailRand, tailCurve);
    R[i] = x.soemdsp_velvet_reverb_right(h);
  }
  x.soemdsp_velvet_reverb_destroy(h);
  return { L, R };
}

const cases = [
  { name: "default-ir", opts: { taps: 64, dark: 1, decay: 0.025, gap: 1, n: 4096 } },
  { name: "1024-6s-d1-impulse", opts: { taps: 1024, dark: 1, decay: 6, gap: 1, n: 8000 } },
  { name: "300-1s-d64", opts: { taps: 300, dark: 64, decay: 1, gap: 1, n: 48000 + 256 } },
  { name: "64-6s-tail1024", opts: { taps: 64, dark: 1, decay: 6, tail: 1024, gap: 1, n: 4096 } },
  { name: "4096-025-thinned", opts: { taps: 4096, dark: 1024, decay: 0.025, gap: 1, n: 2048 } },
  { name: "noise-1024-1s", opts: { taps: 1024, dark: 1, decay: 1, gap: 1, n: 4096, input: (i) => ((i * 17) % 11) / 11 - 0.5 } },
  { name: "silence-then-noise", opts: { taps: 64, dark: 8, decay: 0.2, gap: 1, n: 8192, input: (i) => (i < 1000 ? 0 : ((i * 13) % 7) / 7 - 0.4) } },
  { name: "midblock-dark", opts: { taps: 128, dark: 1, decay: 0.5, gap: 1, n: 2048, input: (i) => (i % 3 === 0 ? 0.2 : -0.1), midChange: { at: 200, dark: 16 } } },
  { name: "midblock-mix", opts: { taps: 64, dark: 2, decay: 0.25, gap: 1, n: 1024, input: (i) => (i === 0 ? 1 : 0), midChange: { at: 67, mix: 0.3 } } },
  { name: "midblock-length", opts: { taps: 256, dark: 1, decay: 0.4, gap: 1, n: 3072, input: (i) => Math.sin(i * 0.02), midChange: { at: 513, decay: 0.8 } } },
  { name: "fade-then-stable", opts: { taps: 64, dark: 1, decay: 1, gap: 1, n: 4800, input: (i) => (i < 200 ? 0.5 : 0.1), midChange: { at: 128, dark: 32 } } },
  { name: "amp0-gated", opts: { taps: 64, dark: 1, decay: 0.1, amp: 0, gap: 1, n: 8192 } },
  { name: "skew-gap0", opts: { taps: 100, dark: 4, decay: 0.5, skew: 0.7, gap: 0, n: 4096, input: (i) => (i < 10 ? 1 : 0) } },
];

let failed = 0;
console.log("new version", x.soemdsp_velvet_reverb_version(), "vs v11 gold");
for (const c of cases) {
  const { L, R } = run(c.opts);
  const g = gold.cases[c.name];
  const sl = sha(L), sr = sha(R);
  const ok = sl === g.shaL && sr === g.shaR;
  if (!ok) failed += 1;
  console.log(ok ? "ok  " : "FAIL", c.name, ok ? sl.slice(0, 16) : `L ${sl} vs ${g.shaL}  first=${L[0]} goldFirst=${g.first}`);
}
if (failed) {
  console.error(failed, "SHA mismatch(es)");
  process.exit(1);
}
console.log("all v11 SHA checks passed");
