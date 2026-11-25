// Spectrogram: worklet-side FFT for the waterfall face (visual analysis only).
// Thru audio is native passthrough. This is not a JS DSP evaluator.
//
// Data: dataPorts → main thread → nodeGraphDataBus → spectrogram-display.js
//
// Display protocol (spectrogramHopMeta / drawNodeGraphSpectrogramItem):
//   Spectrum     — Float32 linear mag bins (half FFT, DC..Nyquist) — last hop
//   SpectrumBatch— concatenated hop columns this quantum (smooth scroll)
//   FftSize      — [fftSize, halfN, spectrumBins, hopSize, sampleRate,
//                   hopSerial, batchColumns, windowSum]
//   hopSerial > 0 and changing is required or the face never paints.
//
// Analysis knobs (from display settings, injected as node.params):
//   fftSize      analysis window samples (128…16384 pot)
//   window       0 Rect … 4 Blackman–Harris
//   overlap      time hop factor index → hop = window / factor
//   freqOverlap  zero-pad factor index → FFT len = min(window×{1,2,4}, 32768)
//
// IMPORTANT — visual buffer frame tracking:
//   postModuleScopeSnapshot already reads ALL visual input buffers and
//   updates buf.postedFrame BEFORE calling per-module collectors.
//   DO NOT use buf.postedFrame to detect new samples — track your own
//   frame position in state.lastAbsoluteFrame instead.

// Hop factor index from display settings (overlap): hop = N / factor.
// 0=none (N), 1=2×, 2=4× (default), 3=8×, 4=16×, 5=32×.
const SPECTROGRAM_HOP_FACTORS = [1, 2, 4, 8, 16, 32];
// Freq zero-pad: denser Hz grid without lengthening the analysis window.
const SPECTROGRAM_FREQ_PAD_FACTORS = [1, 2, 4];

NodeLiveAudioProcessor.prototype.createSpectrogramState = function createSpectrogramState() {
  return {
    fftReal: null,
    fftImag: null,
    emaBins: null,
    spectrumOut: null,
    batchScratch: null,
    windowSize: 0,
    fftLen: 0,
    windowKind: -1,
    hopSerial: 0,
    // Own frame tracking (NOT buf.postedFrame — see note above)
    lastAbsoluteFrame: 0,
  };
};

// Module types that get this display FFT. Spectrogram and Circular
// Spectrogram get Spectrum / SpectrumBatch columns. 1D Spectrum gets
// SpectrumRaw (last-hop |X[k]|, no EMA), SpectrumGain ([window sum]) and,
// with Bass detail on, SpectrumLowRaw + SpectrumLowMeta (long-window FFT).
const SPECTROGRAM_ANALYSIS_TYPES = new Set(["spectrogram", "spectrum1d", "circularSpectrogram"]);

// Display analysis only. setPlan must not call create*State (DSP door).
// Without this map, postModuleScopeSnapshot never emits Spectrum.
NodeLiveAudioProcessor.prototype.syncSpectrogramDisplayAnalysis = function syncSpectrogramDisplayAnalysis(liveIds, reset) {
  if (!(this.spectrogramStates instanceof Map)) {
    this.spectrogramStates = new Map();
  }
  if (reset) {
    this.spectrogramStates.clear();
  }
  const ids = liveIds instanceof Set ? liveIds : null;
  for (const [id, node] of this.nodes || []) {
    if (!SPECTROGRAM_ANALYSIS_TYPES.has(String(node?.type || ""))) continue;
    if (ids && !ids.has(id)) continue;
    if (!this.spectrogramStates.has(id)) {
      this.spectrogramStates.set(id, this.createSpectrogramState());
    }
  }
  for (const id of [...this.spectrogramStates.keys()]) {
    const node = this.nodes?.get?.(id);
    if (!node || !SPECTROGRAM_ANALYSIS_TYPES.has(String(node.type || "")) || (ids && !ids.has(id))) {
      this.spectrogramStates.delete(id);
    }
  }
};


// FFT and windows come from the shared core (public/lib/spectral-analysis.js,
// loaded earlier in the worklet blob): nodeGraphSpectralFftInPlace,
// nodeGraphSpectralWindow.

/**
 * Resolve analysis window size from worklet params.
 * Inject path sends real sizes (128…16384). Legacy choice index 0…3 still works.
 */
