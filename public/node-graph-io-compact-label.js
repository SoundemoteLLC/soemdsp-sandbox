// IO View A (the compact view): the short label shown beside a side's pill. Pure; the DOM and the GL drawing are node-graph-io-view.js.
//
// Argi's four rules (t425u), applied to ONE side (inputs or outputs) of a module on its own:
//   1. a side with one jack shows that jack's label, connected or not;
//   2. a side with more than one jack and nothing connected shows nothing;
//   3. more than one jack and one connected shows the connected jack's label;
//   4. (HP-22) more than one connection on the side shows only the count of connections: "2", "3", ...
//      This holds for one jack with two cables and for two jacks with one cable each; the number stands on its own.
// "First" is the port definition order (D-I2): the caller passes the ports in that order, never DOM or y order.
// A connection is one cable; a port gives its cable count as `connections` (or `connected: true` for one).

(function (root) {
  "use strict";

  /**
   * @param {{ label: string, connected?: boolean, connections?: number }[]} ports  one side's jacks in port definition order
   * @returns {string} the compact label ("" = none)
   */
  function nodeGraphIoCompactLabel(ports) {
    if (!Array.isArray(ports) || !ports.length) return "";
    const text = (port) => String((port && port.label) || "").replace(/\s+/g, " ").trim();
    const count = (port) => {
      const n = Number(port?.connections);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : (port?.connected ? 1 : 0);
    };
    let first = null;
    let total = 0;
    for (const port of ports) {
      const n = count(port);
      if (!n) continue;
      total += n;
      if (!first) first = port;
    }
    if (total > 1) return String(total);
    if (ports.length === 1) return text(ports[0]);
    return first ? text(first) : "";
  }

  root.nodeGraphIoCompactLabel = nodeGraphIoCompactLabel;
})(typeof window !== "undefined" ? window : globalThis);
