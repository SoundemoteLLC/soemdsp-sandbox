import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL(
  "../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)));
const x = instance.exports;
function snapshot(overrides = {}) {
  const p = { sampleRate: 48000, frequency: 110, bodySize: 4, body: 0, bodyDecay: 0.08,
    crunch: 0.25, response: 0, bandwidth: -1, formantShift: 0, ...overrides };
  const length = x.soemdsp_convolution_resonator_probe(p.sampleRate, p.frequency, p.bodySize, p.body,
    p.bodyDecay, p.crunch, p.response, p.bandwidth, p.formantShift);
  assert.ok(length > 0, `probe result ${length}`);
  const data = new Float64Array(x.memory.buffer, x.soemdsp_convolution_resonator_probe_buffer(), length).slice();
  assert.equal(data[0], 1);
  assert.ok(data.every(Number.isFinite));
  const n = data[1], points = data[2], offset = 16 + 2 * n;
  assert.ok(n <= 4096 && points <= 576);
  const ir = data.slice(16, offset), frequencies = data.slice(offset, offset + points);
  const bands = Array.from({ length: 4 }, (_, i) => data.slice(offset + (i + 1) * points, offset + (i + 2) * points));
  for (let i = 2; i < ir.length; i += 2) assert.ok(ir[i] >= ir[i - 2]);
  for (let i = 1; i < points; ++i) assert.ok(frequencies[i] > frequencies[i - 1]);
  const peak = Math.max(...Array.from({ length: n }, (_, i) => Math.abs(ir[2 * i + 1])));
  assert.equal(peak, data[4], "extrema reduction must preserve the actual IR peak");
  return { p, data, ir, frequencies, bands };
}
const first = snapshot();
assert.equal(first.data[15], 0, "short Buzz IR retains every sample");
const h = x.soemdsp_convolution_resonator_create(), latency = x.soemdsp_convolution_resonator_latency();
for (let i = 0; i < latency + first.ir.length / 2; ++i) {
  const value = x.soemdsp_convolution_resonator_sample(h, i === 0 ? 1 : 0, 0, 110, 4, 1, 48000, 0, 0, 0.08, 0, 0);
  if (i >= latency) assert.equal(value, first.ir[2 * (i - latency) + 1], "IR is the real native body, not a JS approximation");
}
x.soemdsp_convolution_resonator_destroy(h);
const changedPitch = snapshot({ frequency: 220 });
assert.notDeepEqual(changedPitch.ir, first.ir);
assert.deepEqual(changedPitch.frequencies, first.frequencies, "vocoder frequency axis does not follow carrier pitch");
assert.deepEqual(changedPitch.bands, first.bands);
const shifted = snapshot({ formantShift: 12 });
const peakHz = (s, band) => s.frequencies[s.bands[band].indexOf(Math.max(...s.bands[band]))];
for (const band of [0, 1, 2])
  assert.ok(Math.abs(peakHz(shifted, band) / peakHz(first, band) - 2) < 0.1, "native band kernels track Formant Shift");
assert.deepEqual(shifted.ir, first.ir, "formant shifts do not change the body IR");
for (const body of [0.5, 1]) {
  const result = snapshot({ body });
  assert.notDeepEqual(result.ir, first.ir);
  assert.equal(result.data[15], 1, "long IR is explicitly labeled as an extrema envelope");
}
const cropped = snapshot({ body: 1, bodyDecay: 1 });
assert.equal(cropped.data[5], 1, "display limits must be reported, not silently shorten the tail");
assert.ok(snapshot({ sampleRate: 8000 }).bands[3].every(value => value === 0), "unavailable above-Nyquist probe bands must not alias into the view");
const wide = snapshot({ bandwidth: 1 });
for (const band of wide.bands)
  for (let i = 0; i < band.length; ++i)
    if (wide.frequencies[i] > 100 && wide.frequencies[i] < 10000)
      assert.ok(Math.abs(band[i] - 1) < 1e-6, "full bandwidth displays a broad shared kernel");
assert.equal(x.soemdsp_convolution_resonator_probe(48000, NaN, 4, 0, 0.08, 0.25, 0, 0, 0), -1);

// A snapshot must not mutate another handle, even in the same WASM instance.
const a = x.soemdsp_convolution_resonator_create(), b = x.soemdsp_convolution_resonator_create();
for (let i = 0; i < 8000; ++i) {
  if (i === 3000) snapshot({ body: 0.5 });
  const input = Math.sin(i / 17);
  const step = id => x.soemdsp_convolution_resonator_sample(id, input, 0, 110, 4, 1, 48000, 0, 0.5, 0.08, 1, 0);
  assert.equal(step(a), step(b), "probe evaluation is isolated from running audio handles");
}
x.soemdsp_convolution_resonator_destroy(a); x.soemdsp_convolution_resonator_destroy(b);

const context = { module: { exports: {} }, console, nodeGraphMvp: { sliderDragging: null } };
vm.runInNewContext(fs.readFileSync(new URL("../public/modules/convolutionResonator/convolution-resonator-display.js", import.meta.url), "utf8"), context);
const { nodeGraphConvolutionProbeParameters: parameters, nodeGraphConvolutionClipY: clip } = context.module.exports;
const node = { id: "test", params: { frequency: 110 }, liveParams: { frequency: 880 }, traceDisplaySettings: { zoomSeconds: 9 } };
assert.equal(parameters(node, 48000).frequency, 110, "live pitch does not drive the pinned display");
context.nodeGraphMvp.sliderDragging = { slider: { dataset: { node: "other", param: "frequency", domainValue: "440" } } };
assert.equal(parameters(node, 48000).frequency, 110);
context.nodeGraphMvp.sliderDragging.slider.dataset.node = "test";
assert.equal(parameters(node, 48000).frequency, 440, "active authored knob drag is visible");
assert.ok(clip([0, -2, 1, 2, 2, -2], -1, 1).every(run => run.every((v, i) => i % 2 === 0 || (v >= -1 && v <= 1))),
  "out-of-view peaks use geometry clipping, not fake waveform plateaus");
const source = fs.readFileSync(new URL("../public/modules/convolutionResonator/convolution-resonator-display.js", import.meta.url), "utf8");
assert.ok(!source.includes('getContext("2d")') && !source.includes("nodeGraphFilterCurveLiveParam"));
console.log("Resonator display: native IR identity, extrema peaks, tail limits, native bands, pinned controls, handle isolation and GL-only geometry pass.");
