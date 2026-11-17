const vec3 BG = vec3(13.0, 16.0, 24.0) / 255.0;

vec3 laneColor(int lane) {
  if (lane == 0) return vec3(1.0, 0.82, 0.48);
  if (lane == 1) return vec3(0.48, 0.94, 0.78);
  if (lane == 2) return vec3(0.60, 0.82, 1.0);
  return vec3(1.0, 0.56, 0.80);
}

// --- MAIN ---
vec2 px = vec2(uv.x * resolution.x, (1.0 - uv.y) * resolution.y);
float w = resolution.x;
float h = resolution.y;
vec3 color = BG;
float mask = floor(stepPattern + 0.5);
float cols = max(2.0, floor(steps + 0.5));
float rows = 4.0;
// Pack the four sounding-bar tracks and `steps` columns. If the plate is
// wide enough, add one dimmed context column on each side.
float heightCell = max(2.0, floor((h - 1.0) / rows));
float context = (w >= (cols + 2.0) * heightCell + 1.0) ? 1.0 : 0.0;
float totalCols = cols + 2.0 * context;
float cellWidth = max(2.0, floor(min((w - 1.0) / totalCols, (h - 1.0) / rows)));
float cellHeight = cellWidth;
float gridW = totalCols * cellWidth;
float gridH = rows * cellHeight;
float ox = floor((w - gridW) * 0.5);
float oy = floor((h - gridH) * 0.5);
float gridX = px.x - ox;
float gridY = px.y - oy;
if (gridX >= 0.0 && gridY >= 0.0 && gridX < gridW + 1.0 && gridY < gridH + 1.0) {
  float col = floor(gridX / cellWidth) - context;
  float row = floor(gridY / cellHeight);
  float n = playBar * walk + row * spread;
  float aa = alpha; float bb = beta;
  if (snap > 0.5) { aa = floor(aa * steps + 0.5) / steps; bb = floor(bb * steps + 0.5) / steps; }
  float z = fract(col * aa + n * bb + rho + drift * time);
  float tile = z >= 1.0-aa ? 1.0 : (z >= 1.0-aa-bb ? 2.0 : 0.0);
  vec3 base = vec3(16.0,19.0,28.0)/255.0;
  if (row >= 0.0 && row < rows && gridX < gridW && gridY < gridH) {
    if(view < 0.5) base = tile < 0.5 ? BG : (tile < 1.5 ? vec3(150.0,151.0,255.0)/255.0 : vec3(255.0,42.0,101.0)/255.0);
    else if(view < 1.5) base = tile == 1.0 ? vec3(255.0,42.0,101.0)/255.0 : vec3(26.0,30.0,40.0)/255.0;
    else base = mix(vec3(18.0,20.0,30.0)/255.0, vec3(255.0,42.0,101.0)/255.0, z);
    if (col < -0.5 || col >= steps) base *= 0.55;
  } else {
    base = BG;
  }
  // Shared 1 CSS-px gutters (soundemote-dev: line at c * cs + 0.5, c = 0..cols).
  float pr = max(1.0, pixelRatio);
  float devX = floor(gridX * pr + 1e-4);
  float devY = floor(gridY * pr + 1e-4);
  float cellDev = cellWidth * pr;
  float fx = mod(gridX, cellWidth);
  float fy = mod(gridY, cellHeight);
  if (cellWidth >= 8.0 && (mod(devX, cellDev) < pr || (gridY < gridH + 1.0 && mod(devY, cellDev) < pr)))
    base = mix(base, vec3(0.0), 0.45);
  // Dashed sounding-bar bounds at col 0 and col = steps.
  float bar0 = context * cellDev;
  float bar1 = (context + steps) * cellDev;
  if (((devX >= bar0 && devX < bar0 + pr) || (devX >= bar1 && devX < bar1 + pr))
      && mod(devY, 8.0 * pr) < 4.0 * pr)
    base = mix(base, vec3(1.0), 0.35);
  // One 2px stroke around each packed track row across the sounding bar.
  for (int track = 0; track < 4; track++) {
    if (abs(row - float(track)) > 0.5 || col < -0.5 || col >= steps) continue;
    bool muted = mod(floor(mask / exp2(float(12 + track))), 2.0) > 0.5;
    vec3 tc = muted ? vec3(0.55) : laneColor(track);
    bool edge = (devX >= bar0 && devX < bar0 + 2.0 * pr)
      || (devX >= bar1 - 2.0 * pr && devX < bar1)
      || mod(devY, cellDev) < 2.0 * pr
      || mod(devY, cellDev) >= cellDev - 2.0 * pr;
    if (edge) base = mix(base, tc, 0.85);
  }
  // Playhead: pale column, 1px outline inside the column, inset hits.
  if (playing > 0.5 && abs(col - playStep) < 0.5 && row >= 0.0 && row < rows) {
    base = mix(base, vec3(1.0), 0.16);
    if (mod(devX, cellDev) < pr || mod(devX, cellDev) >= cellDev - pr
        || devY < pr || devY >= floor(gridH * pr + 1e-4) - pr) base = vec3(1.0);
    int track = int(row);
    if (track >= 0 && track < 4) {
      if (mod(floor(mask / exp2(float(12 + track))), 2.0) < 0.5
          && mod(floor(mask / exp2(float(track * 3) + tile)), 2.0) > 0.5
          && fx >= 2.0 && fx < cellWidth - 2.0 && fy >= 2.0 && fy < cellHeight - 2.0)
        base = mix(laneColor(track), base, 0.15);
    }
  }
  color = base;
}
out_color = vec4(color, 1.0);
