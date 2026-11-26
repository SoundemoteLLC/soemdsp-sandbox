// Spectral processor faces: worklet-side data for the shared spectral style
// renderer (public/lib/spectral-display-styles.js). Display only, no DSP.
//
// Two sources, both read-only:
//   • Native taps: Vocoder band envelopes, STFT Gate / Contrast per-bin power
//     and gain (the arrays the audio itself uses; *_display_* exports).
//   • Shared analysis core (public/lib/spectral-analysis.js) on the module's
//     own output (scope ring `${id}:Mono`) and input (buffered visual input).
//     Used where the engine rewrites its spectra in place (Blur, Freeze,
//     Delay, Warp, Cross Synthesis). Display rate, fixed size: cost does not
//     depend on the module's FFT Size or on the input.
//
// Posts (all dB; Hz arrays give each point's centre frequency):
//   SpectralHz, SpectralA, SpectralB?, SpectralC?, SpectralGain?   Float32Array
//   SpectralHz2, SpectralA2   Vocoder incoming bank while Bands crossfades
//   SpectralMeta   [serial, weight (incoming bank), units]   units 0 dBFS, 1 bin-power dBFS
// serial changes only when new data exists, so faces move only on audio.

const SPECTRAL_DISPLAY_SOURCES = Object.freeze({
  spectralPrism: Object.freeze({ tap: "prism" }),
  vocoder: Object.freeze({ tap: "vocoder" }),
  stftGate: Object.freeze({ tap: "stft", prefix: "soemdsp_stft_gate" }),
  stftContrast: Object.freeze({ tap: "stft", prefix: "soemdsp_stft_contrast" }),
  spectralBlur: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "In"]]) }),
  spectralWarble: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "In"]]) }),
  spectralSmear: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "In"]]) }),
  spectralFreeze: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "In"]]) }),
  spectralDelay: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "In"]]) }),
  spectralWarp: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "In"]]) }),
  spectralCrossSynthesis: Object.freeze({ lanes: Object.freeze([["A", "out"], ["B", "Voice L"], ["C", "Synth L"]]) }),
});
const SPECTRAL_DISPLAY_FFT_SIZE = 2048;
const SPECTRAL_DISPLAY_ANALYSES_PER_SECOND = 30;

NodeLiveAudioProcessor.prototype.syncSpectralDisplayStates = function syncSpectralDisplayStates(liveIds, reset) {
  if (!(this.spectralDisplayStates instanceof Map)) this.spectralDisplayStates = new Map();
  if (reset) this.spectralDisplayStates.clear();
  const ids = liveIds instanceof Set ? liveIds : null;
  for (const [id, node] of this.nodes || []) {
    if (!SPECTRAL_DISPLAY_SOURCES[String(node?.type || "")]) continue;
    if (ids && !ids.has(id)) continue;
    if (!this.spectralDisplayStates.has(id)) this.spectralDisplayStates.set(id, { serial: 0, lanes: new Map(), since: 0 });
  }
  for (const id of [...this.spectralDisplayStates.keys()]) {
    const node = this.nodes?.get?.(id);
    if (!node || !SPECTRAL_DISPLAY_SOURCES[String(node.type || "")] || (ids && !ids.has(id))) {
      this.spectralDisplayStates.delete(id);
    }
  }
};

NodeLiveAudioProcessor.prototype.spectralDisplayNativeHandle = function spectralDisplayNativeHandle(nodeId) {
  const fn = this.nativeGraph?.soemdsp_graph_node_native_handle;
  if (!fn || !this.nativeGraphHandle) return 0;
  try {
    return fn(this.nativeGraphHandle, this.fnv1aHash32(nodeId)) | 0;
  } catch (_e) {
    return 0;
  }
};

/** Vocoder: one point per real band, from the envelopes that drive the synth. */
NodeLiveAudioProcessor.prototype.spectralDisplayVocoder = function spectralDisplayVocoder(nodeId, state, dataPorts) {
  const native = this.nativeGraph;
  if (!native?.soemdsp_vocoder_display_count) return;
  const h = this.spectralDisplayNativeHandle(nodeId);
  if (!(h > 0)) return;
  const bank = (layout) => {
    const n = native.soemdsp_vocoder_display_count(h, layout) | 0;
    if (!(n > 0)) return null;
    const hz = new Float32Array(n);
    const db = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      hz[i] = native.soemdsp_vocoder_display_hz(h, layout, i);
      db[i] = 20 * Math.log10(Math.max(1e-12, native.soemdsp_vocoder_display_level(h, layout, i)));
    }
    return { hz, db };
  };
  const current = bank(0);
  if (!current) return;
  const incoming = bank(1);
  // Envelopes move every sample; serial follows snapshot posts while audio runs.
  state.serial += 1;
  dataPorts.push([nodeId, "SpectralHz", current.hz]);
  dataPorts.push([nodeId, "SpectralA", current.db]);
  if (incoming) {
    dataPorts.push([nodeId, "SpectralHz2", incoming.hz]);
    dataPorts.push([nodeId, "SpectralA2", incoming.db]);
  }
  dataPorts.push([nodeId, "SpectralMeta", new Float32Array([state.serial, incoming ? native.soemdsp_vocoder_display_weight(h) : 0, 0])]);
};