NodeLiveAudioProcessor.prototype.spectrogramResolveFftSize = function spectrogramResolveFftSize(params) {
  const raw = Number(params?.fftSize);
  if (!Number.isFinite(raw)) return 1024;
  // Legacy module choice index (old UI).
  if (raw >= 0 && raw <= 3 && Math.abs(raw - Math.round(raw)) < 1e-6) {
    return [256, 512, 1024, 2048][Math.round(raw)] || 1024;
  }
  // Snap to power-of-two in [128, 16384].
  let n = Math.round(raw);
  n = Math.max(128, Math.min(16384, n));
  // Next lower power of two if not already.
  let p = 128;
  while (p * 2 <= n) p *= 2;
  return p;
};

NodeLiveAudioProcessor.prototype.spectrogramCollectDisplayData = function spectrogramCollectDisplayData(nodeId, state, dataPorts) {
  const bufKey = `${nodeId}:In`;
  const buf = this.visualInputBuffers.get(bufKey);
  if (!buf?.buffer?.length) return;

  const node = this.nodes.get(nodeId);
  const params = node?.params || {};

  const winSize = this.spectrogramResolveFftSize(params);
  const windowKind = Math.max(0, Math.min(4, Math.round(nodeGraphFiniteNumber(params.window, 1))));
  const overlapIdx = Math.max(
    0,
    Math.min(SPECTROGRAM_HOP_FACTORS.length - 1, Math.round(nodeGraphFiniteNumber(params.overlap, 2))),
  );
  const hopFactor = SPECTROGRAM_HOP_FACTORS[overlapIdx] || 4;
  const hopSize = Math.max(1, Math.floor(winSize / hopFactor));

  const padIdx = Math.max(
    0,
    Math.min(SPECTROGRAM_FREQ_PAD_FACTORS.length - 1, Math.round(nodeGraphFiniteNumber(params.freqOverlap))),
  );
  const padFactor = SPECTROGRAM_FREQ_PAD_FACTORS[padIdx] || 1;
  // FFT length = window × pad (denser bins); cap 32768.
  let fftLen = winSize * padFactor;
  if (fftLen > 32768) fftLen = 32768;
  const halfN = fftLen >> 1;
  const engineRate = Math.max(1, nodeGraphFiniteNumber(this.engineSampleRate, nodeGraphFiniteNumber(sampleRate, 44100)));
  const sampleStride = Math.max(1, Math.round(nodeGraphFiniteNumber(buf.sampleStride, 1)));
  const sourceRate = Math.max(1, nodeGraphFiniteNumber(buf.sourceSampleRate, engineRate));
  const writeRate = Math.max(
    1,
    nodeGraphFiniteNumber(buf.writeSampleRate, sourceRate / sampleStride),
  );

  // Fresh samples since the last call (own frame tracking, see header note).
  const absFrame = Math.max(0, Math.floor(nodeGraphFiniteNumber(buf.absoluteFrame)));
  const lastFrame = Math.max(0, nodeGraphFiniteNumber(state.lastAbsoluteFrame));
  const capacity = buf.capacity || buf.buffer.length;
  let freshCount = lastFrame > 0
    ? Math.max(0, absFrame - lastFrame)
    : Math.min(capacity, Math.ceil(writeRate / 30));
  freshCount = Math.min(capacity, freshCount);
  if (freshCount <= 0) return;
  state.lastAbsoluteFrame = absFrame;
  const writeIdx = nodeGraphFiniteNumber(buf.writeIndex);
  const start = (writeIdx - freshCount + capacity) % capacity;

  const geometry = { winSize, windowKind, hopSize, fftLen, halfN, writeRate };
  if (String(node?.type || "") === "spectrum1d") {
    this.spectrumLineCollect(nodeId, state, dataPorts, buf, start, freshCount, capacity, geometry, params);
    return;
  }
  this.spectrogramCollectColumns(nodeId, state, dataPorts, buf, start, freshCount, capacity, geometry);
};

