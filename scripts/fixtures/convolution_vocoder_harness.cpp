#include "../../native_modules/convolution_resonator/vocoder_stft.h"
#include "../../native_modules/convolution_resonator/vocoder_oversampling.h"
namespace {
convolution_resonator::VocoderStft core{};
convolution_resonator::CrunchVocoder crunch{};
convolution_resonator::CrunchVocoder reference{};
convolution_resonator::OversampledVocoder oversampled{};
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
extern "C" void test_reference_reset() { reference.reset(); }
extern "C" double test_reference_tick(double voice, double carrier, double c, double response, double bandwidth, int unity) {
  return reference.tick(voice, 0, carrier, 0, c, response, bandwidth, unity != 0, true);
}
extern "C" void test_os_reset() { oversampled.reset(); }
extern "C" double test_os_tick(double voice, double carrier, double c, double response, double bandwidth, int unity) {
  return oversampled.tick(voice, 0, carrier, 0, c, response, bandwidth, unity != 0);
}
extern "C" double test_os_right() { return oversampled.right; }
extern "C" double test_os_stereo(double voice, double right, double carrier, double c) {
  return oversampled.tick(voice, right, carrier, 0, c, 0, 0);
}
