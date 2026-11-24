// Typed values with math, for number fields (Step / Smooth Graph point editor
// first; any field can adopt it). No eval: the arithmetic is the parameter
// readouts' own safe parser, parseNodeSliderMathExpression
// (node-graph-slider-metadata.js): numbers, + - * /, parentheses, unary signs.
//
// Every entry is the value itself, whitespace allowed:
//   0.25   -0.5   +0.5   2-3   0.5 -0.23   0.5*3-1   (1+2)/4   1e-3
// A leading * or / is invalid. Returns NaN for anything invalid and for
// results that are not finite (e.g. 1/0), so the caller reverts.

function nodeGraphValueExpressionNormalize(text) {
  return String(text ?? "")
    .trim()
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u00d7/g, "*")
    .replace(/\u00f7/g, "/")
    .replace(/,/g, ".");
}

function nodeGraphValueExpressionParse(text) {
  const source = String(text ?? "").trim();
  if (!source) {
    return NaN;
  }
  // Letters (other than an exponent) are never a value here.
  if (!/^[\d.eE+\-*/()\s]+$/.test(source)) {
    return NaN;
  }
  const value = typeof parseNodeSliderMathExpression === "function"
    ? parseNodeSliderMathExpression(source)
    : NaN;
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Evaluate a typed value. Every entry is a plain absolute expression; there
 * are no "apply to the current value" forms. `current` is unused and kept so
 * callers need not change. A leading "=" is tolerated. Returns NaN when invalid.
 */
function nodeGraphEvaluateValueExpression(text, current = NaN) {
  void current;
  let source = nodeGraphValueExpressionNormalize(text);
  if (source[0] === "=") {
    source = source.slice(1).trim();
  }
  if (!source || source[0] === "*" || source[0] === "/") {
    return NaN;
  }
  return nodeGraphValueExpressionParse(source);
}