// Spectrogram / Circular Spectrogram: every hop becomes a waterfall column.
// The EMA and log10(1 + mag x 100) compression are the spectrogram faces look
// only; 1D Spectrum never goes through this path.
const SPECTROGRAM_COLUMN_EMA_OLD = 0.35;
NodeLiveAudioProcessor.prototype.spectrogramCollectColumns = function spectrogramCollectColumns(
  nodeId, state, dataPorts, buf, start, freshCount, capacity, g,
) {
  const { winSize, windowKind, hopSize, fftLen, halfN, writeRate } = g;
  if (
    !state.fftReal
    || state.windowSize !== winSize
    || state.fftLen !== fftLen
    || state.windowKind !== windowKind
  ) {
    state.fftReal = new Float32Array(fftLen);
    state.fftImag = new Float32Array(fftLen);
    state.windowSize = winSize;
    state.fftLen = fftLen;
    state.windowKind = windowKind;
    state.analysis = nodeGraphSpectralWindow(winSize, windowKind);
    state.accumulator = new Float32Array(winSize);
    state.accumCount = 0;
    state.emaBins = new Float32Array(halfN);
    state.spectrumOut = new Float32Array(halfN);
    state.batchScratch = null;
  }
  let accIdx = state.accumCount;
  let hopsThisFrame = 0;
  // Cap batch columns so a huge quantum does not explode transfer.
  const maxBatchCols = 64;
  const hopColumns = [];
  const aw = state.analysis.values;
  for (let i = 0; i < freshCount; i++) {
    if (accIdx < winSize) {
      state.accumulator[accIdx] = buf.buffer[(start + i) % capacity] || 0;
      accIdx++;
    }
    if (accIdx < winSize) continue;
    state.fftReal.fill(0);
    state.fftImag.fill(0);
    for (let j = 0; j < winSize; j++) state.fftReal[j] = state.accumulator[j] * aw[j];
    nodeGraphSpectralFftInPlace(state.fftReal, state.fftImag);
    const col = new Float32Array(halfN);
    for (let j = 0; j < halfN; j++) {
      const mag = Math.sqrt(state.fftReal[j] * state.fftReal[j] + state.fftImag[j] * state.fftImag[j]);
      state.emaBins[j] = SPECTROGRAM_COLUMN_EMA_OLD * state.emaBins[j] + (1 - SPECTROGRAM_COLUMN_EMA_OLD) * mag;
      col[j] = Math.max(0, Math.log10(1 + state.emaBins[j] * 100));
    }
    if (hopColumns.length >= maxBatchCols) hopColumns.shift();
    hopColumns.push(col);
    hopsThisFrame += 1;
    state.accumulator.copyWithin(0, hopSize, winSize);
    accIdx = winSize - hopSize;
  }
  state.accumCount = accIdx;
  if (hopsThisFrame <= 0) return;

  const batchCols = hopColumns.length;
  state.spectrumOut.set(hopColumns[batchCols - 1]);
  let batchFlat = state.batchScratch;
  if (!batchFlat || batchFlat.length !== batchCols * halfN) {
    batchFlat = new Float32Array(batchCols * halfN);
    state.batchScratch = batchFlat;
  }
  for (let c = 0; c < batchCols; c++) batchFlat.set(hopColumns[c], c * halfN);
  state.hopSerial = nodeGraphFiniteNumber(state.hopSerial) + 1;
  dataPorts.push([nodeId, "Spectrum", state.spectrumOut]);
  dataPorts.push([nodeId, "SpectrumBatch", batchFlat]);
  // [0]=fftLen [1]=halfN [2]=spectrumBins [3]=hopSize (one hop) [4]=sampleRate
  // [5]=hopSerial [6]=batchColumns [7]=windowSum (coherent gain)
  dataPorts.push([nodeId, "FftSize", new Float32Array([
    fftLen, halfN, halfN, hopSize, writeRate, state.hopSerial, batchCols, state.analysis.sum,
  ])]);
};

