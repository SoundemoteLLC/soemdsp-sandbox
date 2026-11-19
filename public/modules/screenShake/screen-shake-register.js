// Screen Shake — a picture jumps around by a small random amount. A picture effect module (📺 in, 📺 out), nothing global.
registerNodeGraphChromelessModule("screenShake", {
  label: "Screen Shake",
  solidModule: false,
  customDisplayArea: true,
  definition: {
    chrome: "LayoutA",
    planRole: "monitor",
    bufferedInputs: [],
    defaultWidthGu: 8,
    displayHeightGu: 6,
    displayType: "screenShakeFace",
    displayRenderer: "screenShakeFace",
    displayModes: [
      {
        key: "face",
        label: "Face",
        renderer: "screenShakeFace",
        settingsSchema: "screenShakeFace",
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
      rgba: "Picture out, shaken.",
    },
    parameters: [
      {
        defaultValue: "0.25",
        key: "amount",
        label: "Amount",
        linearSmoothing: false,
        max: "1",
        mid: "0.5",
        min: "0",
        nonlinearSlider: false,
        step: "any",
        tooltip: "How far the picture jumps. 0 is still, 1 is 8% of the frame. Wire a signal in to shake on a hit.",
      },
      {
        defaultValue: "0.55",
        key: "rate",
        label: "Rate",
        linearSmoothing: false,
        max: "1",
        mid: "0.5",
        min: "0",
        nonlinearSlider: false,
        step: "any",
        tooltip: "How fast it jitters, from a slow wobble to a rattle.",
      },
    ],
    visualSink: true,
  },
  catalog: {
    category: "rgba",
    description:
      "Shakes a picture: it jumps around by a small random amount. Amount is how far, Rate is how fast. "
      + "A module like any other picture effect, wired between a 📺 out and a 📺 in.",
    notes: ["screen shake", "shake", "rumble", "jitter", "picture", "shader", "LayoutA"],
  },
});
