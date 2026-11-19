# 1D Spectrum Display

Frequency curve shares the linear-to-log mapping with both spectrograms.
It remaps the current spectrum immediately; it does not alter audio or FFT analysis.

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
- Peak decay: fall speed in dB per second (relative to the displayed dB span).

Live Smooth does not smooth or delay peak detection. All drawing uses the shared
WebGL renderer; there is no Canvas2D/vector fallback.
