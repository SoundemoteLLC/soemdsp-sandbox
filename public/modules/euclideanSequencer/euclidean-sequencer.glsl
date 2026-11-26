// Fragment body for the shared picture-device shader runner.
// Pattern geometry is a projection of native ring facts; no clock runs here.
vec2 p = (uv - 0.5) * resolution;
float outer = min(resolution.x, resolution.y) * 0.43;
float gap = outer * 0.21;
float radius = length(p);
float angle = fract(atan(p.x, p.y) / 6.28318530718 + 1.0);
float ns[4] = float[4](n0, n1, n2, n3);
float ks[4] = float[4](k0, k1, k2, k3);
float rs[4] = float[4](r0, r1, r2, r3);
float phases[4] = float[4](phase0, phase1, phase2, phase3);
float flashes[4] = float[4](flash0, flash1, flash2, flash3);
float last[4] = float[4](last0, last1, last2, last3);
vec3 colors[4] = vec3[4](vec3(1.0, 0.40, 0.45), vec3(1.0, 0.77, 0.32),
  vec3(0.36, 0.84, 0.95), vec3(0.64, 0.91, 0.49));
vec3 ink = vec3(0.018, 0.024, 0.028);
for (int lane = 0; lane < 4; ++lane) {
  float rr = outer - float(lane) * gap;
  float aa = max(0.7, fwidth(radius));
  float track = 1.0 - smoothstep(0.6, 0.6 + aa, abs(radius - rr));
  ink += colors[lane] * track * 0.22;
  float n = max(1.0, ns[lane]);
  float nearest = floor(angle * n + 0.5);
  float a = nearest / n * 6.28318530718;
  vec2 dotCenter = vec2(sin(a), cos(a)) * rr;
  float i = mod(nearest - floor(rs[lane]), n);
  float k = min(n, max(0.0, floor(ks[lane])));
  float occupied = float(floor(i * k / n) != floor((i - 1.0) * k / n));
  float dotRadius = min(gap * 0.23, max(1.2, 6.28318530718 * rr / n * 0.28));
  float d = length(p - dotCenter);
  float dotInk = 1.0 - smoothstep(dotRadius, dotRadius + aa, d);
  ink = mix(ink, colors[lane] * mix(0.16, 0.85, occupied), dotInk);
  if (engineActive > 0.5) {
    float pa = phases[lane] * 6.28318530718;
    vec2 head = vec2(sin(pa), cos(pa)) * rr;
    float headInk = 1.0 - smoothstep(dotRadius + 1.0, dotRadius + 1.0 + aa, length(p - head));
    ink = mix(ink, vec3(0.95), headInk);
    float ha = last[lane] * 6.28318530718;
    float halo = exp(-length(p - vec2(sin(ha), cos(ha)) * rr) / max(1.0, gap * 0.35));
    ink += colors[lane] * halo * flashes[lane] * 0.8;
  }
}
out_color = vec4(ink, 1.0);
