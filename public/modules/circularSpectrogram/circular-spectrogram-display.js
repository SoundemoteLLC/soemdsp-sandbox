// Circular Spectrogram: the classic mirrored polar spectrogram (display only).
//
// Shares everything with Spectrogram except the lookup:
//   • Analysis: the Spectrogram worklet FFT (SPECTROGRAM_ANALYSIS_TYPES), so
//     FFT size / window / overlap / pad / freq scale / gradient / pause on
//     silence are the same Display Settings.
//   • Ink: the same GPU ring of raw spectrum columns with per-column settings
//     (spectrogram-gl.js), so a knob change only affects new ink.
//   • Shader: spectrogramGlRingPresentPolar maps each face pixel to
//     angle → column age and radius → frequency (bass at the inner radius).
//
// Fixed Head scrolls the spectrum history away from a fixed angle. Moving Head
// keeps one clean revolution and retires overwritten pixels into a separate
// afterglow plate. Hang is measured in turns, independent of Spin speed.
// Spin (Hz) advances in audio time; zero holds both picture layers.
// Mirror on: both halves show the same history, so a kick throws a matching
// pair of arms that travel down (or up) the circle. Mirror off: one sweep all
// the way round (clockwise from the top for Down, anticlockwise from the
// bottom for Up). Spin 1 Hz is one mirrored half-sweep or full unmirrored turn.
//
// Frequency curve continuously blends linear (0) and logarithmic (1, default)
// radial spacing, independently of Reverse Frequency.
//
// State lives in spectrogramHistory so engine stop, wipe and delete clear it
// the same way as Spectrogram (and screen solo keeps the module buffer size
// through spectrogramBufferSizeForFace).

const CIRCULAR_SPECTROGRAM_MIN_COLUMNS = 128;
const CIRCULAR_SPECTROGRAM_MAX_COLUMNS = 2048;

function circularSpectrogramNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** About one column per face pixel along the rim of the visible sweep. */
function circularSpectrogramColumnsFor(bufW, bufH, mirror) {
  const radius = 0.5 * Math.max(1, Math.min(bufW | 0, bufH | 0));
  const arc = Math.PI * radius * (mirror ? 1 : 2);
  return Math.max(
    CIRCULAR_SPECTROGRAM_MIN_COLUMNS,
    Math.min(CIRCULAR_SPECTROGRAM_MAX_COLUMNS, Math.round(arc)),
  );
}

function circularSpectrogramEnsureState(nodeId, bufW, bufH, mirror, historySeconds) {
  const key = String(nodeId || "");
  const w = Math.max(1, bufW | 0);
  const h = Math.max(1, bufH | 0);
  let st = spectrogramHistory.get(key);
  if (!st || st.circular !== true) {
    if (st?.ring && typeof spectrogramGlRingRelease === "function") {
      spectrogramGlRingRelease(st.ring);
    }
    st = {
      circular: true,
      faceW: w,
      faceH: h,
      scrollDebtSec: 0,
      sweepPhase: 0,
      pendingColumns: 0,
      pendingTurns: 0,
      lastHop: -1,
      lastAbs: Number.NaN,
      ring: null,
      historySeconds,
    };
    spectrogramHistory.set(key, st);
  } else if (
    Math.abs((st.faceW | 0) - w) >= SPECTROGRAM_REBUFFER_DELTA_PX
    || Math.abs((st.faceH | 0) - h) >= SPECTROGRAM_REBUFFER_DELTA_PX
  ) {
    st.faceW = w;
    st.faceH = h;
  }
  st.columns = circularSpectrogramColumnsFor(st.faceW, st.faceH, mirror);
  if (st.ring && st.ring.w !== st.columns) {
    st.ring = spectrogramGlRingResize(st.ring, st.columns);
  }
  st.historySeconds = historySeconds;
  return st;
}

/** Audio-clock elapsed time, independent of FFT packet arrival and render cadence. */
function circularSpectrogramElapsed(st, time, source, active) {
  const previous = st.clockTime;
  const sameClock = st.clockSource === source;
  st.clockSource = source;
  if (!Number.isFinite(time)) {
    st.clockTime = Number.NaN;
    return 0;
  }
  st.clockTime = sameClock && Number.isFinite(previous) ? Math.max(previous, time) : time;
  return active && sameClock && Number.isFinite(previous) ? Math.max(0, time - previous) : 0;
}