/** STFT Gate / Contrast: input bin power and the gain the audio applies. */
NodeLiveAudioProcessor.prototype.spectralDisplayStft = function spectralDisplayStft(nodeId, state, dataPorts, prefix) {
  const native = this.nativeGraph;
  const fn = (name) => native?.[`${prefix}_${name}`];
  if (!fn("display_power") || !native?.memory?.buffer) return;
  const h = this.spectralDisplayNativeHandle(nodeId);
  if (!(h > 0)) return;
  const frames = fn("display_frames")(h);
  const rate = fn("display_rate")(h);
  if (!(frames > 0) || !(rate > 0) || frames === state.frames) return;
  state.frames = frames;
  const bins = fn("display_bins")() | 0;
  const size = fn("display_size")();
  const powerPtr = fn("display_power")(h) >>> 0;
  const gainPtr = fn("display_gain")(h) >>> 0;
  if (!powerPtr || !gainPtr || powerPtr % 8 || gainPtr % 8) return;
  // memory.grow can detach: always view the current buffer.
  const power = new Float64Array(native.memory.buffer, powerPtr, bins);
  const gain = new Float64Array(native.memory.buffer, gainPtr, bins);
  const hz = new Float32Array(bins);
  const inDb = new Float32Array(bins);
  const outDb = new Float32Array(bins);
  const gainDb = new Float32Array(bins);
  for (let k = 0; k < bins; k += 1) {
    hz[k] = (k * rate) / size;
    const p = power[k];
    const d = 10 * Math.log10(p > 1e-30 ? p : 1e-30);
    const g = Number.isFinite(gain[k]) ? gain[k] : 0;
    inDb[k] = d;
    gainDb[k] = g;
    outDb[k] = d + g;
  }
  state.serial += 1;
  dataPorts.push([nodeId, "SpectralHz", hz]);
  dataPorts.push([nodeId, "SpectralA", outDb]);
  dataPorts.push([nodeId, "SpectralB", inDb]);
  dataPorts.push([nodeId, "SpectralGain", gainDb]);
  dataPorts.push([nodeId, "SpectralMeta", new Float32Array([state.serial, 0, 1])]);
};

/** Fresh samples of one lane source into its history ring; returns lane state. */
NodeLiveAudioProcessor.prototype.spectralDisplayFeedLane = function spectralDisplayFeedLane(nodeId, state, laneKey, source) {
  let lane = state.lanes.get(laneKey);
  if (!lane) {
    lane = { history: new Float32Array(SPECTRAL_DISPLAY_FFT_SIZE), write: 0, filled: 0, cursor: -1 };
    state.lanes.set(laneKey, lane);
  }
  const push = (v) => {
    lane.history[lane.write] = Number.isFinite(v) ? v : 0;
    lane.write = (lane.write + 1) % SPECTRAL_DISPLAY_FFT_SIZE;
    if (lane.filled < SPECTRAL_DISPLAY_FFT_SIZE) lane.filled += 1;
  };
  if (source === "out") {
    // Module output scope ring (full rate while the face is a spectral style).
    const ring = this.scopeBuffers?.get(`${nodeId}:Mono`) || this.scopeBuffers?.get(nodeId);
    if (!(ring instanceof Float32Array)) return lane;
    const limit = ring.nodeGraphScopeLimit || ring.length;
    const w = Math.max(0, nodeGraphFiniteNumber(ring.nodeGraphScopeWriteIndex)) % limit;
    if (lane.cursor < 0) lane.cursor = (w - Math.min(nodeGraphFiniteNumber(ring.nodeGraphScopeLength), SPECTRAL_DISPLAY_FFT_SIZE) + limit) % limit;
    let fresh = (w - lane.cursor + limit) % limit;
    for (let i = 0; i < fresh; i += 1) push(ring[(lane.cursor + i) % limit]);
    lane.cursor = w;
    return lane;
  }
  const buf = this.visualInputBuffers?.get(`${nodeId}:${source}`);
  if (!buf?.buffer?.length) return lane;
  const capacity = buf.capacity || buf.buffer.length;
  const abs = Math.max(0, Math.floor(nodeGraphFiniteNumber(buf.absoluteFrame)));
  const fresh = lane.cursor >= 0 ? Math.min(capacity, Math.max(0, abs - lane.cursor)) : Math.min(capacity, SPECTRAL_DISPLAY_FFT_SIZE, nodeGraphFiniteNumber(buf.length));
  const start = (nodeGraphFiniteNumber(buf.writeIndex) - fresh + capacity) % capacity;
  for (let i = 0; i < fresh; i += 1) push(buf.buffer[(start + i) % capacity] || 0);
  lane.cursor = abs;
  return lane;
};

