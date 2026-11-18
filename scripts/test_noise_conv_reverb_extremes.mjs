import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import nodeProcess from 'node:process';

const bytes = nodeProcess.argv.includes('--previous-build')
  ? execFileSync('git', ['show', 'HEAD:native_modules/noise_conv_reverb/noise_conv_reverb.wasm'], { maxBuffer: 1024 * 1024 })
  : fs.readFileSync(new URL('../native_modules/noise_conv_reverb/noise_conv_reverb.wasm', import.meta.url));
const compiled = await WebAssembly.compile(bytes);
let x, block, pointers;
const defaults = { amp: 0, spectral: 0, endCutoffHz: 120, startCutoffHz: 1500, decor: 1 };

function process(h, sr, length, p, inputL, inputR = inputL) {
  const out = [new Float64Array(inputL.length), new Float64Array(inputL.length)];
  for (let offset = 0; offset < inputL.length; offset += block) {
    const n = Math.min(block, inputL.length - offset);
    let memory = new Float64Array(x.memory.buffer);
    for (let i = 0; i < n; ++i) {
      memory[pointers[0] + i] = inputL[offset + i];
      memory[pointers[1] + i] = inputR[offset + i];
      memory[pointers[4] + i] = 1;
    }
    x.soemdsp_noise_conv_reverb_process_block(h, ...pointers.slice(0, 4).map(v => v * 8),
      n, pointers[4] * 8, length, p.amp, p.spectral, p.endCutoffHz, p.startCutoffHz, p.decor, sr);
    memory = new Float64Array(x.memory.buffer);
    for (let ch = 0; ch < 2; ++ch) for (let i = 0; i < n; ++i) {
      const value = memory[pointers[ch + 2] + i];
      assert.ok(Number.isFinite(value), 'finite output');
      out[ch][offset + i] = value;
    }
  }
  return out;
}

function kernel(h, sr, length, p) {
  process(h, sr, length, p, new Float64Array(Math.ceil(sr * (0.2 + length * 1.25))));
  const n = x.soemdsp_noise_conv_reverb_ir_length(h);
  assert.equal(n, Math.max(1, Math.round(length * sr)));
  return [0, 1].map(ch => Float64Array.from({ length: n }, (_, i) =>
    x.soemdsp_noise_conv_reverb_ir_sample(h, ch, i)));
}

function roughness(a) {
  let energy = 0, difference = 0;
  for (let i = 1; i < a.length; ++i) {
    energy += a[i] ** 2;
    difference += (a[i] - a[i - 1]) ** 2;
  }
  return difference / energy;
}

