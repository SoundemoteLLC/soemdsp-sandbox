#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/atan2.h>

namespace soemdsp_spectral_freeze {
constexpr int maximum = 16384, bins = maximum / 2 + 1, historySize = maximum + maximum / 4;
constexpr double pi = 3.14159265358979323846, twoPi = 2 * pi;
inline soemdsp::fft::Radix2<512> f512{};
inline soemdsp::fft::Radix2<1024> f1024{};
inline soemdsp::fft::Radix2<2048> f2048{};
inline soemdsp::fft::Radix2<4096> f4096{};
inline soemdsp::fft::Radix2<8192> f8192{};
inline soemdsp::fft::Radix2<maximum> f16384{};
inline void prepare() { f512.ensure(); f1024.ensure(); f2048.ensure(); f4096.ensure(); f8192.ensure(); f16384.ensure(); }
inline void transform(int n, float* re, float* im, bool inverse) {
  switch (n) {
    case 512: f512.transform(re, im, inverse); break;
    case 1024: f1024.transform(re, im, inverse); break;
    case 2048: f2048.transform(re, im, inverse); break;
    case 4096: f4096.transform(re, im, inverse); break;
    case 8192: f8192.transform(re, im, inverse); break;
    default: f16384.transform(re, im, inverse); break;
  }
}
inline bool validSize(int n) { return n == 512 || n == 1024 || n == 2048 || n == 4096 || n == 8192 || n == 16384; }
inline double unit(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline void normalize(double& r, double& i) { const double n = __builtin_sqrt(r*r + i*i); if (n > 1e-30) { r /= n; i /= n; } else { r = 1; i = 0; } }
struct Snapshot { float pcm[2][historySize]; int count; };
struct History {
  float pcm[2][historySize]; int cursor, count;
  void reset() { cursor = count = 0; for (auto& c : pcm) for (auto& v : c) v = 0; }
  void push(double l, double r) { pcm[0][cursor] = (float)l; pcm[1][cursor] = (float)r; cursor = (cursor + 1) % historySize; if (count < historySize) ++count; }
  double at(int c, int delay) const { int i = cursor - 1 - delay; if (i < 0) i += historySize; return pcm[c][i]; }
  void copy(Snapshot& out) const {
    out.count = count;
    for (int c = 0; c < 2; ++c) for (int i = 0; i < historySize; ++i) out.pcm[c][i] = pcm[c][(cursor + i) % historySize];
  }
};
struct Core {
  float ola[2][maximum], re[maximum], im[maximum], window[maximum];
  double magnitude[2][bins], phaseR[2][bins], phaseI[2][bins], velocityR[2][bins], velocityI[2][bins];
  double previousR[2][bins], previousI[2][bins], offset[bins], side[bins];
  unsigned int rng, sideRng;
  int size, position, hop; bool valid, previousLive;
  double right;
  void reset(int n) {
    size = n; position = hop = 0; valid = previousLive = false; right = 0;
    rng = 0x9e3779b9u; sideRng = 0xC2B2AE35u;
    for (int i = 0; i < maximum; ++i) {
      const int index = i < n ? (i < n/2 ? i : n-i) * (maximum/n) : 0;
      window[i] = i >= n ? 0 : i == n/2 ? 1 : 0.5f - 0.5f*f16384.twRe[index];
      ola[0][i] = ola[1][i] = 0;
    }
    for (int k = 0; k < bins; ++k) {
      offset[k] = side[k] = 0;
      for (int c = 0; c < 2; ++c) {
        magnitude[c][k] = previousR[c][k] = previousI[c][k] = phaseI[c][k] = 0;
        phaseR[c][k] = 1;
        const int q = k % 4;
        velocityR[c][k] = q == 0 ? 1 : q == 2 ? -1 : 0;
        velocityI[c][k] = q == 1 ? 1 : q == 3 ? -1 : 0;
      }
    }
  }
  void capture(const Snapshot& source) {
    for (int c = 0; c < 2; ++c) {
      for (int pass = 0; pass < 2; ++pass) {
        const int start = historySize - size - (pass ? 0 : size/4);
        for (int i = 0; i < size; ++i) { re[i] = source.pcm[c][start+i] * window[i]; im[i] = 0; }
        transform(size, re, im, false);
        for (int k = 0; k <= size/2; ++k) {
          const double a = re[k], b = im[k];
          if (pass == 0) { previousR[c][k] = a; previousI[c][k] = b; continue; }
          const double p = a*a+b*b, old = previousR[c][k]*previousR[c][k]+previousI[c][k]*previousI[c][k];
          magnitude[c][k] = __builtin_sqrt(p);
          if (p > 1e-24) { phaseR[c][k] = a/magnitude[c][k]; phaseI[c][k] = b/magnitude[c][k]; }
          if (p > 1e-24 && old > 1e-24) {
            const double norm = __builtin_sqrt(p*old);
            velocityR[c][k] = (a*previousR[c][k]+b*previousI[c][k])/norm;
            velocityI[c][k] = (b*previousR[c][k]-a*previousI[c][k])/norm;
          }
        }
      }
    }
    valid = true; previousLive = false;
  }
  void remap(const Core& old) {
    const double ratio = (double)size / old.size;
    for (int c = 0; c < 2; ++c) {
      for (int j = 0; j <= size/2; ++j) { phaseR[c][j] = phaseI[c][j] = previousR[c][j] = 0; }
      for (int k = 0; k <= old.size/2; ++k) {
        const double oldVR = old.velocityR[c][k], oldVI = old.velocityI[c][k];
        const int q = k%4; const double br = q == 0 ? 1 : q == 2 ? -1 : 0, bi = q == 1 ? 1 : q == 3 ? -1 : 0;
        const double residual = soemdsp::math::atan2_approx(oldVI*br-oldVR*bi,oldVR*br+oldVI*bi);
        double measured = k+residual*(2/pi);
        if (measured < 0) measured = 0;
        if (measured > old.size/2) measured = old.size/2;
        const double target = measured*ratio; const int a = (int)target; const double f = target-a;
        double vr,vi; soemdsp_maths::dsp_sin_cos(pi*0.5*target,&vi,&vr);
        const double p = old.magnitude[c][k]*old.magnitude[c][k]*(k == 0 || k == old.size/2 ? 1 : 2)*ratio*ratio;
        for (int slot = 0; slot < 2; ++slot) {
          const int j = a+slot; if (j > size/2) continue;
          const double weight = p*(slot ? f : 1-f);
          magnitude[c][j] += weight;
          if (weight > previousR[c][j]) {
            previousR[c][j] = weight; velocityR[c][j] = vr; velocityI[c][j] = vi;
            phaseR[c][j] = old.phaseR[c][k]; phaseI[c][j] = old.phaseI[c][k];
            offset[j] = old.offset[k]; side[j] = old.side[k];
          }
        }
      }
      for (int j = 0; j <= size/2; ++j) {
        magnitude[c][j] = __builtin_sqrt(magnitude[c][j]/(j == 0 || j == size/2 ? 1 : 2));
        normalize(phaseR[c][j],phaseI[c][j]); normalize(velocityR[c][j],velocityI[c][j]);
      }
    }
    valid = old.valid; previousLive = false; rng = old.rng; sideRng = old.sideRng;
  }
  double random(unsigned int& state) { state ^= state<<13; state ^= state>>17; state ^= state<<5; return (double)state*(2.0/4294967296.0)-1; }
  bool frame(const History& source, double decay, double refresh, double diffusion, double spread, double rate) {
    const int nBins = size/2+1, step = size/4;
    const double loss = decay > 0 ? soemdsp_maths::dsp_exp(-step/(rate*decay)) : 1;
    const double follow = refresh > 0 ? 1-soemdsp_maths::dsp_exp(-step*refresh/rate) : 0;
    const double jitter = __builtin_sqrt(12*twoPi*2*step/rate);
    for (int k = 1; k < nBins-1; ++k) { offset[k] += random(rng)*jitter; side[k] += random(sideRng)*jitter; }
    for (int c = 0; c < 2; ++c) {
      if (follow > 0) {
        for (int i = 0; i < size; ++i) { re[i] = (float)source.at(c,size-1-i)*window[i]; im[i] = 0; }
        transform(size,re,im,false);
      }
      for (int k = 0; k < nBins; ++k) {
        magnitude[c][k] *= loss;
        if (follow > 0) {
          const double a = re[k], b = im[k], p = a*a+b*b;
          if (!__builtin_isfinite(p)) return false;
          magnitude[c][k] = __builtin_sqrt((1-follow)*magnitude[c][k]*magnitude[c][k]+follow*p);
          const double old = previousR[c][k]*previousR[c][k]+previousI[c][k]*previousI[c][k];
          if (previousLive && p > 1e-24 && old > 1e-24) {
            const double norm = __builtin_sqrt(p*old);
            const double vr = (a*previousR[c][k]+b*previousI[c][k])/norm;
            const double vi = (b*previousR[c][k]-a*previousI[c][k])/norm;
            velocityR[c][k] += follow*(vr-velocityR[c][k]); velocityI[c][k] += follow*(vi-velocityI[c][k]);
            normalize(velocityR[c][k],velocityI[c][k]);
          }
          previousR[c][k] = a; previousI[c][k] = b;
        }
        const double pr = phaseR[c][k], pi0 = phaseI[c][k];
        phaseR[c][k] = pr*velocityR[c][k]-pi0*velocityI[c][k];
        phaseI[c][k] = pr*velocityI[c][k]+pi0*velocityR[c][k]; normalize(phaseR[c][k],phaseI[c][k]);
        double sn = 0,cs = 1;
        if (k > 0 && k < nBins-1 && diffusion > 0) soemdsp_maths::dsp_sin_cos(diffusion*(offset[k]+(c ? 0.5 : -0.5)*spread*side[k]),&sn,&cs);
        re[k] = (float)(magnitude[c][k]*(phaseR[c][k]*cs-phaseI[c][k]*sn));
        im[k] = k == 0 || k == nBins-1 ? 0 : (float)(magnitude[c][k]*(phaseR[c][k]*sn+phaseI[c][k]*cs));
        if (k > 0 && k < nBins-1) { re[size-k] = re[k]; im[size-k] = -im[k]; }
      }
      transform(size,re,im,true);
      for (int i = 0; i < size; ++i) ola[c][(position+1+i)%size] += re[i]*window[i]*(2.0f/3);
    }
    previousLive = follow > 0; return true;
  }
  double tick(const History& source, double decay, double refresh, double diffusion, double spread, double rate) {
    const double out = ola[0][position]; right = ola[1][position]; ola[0][position] = ola[1][position] = 0;
    if (++hop == size/4) { hop = 0; if (valid && !frame(source,decay,refresh,diffusion,spread,rate)) { reset(size); return 0; } }
    position = (position+1)%size; return out;
  }
};
struct State {
  Core cores[2]; History history; Snapshot requested;
  int current, desired, warm; bool changing, started, captureQueued, lastGate, lastCapture, uiCapture;
  double captureBlendMs, refreshHz, lastCount, fade, holdBlend, right, held, lastRate;
  unsigned long long captures;
  void reset() {
    history.reset(); requested.count = 0;
    for (auto& c : cores) c.reset(4096);
    current = warm = 0; changing = started = captureQueued = lastGate = lastCapture = uiCapture = false;
    fade = holdBlend = right = held = lastRate = 0;
    captures = 0;
  }
  void initialize() { desired = 4096; captureBlendMs = 20; refreshHz = lastCount = 0; prepare(); reset(); }
  void requestCapture() { captureQueued = true; }
  void begin(bool capture) {
    Core& to = cores[1-current]; to.reset(desired);
    if (capture) { to.capture(requested); captureQueued = false; ++captures; }
    else if (cores[current].valid) to.remap(cores[current]);
    warm = desired; fade = 0; changing = true;
  }
  double tick(double l, double r, double gate, double recapture, double decay, double diffusion, double spread, double mix, double rate) {
    const double values[] = {l,r,gate,recapture,decay,diffusion,spread,mix,rate};
    for (double v : values) if (!__builtin_isfinite(v)) { reset(); return 0; }
    if (!__builtin_isfinite((float)l) || !__builtin_isfinite((float)r) || rate < 100) { reset(); return 0; }
    if (lastRate && lastRate != rate) reset(); lastRate = rate;
    if (!started) { cores[current].reset(desired); started = true; }
    history.push(l,r);
    const bool on = gate >= 0.5, hit = recapture >= 0.5;
    if (on && (!lastGate || (hit && !lastCapture) || uiCapture)) requestCapture();
    uiCapture = false; lastGate = on; lastCapture = hit;
    if (!on) captureQueued = false;
    if (!changing) {
      if (captureQueued && history.count >= desired && cores[current].hop == 0) {
        history.copy(requested);
        begin(true);
      } else if (cores[current].size != desired) begin(false);
    }
    const double wetA = cores[current].tick(history,decay,refreshHz,unit(diffusion),unit(spread),rate);
    double wetB = 0;
    if (changing) wetB = cores[1-current].tick(history,decay,refreshHz,unit(diffusion),unit(spread),rate);
    const bool ready = cores[current].valid || (changing && warm == 0 && cores[1-current].valid);
    const double target = on && ready ? 1 : 0, step = 1/(0.02*rate);
    holdBlend += target > holdBlend ? step : target < holdBlend ? -step : 0; holdBlend = unit(holdBlend);
    const double amount = holdBlend*holdBlend*(3-2*holdBlend)*unit(mix);
    const double dryA = history.at(0,cores[current].size), dryAR = history.at(1,cores[current].size);
    double out = dryA + (cores[current].valid ? amount : 0)*(wetA-dryA);
    right = dryAR + (cores[current].valid ? amount : 0)*(cores[current].right-dryAR);
    if (changing) {
      if (warm > 0) --warm;
      else {
        const Core& to = cores[1-current];
        const double dryB = history.at(0,to.size), dryBR = history.at(1,to.size);
        const double b = dryB+(to.valid ? amount : 0)*(wetB-dryB);
        const double br = dryBR+(to.valid ? amount : 0)*(to.right-dryBR);
        const double g = fade*fade*(3-2*fade);
        out += g*(b-out); right += g*(br-right);
        fade += captureBlendMs > 0 ? 1/(captureBlendMs*0.001*rate) : 1;
        if (fade >= 1) { current = 1-current; changing = false; }
      }
    }
    held = on && cores[current].valid ? 1 : 0;
    if (!__builtin_isfinite(out) || !__builtin_isfinite(right)) { reset(); return 0; }
    return out;
  }
};
}
