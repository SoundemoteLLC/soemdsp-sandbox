# 1D Spectrum Display

Frequency curve shares the linear-to-log mapping with both spectrograms.
It remaps the current spectrum immediately; it does not alter audio or FFT analysis.

## Analysis

- One shared analysis core, `public/lib/spectral-analysis.js`: radix-2 FFT with
  cached twiddles, cached windows (Rect / Hann / Hamming / Blackman /
  Blackman-Harris) and their coherent gain. The worklet (Spectrogram, Circular
  Spectrogram, 1D Spectrum), Spectrum Circle and the scope Spectrum mode all use
  it; there is no second FFT.
- 1D Spectrum gets the honest last-analysis magnitude |X[k]| (`SpectrumRaw`),
  never the Spectrogram's EMA / `log10(1 + x·100)` columns. At most 60 analyses
  per second (one curve, no history).
- Bin k sits at k × sampleRate / FFT length. Each pixel column takes the max of
  the bins inside its span plus interpolated span edges, so a bin's true value
  lands in exactly one column (a bin-centred 0 dBFS sine reads 0.00 dB) and
  narrow peaks survive the log axis without comb spikes.

## Level (dB)

- Floor and Ceiling are module parameters on the face (Level band, like
  Spectrogram), continuous, -160 … +24 dB. Defaults -96 / 0.
- Exact dB: a full-scale sine reads 0 dBFS (window coherent gain applied).
  Worst case for a sine between bins is the Hann scalloping loss, about -1.4 dB.
- Linear: magnitude, full-scale sine at the top.
- Nothing fakes a clip: anything louder than Ceiling draws a bright cap along the
  top edge for that frequency range.

## Bass detail

Display Settings, default On. A second FFT with a 4× longer window (capped at
16384 samples, so none when FFT size is already 16384) runs at most 30 times per
second. The face uses it below 150 Hz and the normal FFT above 300 Hz, with a
log-frequency smoothstep between. At the default 2048 / 48 kHz the bass window
is 8192 (5.9 Hz bins): 40 Hz and 80 Hz show a 38 dB dip between them (0.1 dB
without Bass detail). Cost is two FFTs at fixed rates, independent of the
input. Bass reacts a little slower because its window is longer.

Tests: `node scripts/test_spectrum1d.mjs`.

## Live Spectrum

- Smooth (ms): exponential display-height time constant. Zero bypasses smoothing.
  This is independent of the peak envelope and works in Filled, Line, and Bars.
- Draw: Filled, Line, or Bars.

## Adaptive Bars

- Max bars: upper limit, not a guaranteed count at every zoom.
- Bar width: desired occupied fraction of each slot. Zero hides bars; one makes
  them touch. Intermediate widths honor the minimum gap.
- Min bar (px): minimum rendered bar width, default 2.
- Min gap (px): minimum rendered gap, default 1; ignored for touching bars.

Bars mode repaints its stateless face at the final compositor's pixel resolution
(cached picture size times camera zoom and graph render scale), not monitor DPR.
The shared image-quad pixel-snap path keeps both its position and extent integral.
The explicit-size helper is bounded by the shared GPU device. Zoom and resize
therefore recalculate the pixel grid. This is a local exception for stateless bars,
not a change to the fixed-buffer sizing policy of retained Phosphor/Trace displays.

The count decreases when the requested bars no longer fit. Each bar max-pools its
frequency band so narrow peaks survive grouping. Bar widths and gaps are uniform
whole pixels, with remainder space left at the outer margins. Peak markers use the
same horizontal geometry but retain subpixel vertical motion. Peak and smoothing
state are resampled when the screen grid changes instead of being discarded.

## Peak Envelope

- Off: no peak markers.
- Hold, then fall: retain each peak for 0.5 seconds before falling.
- Fall: rise immediately and fall with no hold delay.
- Peak decay (dB/s): continuous, 0.1 … 1000 dB per second over the displayed
  Floor … Ceiling span (Linear counts the face as 96 dB).

Live Smooth does not smooth or delay peak detection. All drawing uses the shared
WebGL renderer; there is no Canvas2D/vector fallback.