function circularSpectrogramClock(liveIn, sampleRate) {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp.live : null;
  const ctx = live?.context;
  if (ctx?.state === "running" && live.node) {
    let time = Number(ctx.currentTime);
    if (typeof ctx.getOutputTimestamp === "function") {
      const stamp = ctx.getOutputTimestamp();
      if (Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) && stamp.performanceTime > 0) {
        time = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
      }
    }
    return { time, source: ctx };
  }
  // Plugin: no AudioContext. Follow the host's sample counter, never packet count.
  return { time: Number(liveIn?.absoluteFrame) / Math.max(1, sampleRate), source: liveIn };
}

/** Paint elapsed sweep time using the latest available spectrum (sample-and-hold). */
function circularSpectrogramAdvance(st, spectrum, bins, seconds, ink) {
  if (!(st.spinHz > 0)) {
    st.ring.pendingValid = false;
    st.ring.pending.fill(0);
    return;
  }
  if (!(seconds > 0)) return;
  spectrogramGlRingPool(st.ring, spectrum, bins);
  const cols = Math.max(1, st.ring.w | 0);
  const secPerCol = st.historySeconds / cols;
  st.scrollDebtSec = Math.max(0, circularSpectrogramNumber(st.scrollDebtSec, 0))
    + seconds;
  const whole = Math.floor(st.scrollDebtSec / Math.max(1e-12, secPerCol));
  if (whole < 1) return;
  spectrogramGlRingWrite(st.ring, Math.min(cols, whole), ink);
  st.pendingColumns = Math.min(cols, st.pendingColumns + whole);
  st.pendingTurns += whole / cols;
  st.sweepPhase = ((st.sweepPhase || 0) + whole / cols) % 1;
  st.scrollDebtSec = Math.max(0, st.scrollDebtSec - whole * secPerCol);
}

/** Leftover hop-time as a fraction of one column [0, 1). */
function circularSpectrogramSubColumn(st) {
  const cols = Math.max(1, st?.ring?.w | 0);
  const sub = circularSpectrogramNumber(st?.scrollDebtSec, 0) / Math.max(1e-12, st.historySeconds / cols);
  if (!Number.isFinite(sub) || sub <= 0) return 0;
  return sub < 1 ? sub : 0.999;
}