for (const sr of [44100, 48000, 96000]) {
  x = (await WebAssembly.instantiate(compiled, {})).exports;
  block = x.soemdsp_noise_conv_reverb_block_max_frames();
  pointers = ['in_l', 'in_r', 'out_l', 'out_r', 'mix'].map(key =>
    x[`soemdsp_noise_conv_reverb_block_${key}`]() / 8);
  const h = x.soemdsp_noise_conv_reverb_create(sr);
  assert.ok(h > 0);
  try {
    for (const length of [1 / sr, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05]) {
      const p = { ...defaults, startCutoffHz: 5, endCutoffHz: 5, amp: 0.9, spectral: 0.9 };
      const ir = kernel(h, sr, length, p);
      let energy = 0;
      for (const channel of ir) for (const value of channel) energy += value * value;
      assert.ok(Math.abs(energy - 1) < 2e-6, `unit IR energy ${sr}/${length}: ${energy}`);
      if (ir[0].length > 1) for (const channel of ir) assert.ok(channel.at(-1) === 0);
      x.soemdsp_noise_conv_reverb_reset(h);
      const input = new Float64Array(ir[0].length + 70);
      for (let i = 0; i < 64; ++i) input[i] = Math.sin(i * 0.73) * 0.1;
      const right = input.map(v => -0.4 * v);
      const output = process(h, sr, length, p, input, right);
      let maxError = 0;
      for (let ch = 0; ch < 2; ++ch) for (let i = 0; i < input.length; ++i) {
        let expected = 0;
        for (let j = 0; j < 64; ++j) if (i - j >= 0 && i - j < ir[ch].length)
          expected += (ch ? right[j] : input[j]) * ir[ch][i - j];
        maxError = Math.max(maxError, Math.abs(expected - output[ch][i]));
      }
      assert.ok(maxError < 2e-6, `direct convolution ${sr}/${length}: ${maxError}`);
    }
    const dark = kernel(h, sr, 0.05, { ...defaults, startCutoffHz: 5, endCutoffHz: 5 });
    const darker = kernel(h, sr, 0.05, { ...defaults, startCutoffHz: 5, endCutoffHz: 120 });
    assert.notDeepEqual(dark, darker, 'independent end cutoff can brighten the tail');
    const bright = kernel(h, sr, 0.05, { ...defaults, startCutoffHz: 16000, endCutoffHz: 16000 });
    assert.ok(roughness(dark[0]) < roughness(bright[0]) * 0.05, 'extended dark range is spectrally darker');
    const fifty = kernel(h, sr, 0.05, { ...defaults, startCutoffHz: 50, endCutoffHz: 50 });
    let cutoffDifference = 0;
    for (let i = 0; i < dark[0].length; ++i) cutoffDifference += (dark[0][i] - fifty[0][i]) ** 2;
    assert.ok(cutoffDifference > 1e-4, '5 Hz is not flattened into the old 50 Hz response');
    const mono = kernel(h, sr, 0.025, { ...defaults, decor: 0 });
    assert.deepEqual(mono[0], mono[1], 'zero decorrelation gives identical kernels');
    for (let i = 0; i < 12; ++i) process(h, sr, i % 2 ? 0.001 : 0.05,
      { ...defaults, startCutoffHz: [5, 1500, 16000][i % 3] }, new Float64Array(256).fill(0.1));
    const zero = kernel(h, sr, 0.025, { ...defaults, startCutoffHz: 0, endCutoffHz: 0 });
    for (const channel of zero) assert.ok(channel.every(value => value === 0), '0 Hz means zero cutoff, not a normalized minimum');
    // A DC input makes the correct output of each warmed kernel exactly its tap sum.
    // Every edit must remain a smooth convex blend, including recycled FFT banks.
    for (const [fromLength, toLength, start, end] of [
      [0.001, 0.05, 1500, 5], [0.05, 0.001, 5, 1500],
      [0.05, 0.5, 1500, 120], [0.5, 0.025, 120, 50],
    ]) {
      const a = { ...defaults, startCutoffHz: start, endCutoffHz: start };
      const b = { ...defaults, startCutoffHz: end, endCutoffHz: end };
      const target = kernel(h, sr, toLength, b).map(c => c.reduce((s, v) => s + v, 0));
      const initial = kernel(h, sr, fromLength, a).map(c => c.reduce((s, v) => s + v, 0));
      process(h, sr, fromLength, a, new Float64Array(sr).fill(1));
      const output = process(h, sr, toLength, b, new Float64Array(sr).fill(1));
      for (let ch = 0; ch < 2; ++ch) {
        const lo = Math.min(initial[ch], target[ch]), hi = Math.max(initial[ch], target[ch]);
        const stepLimit = Math.abs(target[ch] - initial[ch]) * 1.6 / (0.02 * sr) + 2e-4;
        let previous = initial[ch];
        for (const value of output[ch]) {
          assert.ok(value >= lo - 2e-4 && value <= hi + 2e-4, `no stale/unprimed output ${sr} ${fromLength}->${toLength}`);
          assert.ok(Math.abs(value - previous) < stepLimit, `smooth edit ${sr} ${fromLength}->${toLength}`);
          previous = value;
        }
        assert.ok(Math.abs(previous - target[ch]) < 2e-4, 'latest kernel is reached');
      }
    }
    console.log(`${sr} Hz: 1-sample/1..50 ms energy, endpoints, direct convolution, dark range, stereo and rapid edits pass.`);
  } finally { x.soemdsp_noise_conv_reverb_destroy(h); }
}