// 1D Spectrum: honest last-hop magnitudes, at most 60 analyses per second
// (one curve, no waterfall history). With Bass detail on, a second FFT with a
// 4x longer window (capped at 16384 samples) runs at most 30 times per second;
// the face uses it below the crossover. Cost is two FFTs at fixed rates,
// independent of the input.
const SPECTRUM_LINE_MAX_ANALYSES_PER_SECOND = 60;
const SPECTRUM_LINE_BASS_ANALYSES_PER_SECOND = 30;
const SPECTRUM_LINE_BASS_WINDOW_FACTOR = 4;
const SPECTRUM_LINE_BASS_WINDOW_MAX = 16384;
NodeLiveAudioProcessor.prototype.spectrumLineCollect = function spectrumLineCollect(
  nodeId, state, dataPorts, buf, start, freshCount, capacity, g, params,
) {
  const { winSize, windowKind, hopSize, fftLen, halfN, writeRate } = g;
  const bassOn = Math.round(nodeGraphFiniteNumber(params.bassDetail, 1)) !== 0;
  const bassWin = Math.min(SPECTRUM_LINE_BASS_WINDOW_MAX, winSize * SPECTRUM_LINE_BASS_WINDOW_FACTOR);
  const lowWin = bassOn && bassWin > winSize ? bassWin : 0;
  const histLen = Math.max(winSize, lowWin);
  if (
    !state.history
    || state.history.length !== histLen
    || state.windowSize !== winSize
    || state.fftLen !== fftLen
    || state.windowKind !== windowKind
    || state.lowWin !== lowWin
  ) {
    state.history = new Float32Array(histLen);
    state.histWrite = 0;
    state.histFilled = 0;
    state.windowSize = winSize;
    state.fftLen = fftLen;
    state.windowKind = windowKind;
    state.lowWin = lowWin;
    state.analysis = nodeGraphSpectralWindow(winSize, windowKind);
    state.fftReal = new Float32Array(fftLen);
    state.fftImag = new Float32Array(fftLen);
    state.rawOut = new Float32Array(halfN);
    state.gainOut = new Float32Array([state.analysis.sum]);
    state.sinceMain = 0;
    state.sinceLow = 0;
    if (lowWin) {
      state.lowAnalysis = nodeGraphSpectralWindow(lowWin, windowKind);
      state.lowReal = new Float32Array(lowWin);
      state.lowImag = new Float32Array(lowWin);
      state.lowOut = new Float32Array(lowWin >> 1);
      state.lowMeta = new Float32Array([lowWin, state.lowAnalysis.sum]);
    } else {
      state.lowAnalysis = state.lowReal = state.lowImag = state.lowOut = state.lowMeta = null;
    }
  }
  const hist = state.history;
  for (let i = 0; i < freshCount; i++) {
    hist[state.histWrite] = buf.buffer[(start + i) % capacity] || 0;
    state.histWrite = (state.histWrite + 1) % histLen;
  }
  state.histFilled = Math.min(histLen, state.histFilled + freshCount);
  state.sinceMain += freshCount;
  state.sinceLow += freshCount;

  // Window the newest n samples into re (zero-padded to re.length) and FFT.
  const analyse = (re, im, n, win) => {
    re.fill(0);
    im.fill(0);
    let r = (state.histWrite - n + histLen) % histLen;
    for (let j = 0; j < n; j++) {
      re[j] = hist[r] * win[j];
      if (++r === histLen) r = 0;
    }
    nodeGraphSpectralFftInPlace(re, im);
  };
  const mainGap = Math.max(hopSize, Math.floor(writeRate / SPECTRUM_LINE_MAX_ANALYSES_PER_SECOND));
  let posted = false;
  if (state.histFilled >= winSize && state.sinceMain >= mainGap) {
    state.sinceMain = 0;
    analyse(state.fftReal, state.fftImag, winSize, state.analysis.values);
    for (let j = 0; j < halfN; j++) {
      state.rawOut[j] = Math.sqrt(state.fftReal[j] * state.fftReal[j] + state.fftImag[j] * state.fftImag[j]);
    }
    dataPorts.push([nodeId, "SpectrumRaw", state.rawOut]);
    dataPorts.push([nodeId, "SpectrumGain", state.gainOut]);
    posted = true;
  }
  const lowGap = Math.max(lowWin >> 2, Math.floor(writeRate / SPECTRUM_LINE_BASS_ANALYSES_PER_SECOND));
  if (lowWin && state.histFilled >= lowWin && state.sinceLow >= lowGap) {
    state.sinceLow = 0;
    analyse(state.lowReal, state.lowImag, lowWin, state.lowAnalysis.values);
    const half = lowWin >> 1;
    for (let j = 0; j < half; j++) {
      state.lowOut[j] = Math.sqrt(state.lowReal[j] * state.lowReal[j] + state.lowImag[j] * state.lowImag[j]);
    }
    // SpectrumLowMeta: [0]=fftLen [1]=windowSum (coherent gain)
    dataPorts.push([nodeId, "SpectrumLowRaw", state.lowOut]);
    dataPorts.push([nodeId, "SpectrumLowMeta", state.lowMeta]);
    posted = true;
  }
  if (!posted) return;
  state.hopSerial = nodeGraphFiniteNumber(state.hopSerial) + 1;
  // Same FftSize layout as the spectrograms (batchColumns 0: no history).
  dataPorts.push([nodeId, "FftSize", new Float32Array([
    fftLen, halfN, halfN, hopSize, writeRate, state.hopSerial, 0, state.analysis.sum,
  ])]);
};
