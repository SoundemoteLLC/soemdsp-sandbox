#pragma once
// Included after the module exports. Display-only evaluation uses fresh native
// handles in a dedicated worker instance, never the live audio instance.
namespace convolution_resonator_probe {
constexpr int kHeader = 16, kIrPoints = 4096, kBandPoints = 576;
double packet[kHeader + 2 * kIrPoints + 5 * kBandPoints];
double frequencies[kBandPoints];
int insertFrequency(int count, double hz, double minHz, double maxHz) {
  if (!(hz >= minHz && hz <= maxHz) || count >= kBandPoints) return count;
  int at = 0;
  while (at < count && frequencies[at] < hz) ++at;
  if (at < count && __builtin_fabs(frequencies[at] - hz) < 1e-7) return count;
  for (int i = count; i > at; --i) frequencies[i] = frequencies[i - 1];
  frequencies[at] = hz;
  return count + 1;
}
}
extern "C" double* soemdsp_convolution_resonator_probe_buffer() { return convolution_resonator_probe::packet; }
extern "C" int soemdsp_convolution_resonator_probe(double sr, double frequency, double periods,
  double body, double decay, double crunch, double response, double bandwidth, double shift) {
  using namespace convolution_resonator_probe;
  using namespace convolution_resonator;
  const double params[] = {sr, frequency, periods, body, decay, crunch, response, bandwidth, shift};
  for (double value : params) if (!__builtin_isfinite(value)) return -1;
  if (sr < 1000 || frequency < 0 || frequency >= sr * 0.5 || periods <= 0 || decay < 0) return -1;
  const double morph = body <= 0.5 ? 2 * body : 1;
  const double wanted = frequency > 0 ? (periods + 1) / frequency + 8 * decay * morph * morph : 32 / sr;
  double frames = __builtin_ceil(wanted * sr);
  if (!__builtin_isfinite(frames)) return -1;
  if (frames < 32) frames = 32;
  bool limited = frames > 2 * sr || frames > 192000;
  if (frames > 2 * sr) frames = 2 * sr;
  if (frames > 192000) frames = 192000;
  const int count = (int)frames;
  auto* raw = static_cast<double*>(soemdsp::memory_pool::alloc((unsigned long long)count * sizeof(double)));
  if (!raw) return -2;
  const int handle = soemdsp_convolution_resonator_create();
  if (!handle) { soemdsp::memory_pool::release(raw); return -3; }
  const int latency = soemdsp_convolution_resonator_latency();
  double peak = 0;
  for (int i = 0; i < count + latency; ++i) {
    const double value = soemdsp_convolution_resonator_sample(handle, i == 0 ? 1 : 0, 0,
      frequency, periods, 1, sr, 0, body, decay, 0, 0);
    if (!__builtin_isfinite(value)) {
      soemdsp_convolution_resonator_destroy(handle); soemdsp::memory_pool::release(raw); return -4;
    }
    if (i >= latency) { raw[i - latency] = value; if (__builtin_fabs(value) > peak) peak = __builtin_fabs(value); }
  }
  soemdsp_convolution_resonator_destroy(handle);
  int irCount = 0, previous = -1;
  auto point = [&](int index) {
    if (index == previous) return;
    packet[kHeader + 2 * irCount] = index / sr;
    packet[kHeader + 2 * irCount + 1] = raw[index];
    ++irCount; previous = index;
  };
  if (count <= kIrPoints) for (int i = 0; i < count; ++i) point(i);
  else {
    point(0);
    const int bins = (kIrPoints - 2) / 2;
    for (int b = 0; b < bins; ++b) {
      const int begin = (int)((long long)b * count / bins), end = (int)((long long)(b + 1) * count / bins);
      int lo = begin, hi = begin;
      for (int i = begin + 1; i < end; ++i) { if (raw[i] < raw[lo]) lo = i; if (raw[i] > raw[hi]) hi = i; }
      point(lo < hi ? lo : hi); point(lo < hi ? hi : lo);
    }
    point(count - 1);
  }
  soemdsp::memory_pool::release(raw);
  const auto selected = selectCrunch(crunch, response);
  const double width = unit(crunch + bandwidth), ratio = soemdsp_maths::dsp_exp(shift * (0.6931471805599453 / 12));
  const double minHz = 20, maxHz = sr * 0.49999, anchors[4] = {100, 500, 2000, 8000};
  int points = 0;
  for (int i = 0; i < 512; ++i)
    frequencies[points++] = minHz * soemdsp_maths::dsp_exp(soemdsp_maths::dsp_ln(maxHz / minHz) * i / 511);
  const int slots[] = {selected.low, selected.high};
  for (int slot : slots) {
    const int n = 32 << slot;
    for (double center : anchors) {
      const int bin = (int)__builtin_floor(center * n / sr + 0.5);
      for (int offset = -2; offset <= 2; ++offset)
        points = insertFrequency(points, (bin + offset) * sr / n * ratio, minHz, maxHz);
    }
  }
  const int base = kHeader + 2 * irCount;
  for (int i = 0; i < points; ++i) packet[base + i] = frequencies[i];
  for (int i = 0; i < 4 * points; ++i) packet[base + points + i] = 0;
  auto* core = static_cast<CrunchVocoderT<2>*>(soemdsp::memory_pool::alloc(sizeof(CrunchVocoderT<2>)));
  if (!core) return -2;
  core->reset();
  auto bands = [&](auto& frame, int slot) {
    if (slot != selected.low && slot != selected.high) return;
    const double weight = selected.low == selected.high ? 1 : slot == selected.low ? 1 - selected.blend : selected.blend;
    if (weight == 0) return;
    const int n = frame.size;
    for (int band = 0; band < 4; ++band) {
      if (anchors[band] >= sr * 0.5) continue;
      for (int i = 0; i < n; ++i) {
        frame.re[i] = (float)(soemdsp_maths::dsp_cos(soemdsp_maths::kTwoPi * anchors[band] * i / (2 * sr)) * frame.window[i]);
        frame.im[i] = 0;
      }
      frame.analyze();
      for (int k = 0; k <= n / 2; ++k)
        frame.envelope[k] = (float)(__builtin_sqrt((double)frame.re[k] * frame.re[k] + (double)frame.im[k] * frame.im[k]) * 4 / n);
      frame.smooth(width);
      for (int p = 0; p < points; ++p)
        packet[base + points * (band + 1) + p] += weight * frame.envelopeGain(frequencies[p] * n / (2 * sr * ratio));
    }
  };
  bands(core->n32, 0); bands(core->n64, 1); bands(core->n128, 2); bands(core->n256, 3);
  bands(core->n512, 4); bands(core->n1024, 5); bands(core->n2048, 6);
  soemdsp::memory_pool::release(core);
  for (int band = 0; band < 4; ++band) {
    double max = 0;
    double* values = packet + base + points * (band + 1);
    for (int p = 0; p < points; ++p) if (values[p] > max) max = values[p];
    if (max > 0) for (int p = 0; p < points; ++p) values[p] /= max;
  }
  packet[0] = 1; packet[1] = irCount; packet[2] = points; packet[3] = (count - 1) / sr;
  packet[4] = peak; packet[5] = limited ? 1 : 0; packet[6] = 32 << selected.low; packet[7] = 32 << selected.high;
  packet[8] = selected.blend; packet[9] = width; packet[10] = minHz; packet[11] = maxHz;
  packet[12] = sr; packet[13] = frequency; packet[14] = decay; packet[15] = count > kIrPoints ? 1 : 0;
  return base + 5 * points;
}
