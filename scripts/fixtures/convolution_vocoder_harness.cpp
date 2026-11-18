#include "../../native_modules/convolution_resonator/vocoder_stft.h"
namespace {
convolution_resonator::VocoderStft core{};
convolution_resonator::CrunchVocoder crunch{};
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
extern "C" void test_crunch_reset() { crunch.reset(); }
extern "C" double test_crunch_tick(double voice, double carrier, double c, double response, double bandwidth, int unity) {
  return crunch.tick(voice, 0, carrier, 0, c, response, bandwidth, unity != 0);
}
extern "C" float* test_envelope() { return core.envelope; }
extern "C" void test_smooth(double bandwidth) { core.smooth(bandwidth); }
