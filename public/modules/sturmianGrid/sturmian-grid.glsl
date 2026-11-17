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
float colsBar = max(2.0, floor(steps + 0.5));
// Integer square cells. Size so the sounding bar and four tracks still fit,
// then fill the plate edge to edge (extra columns/rows are dimmed context;
// a cell on the far edge may be clipped).
float cell = max(2.0, min(floor(w / colsBar), floor(h / 4.0)));
float visCols = max(1.0, ceil(w / cell));
float visRows = max(1.0, ceil(h / cell));
float fullCols = max(1.0, floor(w / cell));
float fullRows = max(1.0, floor(h / cell));
float col0 = max(0.0, floor((fullCols - colsBar) * 0.5));
float row0 = min(2.0, max(0.0, floor((fullRows - 4.0) * 0.5)));
float gridX = px.x;
float gridY = px.y;
float col = floor(gridX / cell) - col0;
float row = floor(gridY / cell);
float n = row - row0 + playBar * walk;
float aa = alpha; float bb = beta;
if (snap > 0.5) { aa = floor(aa * steps + 0.5) / steps; bb = floor(bb * steps + 0.5) / steps; }
float z = fract(col * aa + n * bb + rho + drift * time);
float tile = z >= 1.0-aa ? 1.0 : (z >= 1.0-aa-bb ? 2.0 : 0.0);
vec3 base = vec3(16.0,19.0,28.0)/255.0;
if(view < 0.5) base = tile < 0.5 ? BG : (tile < 1.5 ? vec3(150.0,151.0,255.0)/255.0 : vec3(255.0,42.0,101.0)/255.0);
else if(view < 1.5) base = tile == 1.0 ? vec3(255.0,42.0,101.0)/255.0 : vec3(26.0,30.0,40.0)/255.0;
else base = mix(vec3(18.0,20.0,30.0)/255.0, vec3(255.0,42.0,101.0)/255.0, z);
if (col < -0.5 || col >= steps) base *= 0.55;
// Shared 1 CSS-px gutters (soundemote-dev: line at c * cs + 0.5, c = 0..cols).
float pr = max(1.0, pixelRatio);
float devX = floor(gridX * pr + 1e-4);
float devY = floor(gridY * pr + 1e-4);
float cellDev = cell * pr;
float fx = mod(gridX, cell);
float fy = mod(gridY, cell);
if (cell >= 8.0 && (mod(devX, cellDev) < pr || mod(devY, cellDev) < pr))
  base = mix(base, vec3(0.0), 0.45);
// Dashed sounding-bar bounds at col 0 and col = steps.
float bar0 = col0 * cellDev;
float bar1 = (col0 + steps) * cellDev;
if (((devX >= bar0 && devX < bar0 + pr) || (devX >= bar1 && devX < bar1 + pr))
    && mod(devY, 8.0 * pr) < 4.0 * pr)
  base = mix(base, vec3(1.0), 0.35);
// One 2px stroke around each track row across the sounding bar.
for (int track = 0; track < 4; track++) {
  float trackN = playBar * walk + float(track) * spread;
  if (abs(n - trackN) > 0.5 || col < -0.5 || col >= steps) continue;
  bool muted = mod(floor(mask / exp2(float(12 + track))), 2.0) > 0.5;
  vec3 tc = muted ? vec3(0.55) : laneColor(track);
  bool edge = (devX >= bar0 && devX < bar0 + 2.0 * pr)
    || (devX >= bar1 - 2.0 * pr && devX < bar1)
    || mod(devY, cellDev) < 2.0 * pr
    || mod(devY, cellDev) >= cellDev - 2.0 * pr;
  if (edge) base = mix(base, tc, 0.85);
}
// Playhead: pale full-height column, 1px outline inside the column, inset hits.
if (playing > 0.5 && abs(col - playStep) < 0.5) {
  base = mix(base, vec3(1.0), 0.16);
  if (mod(devX, cellDev) < pr || mod(devX, cellDev) >= cellDev - pr
      || devY < pr || devY >= floor(h * pr + 1e-4) - pr) base = vec3(1.0);
  for (int track = 0; track < 4; track++) {
    float trackN = playBar * walk + float(track) * spread;
    if (abs(n - trackN) > 0.5) continue;
    if (mod(floor(mask / exp2(float(12 + track))), 2.0) > 0.5) continue;
    if (mod(floor(mask / exp2(float(track * 3) + tile)), 2.0) < 0.5) continue;
    if (fx >= 2.0 && fx < cell - 2.0 && fy >= 2.0 && fy < cell - 2.0)
      base = mix(laneColor(track), base, 0.15);
  }
}
out_color = vec4(base, 1.0);
