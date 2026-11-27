// Shared SVG curve drawing for the Gradient and Pitch Mutator Command Center editors.
(function (root) {
  const NS = "http://www.w3.org/2000/svg";
  function render(svg, { series = [], guides = [], playhead = null } = {}) {
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, rect.width || 320), height = Math.max(1, rect.height || 120);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const x = (v) => 8 + Math.max(0, Math.min(1, v)) * (width - 16);
    const y = (v) => 6 + (1 - Math.max(0, Math.min(1, v))) * (height - 12);
    const parts = [];
    for (const guide of guides) {
      const gx = x(guide.x).toFixed(2);
      parts.push(`<line x1="${gx}" x2="${gx}" y1="0" y2="${height}" stroke="#aab2c0" stroke-opacity=".24" stroke-dasharray="2 4"/>`);
    }
    for (const item of series) {
      const points = item.points || [];
      const selected = !!item.selected;
      const seriesId = encodeURIComponent(item.id);
      if (points.length > 1) {
        let d = `M ${x(points[0].x).toFixed(2)} ${y(points[0].y).toFixed(2)}`;
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1], steps = 24;
          for (let j = 1; j <= steps; j++) {
            const t = j / steps;
            const shape = root.nodeGraphSegmentCurve01 ? root.nodeGraphSegmentCurve01(t, a.shape || "linear", a.skew || 0) : t;
            d += ` L ${x(a.x + (b.x - a.x) * t).toFixed(2)} ${y(a.y + (b.y - a.y) * shape).toFixed(2)}`;
          }
        }
        parts.push(`<path data-curve-series="${seriesId}" d="${d}" fill="none" stroke="${item.color}" stroke-width="${selected ? 2.6 : 1.25}" stroke-opacity="${selected ? 1 : .38}" vector-effect="non-scaling-stroke"/>`);
        // Wide transparent stroke provides a forgiving curve selection target without changing cursor policy.
        parts.push(`<path data-curve-series-hit="${seriesId}" d="${d}" fill="none" stroke="transparent" stroke-width="14"/>`);
      }
      points.forEach((point, index) => {
        const size = 7;
        parts.push(`<rect class="pm-pin ${selected ? "pm-pin-selected" : "pm-pin-other"}" data-curve-series="${seriesId}" data-curve-point="${index}" x="${(x(point.x) - size / 2).toFixed(2)}" y="${(y(point.y) - size / 2).toFixed(2)}" width="${size}" height="${size}" rx="1.5" fill="${item.color}" fill-opacity="${selected ? 1 : .48}" stroke="${selected ? "#fff" : "none"}" stroke-width="${selected ? 1 : 0}" vector-effect="non-scaling-stroke"/>`);
      });
    }
    if (playhead !== null && Number.isFinite(playhead)) {
      const px = x(playhead).toFixed(2);
      parts.push(`<line data-curve-playhead="1" data-pm="playhead-line" x1="${px}" x2="${px}" y1="0" y2="${height}" stroke="#fff" stroke-width="1.3" stroke-opacity=".9" vector-effect="non-scaling-stroke"/>`);
    }
    svg.innerHTML = parts.join("");
  }
  root.NodeGraphCurveGraph = Object.freeze({ render });
})(window);