function drawNodeGraphCircularSpectrogramItem(_renderer, item, pixelRatio) {
  const nodeId = String(item?.slot?.nodeId || "");
  if (!nodeId) return;

  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || !screenElement) return;

  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, 1)) return;
  canvas.style.mixBlendMode = "normal";
  canvas.classList.add("node-spectrogram-canvas");
  nodeGraphDisplayCanvasPixelated(canvas, false);

  const ctx = nodeGraphSharedGlPresentTarget(canvas);
  if (!ctx) return;

  const faceW = canvas.width | 0;
  const faceH = canvas.height | 0;
  if (faceW < 1 || faceH < 1) return;

  const node = nodeGraphPatchNode(nodeId);
  const p = node?.params && typeof node.params === "object" ? node.params : {};
  const settings = spectrogramSettingsForNode(node);
  const ceilingDb = circularSpectrogramNumber(p.ceilingDb, 0);
  const floorDb = circularSpectrogramNumber(p.floorDb, -80);
  const mirror = Math.round(circularSpectrogramNumber(p.mirror, 1)) !== 0;
  const up = Math.round(circularSpectrogramNumber(p.direction, 0)) === 1;
  const reverseFrequency = settings.reverseFrequency === true;
  // Rotate is in turns (0…1 wraps), like the other phase knobs.
  const rotate = circularSpectrogramNumber(p.rotate, 0) * 2 * Math.PI;
  const inner = Math.max(0, Math.min(0.9, circularSpectrogramNumber(p.innerRadius, 0.12)));
  // Curve is a module parameter, applied live to the whole history.
  const frequencyCurve = Math.max(0, Math.min(1, circularSpectrogramNumber(p.frequencyCurve, 1)));
  const lutStops = typeof nodeGraphApplyGradientHueRotation === "function"
    ? nodeGraphApplyGradientHueRotation(settings.gradientStops, settings)
    : settings.gradientStops;
  const lutRgb = spectrogramLutRgbForStops(lutStops);
  const spinHz = Math.max(0, circularSpectrogramNumber(p.spinHz, 0.5));
  const historySeconds = spinHz > 0 ? 1 / spinHz : 2;

  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, spectrogramCssAtBrightness(lutRgb, 0));
  }

  const spectrum = nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, "Spectrum"));
  const spectrumBatch = nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, "SpectrumBatch"));
  const spectrumBins = (spectrum instanceof Float32Array) ? spectrum.length : 0;

  const { sampleRate, hopSerial, batchColumns, windowSum, fftSize } = spectrogramHopMeta(settings, node);
  const winSum = windowSum > 0 ? windowSum : Math.max(1, fftSize) / 2;
  const fullMag = Math.max(1e-9, winSum / 2);
  const buf = spectrogramBufferSizeForFace(nodeId, faceW, faceH, screenElement);
  const st = circularSpectrogramEnsureState(nodeId, buf.w, buf.h, mirror, historySeconds);
  st.spinHz = spinHz;
  if (!st.ring) st.ring = spectrogramGlRingCreate(st.columns, lutRgb);
  st.ring.frequencyCurve = frequencyCurve;

  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();

  // Pause on silence (Display Settings, default off): same rule as Spectrogram.
  const liveIn = nodeGraphModuleScopeState?.buffers?.get?.(`${nodeId}:In`) || null;
  if (!Number.isFinite(st.lastAbs) && typeof nodeGraphWaterfallUndrawn === "function") {
    const seed = nodeGraphWaterfallUndrawn(liveIn, st.lastAbs);
    if (Number.isFinite(seed.absEnd) && seed.count > 0) {
      st.lastAbs = Math.max(0, seed.absEnd - seed.count);
    }
  }
  const undrawn = typeof nodeGraphWaterfallUndrawn === "function"
    ? nodeGraphWaterfallUndrawn(liveIn, st.lastAbs)
    : { count: 0, absEnd: Number.NaN };
  const pauseOnSilence = typeof nodeGraphWaterfallPauseOnSilence === "function"
    ? nodeGraphWaterfallPauseOnSilence(settings)
    : settings?.pauseOnSilence === true;
  const silentHold = pauseOnSilence
    && typeof nodeGraphWaterfallIncomingIsSilent === "function"
    && nodeGraphWaterfallIncomingIsSilent(
      { buffer: liveIn, slot: item?.slot },
      settings,
      undrawn,
      liveIn,
    );

  const bins = spectrumBins > 0 ? spectrumBins
    : (spectrumBatch instanceof Float32Array && batchColumns > 0
      ? Math.floor(spectrumBatch.length / batchColumns) : 0);
  const hasBatch = spectrumBatch instanceof Float32Array && batchColumns > 0
    && bins > 0 && spectrumBatch.length >= batchColumns * bins;
  const clock = circularSpectrogramClock(liveIn, sampleRate);
  const seconds = circularSpectrogramElapsed(st, clock.time, clock.source,
    !frozen && !silentHold && spinHz > 0 && hopSerial > 0 && bins > 0);
  if (!(spinHz > 0)) circularSpectrogramAdvance(st, null, 0, 0, null);
  if (seconds > 0) {
    const band = spectrogramResolveViewBand(settings.minFreq, settings.maxFreq, sampleRate);
    const ink = { floorDb, ceilingDb,
      minFreq: band.minFreq, maxFreq: band.maxFreq, nyquist: band.nyquist, lutRgb };
    if (hasBatch && hopSerial !== st.lastHop) {
      // Distribute this frame's elapsed time across the available spectra;
      // packet count never determines sweep speed.
      for (let c = 0; c < batchColumns; c += 1) {
        circularSpectrogramAdvance(st, spectrumBatch.subarray(c * bins, (c + 1) * bins),
          bins, seconds / batchColumns, ink);
      }
    } else {
      const latest = spectrumBins > 0 ? spectrum
        : spectrumBatch.subarray((batchColumns - 1) * bins, batchColumns * bins);
      circularSpectrogramAdvance(st, latest, bins, seconds, ink);
    }
  }
  st.lastHop = hopSerial;
  if (Number.isFinite(undrawn.absEnd) && undrawn.count > 0) st.lastAbs = undrawn.absEnd;

  const ok = spectrogramGlRingPresentPolarRetained(st.ring, canvas,
    spectrogramLutRgb01(lutRgb, 0), fullMag,
    { mirror, up, rotate, inner, reverseFrequency, sweepPhase: st.sweepPhase,
      movingHead: settings.circularHeadMode === "moving" },
    settings, frozen ? 0 : st.pendingColumns, frozen ? 0 : st.pendingTurns);
  if (ok) {
    if (!frozen) {
      st.pendingColumns = 0;
      st.pendingTurns = 0;
    }
    st.hasFrame = true;
    return;
  }
  st.hasFrame = false;
  nodeGraphDisplayGlFailed(canvas, "Circular Spectrogram sweep GL present failed");
}
