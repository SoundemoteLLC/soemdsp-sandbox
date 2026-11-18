#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>

namespace soemdsp_room_ir {
constexpr int hop = 256, fftSize = 512, bins = 257, parts = 256, capacity = hop*parts;
inline soemdsp::fft::Radix2<fftSize> fft{};
inline double bounded(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }
struct Settings {
  double width=4, depth=5, height=2.5, sx=.3, sy=.3, sz=.5, lx=.6, ly=.7, lz=.5;
  double absorption=.6, damping=12000, ears=.18, rate=48000;
  int order=3;
  bool same(const Settings& b) const {
    return width==b.width && depth==b.depth && height==b.height && sx==b.sx && sy==b.sy && sz==b.sz
      && lx==b.lx && ly==b.ly && lz==b.lz && absorption==b.absorption && damping==b.damping
      && ears==b.ears && rate==b.rate && order==b.order;
  }
};
struct Complex { float r, i; };
struct Path { int delay, length; double fraction, gain, pole; };
struct Kernel {
  float ir[2][capacity];
  Complex spectrum[2][parts][bins];
  int length, count;
};
struct State {
  Kernel kernels[2];
  Complex history[parts][bins];
  float previous[hop], input[hop], dry[2][hop], output[2][2][hop], re[fftSize], im[fftSize];
  Path paths[2][128];
  Settings requested, building, applied;
  int active, position, head, histories, stage, clearIndex, pathIndex, pathSample, pathCount, partition;
  double pathPower[2], fade, right, ready, error;
  bool valid, transitioning, badConfig;
  void reset() {
    applied=Settings{};
    active=position=head=histories=stage=clearIndex=pathIndex=pathSample=pathCount=partition=0;
    fade=right=ready=error=0; valid=transitioning=badConfig=false;
    for (int i=0;i<hop;++i) {
      previous[i]=input[i]=dry[0][i]=dry[1][i]=0;
      for (auto& bank:output) bank[0][i]=bank[1][i]=0;
    }
    // Histories outside this count are never read; kernel storage is cleared incrementally.
    kernels[0].count=kernels[1].count=0;
  }
  void initialize() { fft.ensure(); requested=Settings{}; reset(); }
  static int absolute(int v) { return v<0 ? -v : v; }
  static double image(int cell,double length,double source) {
    return cell*length+(cell%2 ? length-source : source);
  }
  bool begin() {
    building=requested; pathCount=0;
    Kernel& k=kernels[1-active]; k.length=1; k.count=0;
    const double dim[]={building.width,building.depth,building.height};
    const double source[]={building.sx*dim[0],building.sy*dim[1],building.sz*dim[2]};
    const double listener[]={building.lx*dim[0],building.ly*dim[1],building.lz*dim[2]};
    const double reflect=__builtin_sqrt(1-building.absorption);
    for (int x=-building.order;x<=building.order;++x)
    for (int y=-building.order;y<=building.order;++y)
    for (int z=-building.order;z<=building.order;++z) {
      const int n=absolute(x)+absolute(y)+absolute(z);
      if (!n || n>building.order) continue;
      double gain=1; for (int j=0;j<n;++j) gain*=reflect;
      for (int ear=0;ear<2;++ear) {
        const double ex=bounded(listener[0]+(ear ? .5 : -.5)*building.ears,.001,dim[0]-.001);
        const double dx=image(x,dim[0],source[0])-ex;
        const double dy=image(y,dim[1],source[1])-listener[1];
        const double dz=image(z,dim[2],source[2])-listener[2];
        const double distance=__builtin_sqrt(dx*dx+dy*dy+dz*dz);
        const double delay=distance*building.rate/343.0;
        const double exponent=6.283185307179586*building.damping/(building.rate*n);
        const double pole=soemdsp_maths::dsp_exp(-exponent);
        const double tail=11.51292546497023/exponent+1;
        if (!__builtin_isfinite(delay+tail) || delay+tail+2>=capacity || pathCount>=128) { stage=0; error=1; applied=building; return false; }
        const int length=(int)tail;
        paths[ear][pathCount]={(int)delay,length,delay-(int)delay,gain/(distance>.001 ? distance : .001),pole};
        const int end=(int)delay+length+2; if (end>k.length) k.length=end;
      }
      ++pathCount;
    }
    stage=1; clearIndex=pathIndex=pathSample=partition=0; pathPower[0]=pathPower[1]=1; error=0;
    return true;
  }
  void buildStep() {
    Kernel& k=kernels[1-active];
    if (!stage) {
      if (!transitioning && ((!valid && !error) || !requested.same(applied))) begin();
      return;
    }
    if (stage==1) {
      const int end=clearIndex+4096<capacity ? clearIndex+4096 : capacity;
      for (int i=clearIndex;i<end;++i) k.ir[0][i]=k.ir[1][i]=0;
      clearIndex=end; if (end==capacity) stage=2;
      return;
    }
    if (stage==2) {
      for (int work=0;work<1024 && pathIndex<pathCount;++work) {
        bool more=false;
        for (int ear=0;ear<2;++ear) {
          const Path& p=paths[ear][pathIndex];
          if (pathSample>=p.length) continue;
          const double value=p.gain*(1-p.pole)*pathPower[ear];
          k.ir[ear][p.delay+pathSample]+=(float)(value*(1-p.fraction));
          k.ir[ear][p.delay+pathSample+1]+=(float)(value*p.fraction);
          pathPower[ear]*=p.pole; if (pathSample+1<p.length) more=true;
        }
        if (more) ++pathSample;
        else { ++pathIndex; pathSample=0; pathPower[0]=pathPower[1]=1; }
      }
      if (pathIndex==pathCount) { stage=3; k.count=(k.length+hop-1)/hop; }
      return;
    }
    // One stereo partition per block bounds kernel preparation work.
    for (int ear=0;ear<2;++ear) {
      for (int i=0;i<fftSize;++i) { re[i]=i<hop ? k.ir[ear][partition*hop+i] : 0; im[i]=0; }
      fft.transform(re,im,false);
      for (int b=0;b<bins;++b) k.spectrum[ear][partition][b]={re[b],im[b]};
    }
    if (++partition==k.count) {
      stage=0; applied=building;
      if (!valid) { active=1-active; valid=true; }
      else { transitioning=true; fade=0; }
    }
  }
  void convolve(int bank) {
    const Kernel& k=kernels[bank];
    const int count=k.count<histories ? k.count : histories;
    for (int ear=0;ear<2;++ear) {
      for (int b=0;b<bins;++b) {
        double r=0,i=0;
        for (int p=0;p<count;++p) {
          const Complex a=history[(head-p+parts)%parts][b], h=k.spectrum[ear][p][b];
          r+=(double)a.r*h.r-(double)a.i*h.i; i+=(double)a.r*h.i+(double)a.i*h.r;
        }
        re[b]=(float)r; im[b]=(float)i;
        if (b>0 && b<bins-1) { re[fftSize-b]=(float)r; im[fftSize-b]=(float)-i; }
      }
      fft.transform(re,im,true);
      for (int i=0;i<hop;++i) output[bank][ear][i]=re[i+hop];
    }
  }
  void block() {
    buildStep();
    for (int i=0;i<fftSize;++i) { re[i]=i<hop ? previous[i] : input[i-hop]; im[i]=0; }
    fft.transform(re,im,false); head=(head+1)%parts; if (histories<parts) ++histories;
    for (int b=0;b<bins;++b) history[head][b]={re[b],im[b]};
    for (int i=0;i<hop;++i) previous[i]=input[i];
    if (valid) convolve(active);
    if (transitioning) convolve(1-active);
  }
  double tick(double l,double r,double mix) {
    if (!__builtin_isfinite(l) || !__builtin_isfinite(r) || !__builtin_isfinite(mix)
        || !__builtin_isfinite((float)l) || !__builtin_isfinite((float)r)) { reset(); return 0; }
    const double g=fade*fade*(3-2*fade);
    double wet[2]={0,0};
    for (int ear=0;ear<2;++ear) {
      wet[ear]=valid ? output[active][ear][position] : 0;
      if (transitioning) wet[ear]+=g*(output[1-active][ear][position]-wet[ear]);
    }
    mix=bounded(mix,0,1);
    const double out=dry[0][position]*(1-mix)+wet[0]*mix;
    right=dry[1][position]*(1-mix)+wet[1]*mix;
    dry[0][position]=(float)l; dry[1][position]=(float)r; input[position]=(float)((l+r)*.5);
    if (transitioning) {
      fade+=1/(.05*requested.rate);
      if (fade>=1) { active=1-active; transitioning=false; }
    }
    if (++position==hop) { position=0; block(); }
    ready=valid ? 1 : 0;
    if (!__builtin_isfinite(out) || !__builtin_isfinite(right)) { reset(); return 0; }
    return out;
  }
};
}
