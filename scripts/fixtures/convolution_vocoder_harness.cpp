#include "../../native_modules/convolution_resonator/vocoder_stft.h"
namespace {
convolution_resonator::VocoderStft core{};
float re[512], im[512];
}
extern "C" void test_reset() { core.reset(); }
extern "C" double test_tick(double left, double right, double carrier, double shift, int unity) {
  return core.tick(left, right, carrier, shift, unity != 0);
}
extern "C" double test_right() { return core.right; }
extern "C" float* test_re() { return re; }
extern "C" float* test_im() { return im; }
extern "C" void test_fft(int inverse) { convolution_resonator::fft.transform(re, im, inverse != 0); }
