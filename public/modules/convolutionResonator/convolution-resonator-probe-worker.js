"use strict";
let engine;
self.onmessage = async ({ data: job }) => {
  try {
    if (!engine) engine = fetch(new URL("../../../native_modules/convolution_resonator/convolution_resonator.wasm?v=cres10", self.location.href))
      .then(response => { if (!response.ok) throw new Error(`Native probe HTTP ${response.status}`); return response.arrayBuffer(); })
      .then(bytes => WebAssembly.instantiate(bytes, {})).then(result => result.instance.exports);
    const wasm = await engine;
    if (typeof wasm.soemdsp_convolution_resonator_probe !== "function"
      || typeof wasm.soemdsp_convolution_resonator_probe_buffer !== "function") throw new Error("Native probe export missing; rebuild WASM");
    const p = job.params;
    const count = wasm.soemdsp_convolution_resonator_probe(p.sampleRate, p.frequency, p.bodySize,
      p.body, p.bodyDecay, p.crunch, p.response, p.bandwidth, p.formantShift);
    if (count <= 0) {
      const reasons = { "-1": "invalid probe settings", "-2": "probe memory allocation failed", "-3": "probe handle unavailable", "-4": "non-finite probe response" };
      throw new Error(`Native probe: ${reasons[count] || `unexpected result ${count}`}`);
    }
    const packet = new Float64Array(wasm.memory.buffer, wasm.soemdsp_convolution_resonator_probe_buffer(), count).slice();
    if (packet[0] !== 1 || !packet.every(Number.isFinite)) throw new Error("Native probe returned an invalid display packet");
    self.postMessage({ id: job.id, packet }, [packet.buffer]);
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error?.message || error) });
  }
};
