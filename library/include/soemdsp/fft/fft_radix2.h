#pragma once
#include <soemdsp/soemdsp.hpp>

namespace soemdsp::fft {
// Radix-2 butterfly from Noise Convolution Reverb, with size-owned twiddles.
// Forward is unnormalized; inverse includes 1/N. N must be a power of two.
template<int N> struct Radix2 {
  static_assert(N >= 2 && (N & (N - 1)) == 0, "FFT size must be a power of two");
  float twRe[N / 2], twIm[N / 2];
  bool ready;
  void ensure() {
    if (ready) return;
    for (int k = 0; k < N / 2; ++k) {
      double sine, cosine;
      soemdsp_maths::dsp_sin_cos_turns(-(double)k / N, &sine, &cosine);
      twRe[k] = (float)cosine; twIm[k] = (float)sine;
    }
    ready = true;
  }
  void transform(float* re, float* im, bool inverse) {
    ensure();
    int j = 0;
    for (int i = 1; i < N; ++i) {
      int bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const float r = re[i], m = im[i];
        re[i] = re[j]; im[i] = im[j]; re[j] = r; im[j] = m;
      }
    }
    for (int len = 2; len <= N; len <<= 1) {
      const int half = len >> 1, step = N / len;
      for (int base = 0; base < N; base += len) {
        for (int k = 0; k < half; ++k) {
          const float wr = twRe[k * step], wi = inverse ? -twIm[k * step] : twIm[k * step];
          const int a = base + k, b = a + half;
          const float r = wr * re[b] - wi * im[b], m = wr * im[b] + wi * re[b];
          re[b] = re[a] - r; im[b] = im[a] - m;
          re[a] += r; im[a] += m;
        }
      }
    }
    if (inverse) for (int i = 0; i < N; ++i) { re[i] /= N; im[i] /= N; }
  }
};
}
