// CRT Raster — the raster of a CRT: scanlines (one row of light per line, dark gaps between), the beam widening where the picture is
// bright so bright areas fill the gaps. A picture effect module (📺 in, 📺 out), nothing global. The bend / vignette / glare live in
// Screen Glass and the colour fringing in Aberration: wire this after Screen Glass so the lines stay straight on the screen.
registerNodeGraphChromelessModule("crtRaster", {
  label: "CRT Raster",
  solidModule: false,
  customDisplayArea: true,
  definition: {
    chrome: "LayoutA",
    planRole: "monitor",
    bufferedInputs: [],
    defaultWidthGu: 8,
    displayHeightGu: 6,
    displayType: "crtRasterFace",
    displayRenderer: "crtRasterFace",
    displayModes: [
      {
        key: "face",
        label: "Face",
        renderer: "crtRasterFace",
        settingsSchema: "crtRasterFace",
      },
    ],
    defaultDisplayMode: "face",
    inputs: ["rgba"],
    inputLabels: { rgba: "📺" },
    inputTooltips: {
      rgba: "Picture in. Same shared picture context.",
    },
    outputs: ["rgba"],
    outputLabels: { rgba: "📺" },
    outputTooltips: {
      rgba: "Picture out, with the raster lines.",
    },
    parameters: [
      {
        constraint: "gpu",
        defaultValue: "4",
        key: "pitch",
        label: "Pitch",
        linearSmoothing: false,
        max: "12",
        mid: "4",
        min: "2",
        nonlinearSlider: false,
        step: "1",
        tooltip: "Picture rows per scanline, a whole number so the lines sit on the pixel grid and never beat against it. 2 is the finest. Modulated, it steps from one whole number to the next.",
      },
      {
        defaultValue: "0.6",
        key: "depth",
        label: "Depth",
        linearSmoothing: false,
        max: "4",
        mid: "1",
        min: "0",
        nonlinearSlider: false,
        step: "any",
        tooltip: "How dark the gaps between the lines are. 0 is no lines, 1 is the full raster. Past 1 it is over-applied: the gaps clip to black and the middle of each line is pushed brighter than the picture.",
      },
      {
        defaultValue: "0.6",
        key: "beam",
        label: "Beam",
        linearSmoothing: false,
        max: "10",
        mid: "1",
        min: "0",
        nonlinearSlider: false,
        step: "any",
        tooltip: "How much the beam widens where the picture is bright, so bright areas fill the gaps and dim ones show them. 0 keeps every line the same width. Past 1 it is over-applied: even dim areas widen, so the lines fill in everywhere except the darkest parts and bright areas bloom past their own line.",
      },
    ],
    visualSink: true,
  },
  catalog: {
    category: "rgba",
    description:
      "Scanlines: one row of light per line with dark gaps between. Pitch is the rows per line, Depth how dark the gaps are, "
      + "Beam how much bright areas widen to fill them. A module like any other picture effect, wired between a 📺 out and a 📺 in.",
    notes: ["crt", "raster", "scanlines", "scan lines", "picture", "shader", "LayoutA"],
  },
});
