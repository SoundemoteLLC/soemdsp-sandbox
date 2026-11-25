// Shared spectral analysis core: one FFT, one set of analysis windows, one
// definition of "full scale". Loaded in the AudioWorklet blob (Spectrogram /
// Circular Spectrogram / 1D Spectrum analysis) and on the main thread
// (Spectrum Circle, scope Spectrum mode). Display analysis only, no audio DSP.

// Window kinds: 0 Rectangular, 1 Hann, 2 Hamming, 3 Blackman, 4 Blackman-Harris.
const NODE_GRAPH_SPECTRAL_WINDOW_KINDS = 5;

const nodeGraphSpectralFftTableCache = new Map();
const nodeGraphSpectralWindowCache = new Map();

/** Bit-reverse permutation and twiddles for a power-of-two size, cached. */
function nodeGraphSpectralFftTables(n) {
  let t = nodeGraphSpectralFftTableCache.get(n);
  if (t) return t;
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let j = 0;
    for (let b = 0; b < bits; b += 1) if (i & (1 << b)) j |= 1 << (bits - 1 - b);
    rev[i] = j;
  }
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let k = 0; k < half; k += 1) {
    const ang = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(ang);
    sin[k] = Math.sin(ang);
  }
  t = { rev, cos, sin };
  nodeGraphSpectralFftTableCache.set(n, t);
  return t;
}

/** In-place radix-2 FFT on same-length power-of-two real/imag arrays (Float32 or Float64). */
function nodeGraphSpectralFftInPlace(real, imag) {
  const n = real.length;
  if (n <= 1 || (n & (n - 1)) !== 0) return;
  const { rev, cos, sin } = nodeGraphSpectralFftTables(n);
  for (let i = 0; i < n; i += 1) {
    const j = rev[i];
    if (j > i) {
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j += 1) {
        const wr = cos[j * step];
        const wi = sin[j * step];
        const a = i + j;
        const b = a + half;
        const tr = real[b] * wr - imag[b] * wi;
        const ti = real[b] * wi + imag[b] * wr;
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
      }
    }
  }
}

/**
 * Analysis window of length n (cached, shared; do not mutate). `sum` is the
 * coherent gain: a full-scale sine centred on a bin has |X[k]| = sum / 2, so
 * dividing a magnitude by fullScale gives amplitude where 1 = 0 dBFS.
 */
function nodeGraphSpectralWindow(n, kind = 1) {
  const k = Math.max(0, Math.min(NODE_GRAPH_SPECTRAL_WINDOW_KINDS - 1, Math.round(Number(kind) || 0)));
  const key = `${n}|${k}`;
  let w = nodeGraphSpectralWindowCache.get(key);
  if (w) return w;
  const values = new Float64Array(n);
  const denom = Math.max(1, n - 1);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (2 * Math.PI * i) / denom;
    let v;
    if (k === 0) v = 1;
    else if (k === 1) v = 0.5 * (1 - Math.cos(x));
    else if (k === 2) v = 0.54 - 0.46 * Math.cos(x);
    else if (k === 3) v = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    else v = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
    values[i] = v;
    sum += v;
  }
  w = { values, sum, fullScale: sum / 2, kind: k };
  nodeGraphSpectralWindowCache.set(key, w);
  return w;
}

/** Magnitude → dBFS for a window's full scale (1e-12 floor, never -Infinity). */
function nodeGraphSpectralMagToDb(mag, fullScale) {
  return 20 * Math.log10(Math.max(1e-12, Math.max(0, mag) / Math.max(1e-12, fullScale)));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { nodeGraphSpectralFftInPlace, nodeGraphSpectralFftTables, nodeGraphSpectralWindow, nodeGraphSpectralMagToDb };
}