/** Blur / Freeze / Delay / Warp / Cross: shared-core spectra of out and inputs. */
NodeLiveAudioProcessor.prototype.spectralDisplayAnalyse = function spectralDisplayAnalyse(nodeId, state, dataPorts, lanes) {
  const rate = Math.max(1, nodeGraphFiniteNumber(this.engineSampleRate, nodeGraphFiniteNumber(sampleRate, 44100)));
  const n = SPECTRAL_DISPLAY_FFT_SIZE;
  let total = 0;
  for (const [key, source] of lanes) {
    const before = state.lanes.get(key)?.write ?? 0;
    const lane = this.spectralDisplayFeedLane(nodeId, state, key, source);
    total = Math.max(total, (lane.write - before + n) % n);
  }
  state.since += total;
  if (state.since < rate / SPECTRAL_DISPLAY_ANALYSES_PER_SECOND) return;
  state.since = 0;
  const win = nodeGraphSpectralWindow(n, 1);
  if (!state.re) {
    state.re = new Float32Array(n);
    state.im = new Float32Array(n);
  }
  const half = n >> 1;
  let any = false;
  for (const [key] of lanes) {
    const lane = state.lanes.get(key);
    if (!lane || lane.filled < n) continue;
    const re = state.re;
    const im = state.im;
    im.fill(0);
    let r = lane.write;
    for (let j = 0; j < n; j += 1) {
      re[j] = lane.history[r] * win.values[j];
      if (++r === n) r = 0;
    }
    nodeGraphSpectralFftInPlace(re, im);
    const db = new Float32Array(half);
    for (let k = 0; k < half; k += 1) {
      db[k] = nodeGraphSpectralMagToDb(Math.sqrt(re[k] * re[k] + im[k] * im[k]), win.fullScale);
    }
    dataPorts.push([nodeId, `Spectral${key}`, db]);
    any = true;
  }
  if (!any) return;
  if (!state.hz || state.hzRate !== rate) {
    state.hz = Float32Array.from({ length: half }, (_, k) => (k * rate) / n);
    state.hzRate = rate;
  }
  state.serial += 1;
  dataPorts.push([nodeId, "SpectralHz", state.hz]);
  dataPorts.push([nodeId, "SpectralMeta", new Float32Array([state.serial, 0, 0])]);
};

NodeLiveAudioProcessor.prototype.spectralDisplayCollect = function spectralDisplayCollect(nodeId, state, dataPorts) {
  const source = SPECTRAL_DISPLAY_SOURCES[String(this.nodes.get(nodeId)?.type || "")];
  if (!source) return;
  if (source.tap === "prism") this.spectralDisplayPrism(nodeId, state, dataPorts);
  else if (source.tap === "vocoder") this.spectralDisplayVocoder(nodeId, state, dataPorts);
  else if (source.tap === "stft") this.spectralDisplayStft(nodeId, state, dataPorts, source.prefix);
  else this.spectralDisplayAnalyse(nodeId, state, dataPorts, source.lanes);
};

NodeLiveAudioProcessor.prototype.spectralDisplayPrism = function spectralDisplayPrism(nodeId, state, dataPorts) {
  const native=this.nativeGraph,h=this.spectralDisplayNativeHandle(nodeId);
  if(!h||!native?.soemdsp_spectral_prism_display_count)return;
  const serial=native.soemdsp_spectral_prism_display_serial(h);
  const count=native.soemdsp_spectral_prism_display_count(h);
  if(!count||state.prismSerial===serial)return;
  const memory=native.memory.buffer;
  let rate=sampleRate;
  const ptr=native.soemdsp_spectral_prism_display_hz(h)>>>0;
  if(!ptr||ptr+count*4>memory.byteLength)return;
  // Read only the native Nyquist value; no spectrum arrays cross the bridge.
  const nyquist=new Float32Array(memory,ptr,count)[count-1];
  if(nyquist>0)rate=2*nyquist;
  state.prismSerial=serial;
  const size=native.soemdsp_spectral_prism_fft_size(h);
  const position=native.soemdsp_spectral_prism_display_position(h),high=Math.fround(position);
  const evolution=native.soemdsp_spectral_prism_display_evolution(h),evolutionHigh=Math.fround(evolution);
  // Preserve fractional travel for negative positions and long-running sessions.
  dataPorts.push([nodeId,"PrismMeta",new Float32Array([serial,size,high,rate,position-high,evolutionHigh,evolution-evolutionHigh])]);
};
