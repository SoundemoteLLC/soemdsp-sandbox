// IO View A (the compact view): the short label shown beside a side's pill. Pure; the DOM and the GL drawing are node-graph-io-view.js.
//
// Argi's four rules (t425u), applied to ONE side (inputs or outputs) of a module on its own:
//   1. a side with one jack shows that jack's label, connected or not;
//   2. a side with more than one jack and nothing connected shows nothing;
//   3. more than one jack and one connected shows the connected jack's label;
//   4. more than one jack and several connected shows the first connected jack's label, a comma and how many MORE are connected
//      (connected count minus one): "⎍, 1".
// "First" is the port definition order (D-I2): the caller passes the ports in that order, never DOM or y order.
// A "connected thing" is a jack with at least one cable.

(function (root) {
  "use strict";

  /**
   * @param {{ label: string, connected: boolean }[]} ports  one side's jacks in port definition order
   * @returns {string} the compact label ("" = none)
   */
  function nodeGraphIoCompactLabel(ports) {
    if (!Array.isArray(ports) || !ports.length) return "";
    const text = (port) => String((port && port.label) || "").replace(/\s+/g, " ").trim();
    if (ports.length === 1) return text(ports[0]);
    let first = null;
    let connected = 0;
    for (const port of ports) {
      if (!port || !port.connected) continue;
      connected += 1;
      if (!first) first = port;
    }
    if (!first) return "";
    return connected === 1 ? text(first) : `${text(first)}, ${connected - 1}`;
  }

  root.nodeGraphIoCompactLabel = nodeGraphIoCompactLabel;
})(typeof window !== "undefined" ? window : globalThis);
