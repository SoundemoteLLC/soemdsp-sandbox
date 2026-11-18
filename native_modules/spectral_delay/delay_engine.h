#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/atan2.h>
#include <soemdsp/math/segment_curves.h>

namespace soemdsp_spectral_delay {
constexpr int maximum=16384, storage=1048576;
constexpr double pi=3.14159265358979323846;
inline soemdsp::fft::Radix2<512> f512{};
inline soemdsp::fft::Radix2<1024> f1024{};
inline soemdsp::fft::Radix2<2048> f2048{};
inline soemdsp::fft::Radix2<4096> f4096{};
inline soemdsp::fft::Radix2<8192> f8192{};
inline soemdsp::fft::Radix2<16384> f16384{};
inline bool validSize(int n) { return n==512 || n==1024 || n==2048 || n==4096 || n==8192 || n==16384; }
inline void prepare() { f512.ensure(); f1024.ensure(); f2048.ensure(); f4096.ensure(); f8192.ensure(); f16384.ensure(); }
inline void transform(int n,float* r,float* i,bool inverse) {
  switch(n) {
    case 512: f512.transform(r,i,inverse); break;
    case 1024: f1024.transform(r,i,inverse); break;
    case 2048: f2048.transform(r,i,inverse); break;
    case 4096: f4096.transform(r,i,inverse); break;
    case 8192: f8192.transform(r,i,inverse); break;
    default: f16384.transform(r,i,inverse); break;
  }
}
struct Complex { float r,i; };
inline int frameCapacity(int size) { return storage/(size/2+1); }
inline double maxDelayMs(int size,double rate) { return (frameCapacity(size)-2)*(size/4)*1000.0/rate; }
struct Settings { double base=120,spread=180,pivot=1000,curve=0,feedback=.35,rate=48000; };
struct Core {
  Complex history[2][storage];
  float input[2][maximum],ola[2][maximum],window[maximum],re[maximum],im[maximum];
  double delays[maximum/2+1];
  int size,position,hop,cursor,written,samples;
  bool fault;
  double right;
  void reset(int n) {
    size=n; position=hop=cursor=written=samples=0; right=0; fault=false;
    for(int j=0;j<maximum;++j) {
      input[0][j]=input[1][j]=ola[0][j]=ola[1][j]=0;
      const int index=j<n ? (j<n/2 ? j:n-j)*(maximum/n):0;
      window[j]=j>=n ? 0 : j==n/2 ? 1 : .5f-.5f*f16384.twRe[index];
    }
    for(int k=0;k<=maximum/2;++k) delays[k]=0;
    // A valid-frame count makes old spectral storage unreachable without a large callback-time clear.
  }
  Complex past(int channel,int bin,int age,Complex current) const {
    if(age==0) return current;
    if(age>written) return {0,0};
    const int frames=frameCapacity(size),count=size/2+1;
    return history[channel][((cursor-age+frames)%frames)*count+bin];
  }
  Complex read(int channel,int bin,double delay,Complex current) const {
    const int age=(int)delay; const double fraction=delay-age;
    const Complex a=past(channel,bin,age,current);
    if(fraction<1e-10) return a;
    const Complex b=past(channel,bin,age+1,current);
    const double powerA=(double)a.r*a.r+(double)a.i*a.i, powerB=(double)b.r*b.r+(double)b.i*b.i;
    const int q=bin%4; const double br=q==0?1:q==2?-1:0, bi=q==1?1:q==3?-1:0;
    double residual=0;
    if(powerA>1e-24 && powerB>1e-24) {
      const double r=(double)a.r*b.r+(double)a.i*b.i, i=(double)a.i*b.r-(double)a.r*b.i;
      residual=soemdsp::math::atan2_approx(i*br-r*bi,r*br+i*bi);
    }
    const double angle=bin*pi*.5+residual;
    double sn,cs; soemdsp_maths::dsp_sin_cos(residual,&sn,&cs);
    const double vr=br*cs-bi*sn, vi=br*sn+bi*cs;
    const double r=(1-fraction)*a.r+fraction*(b.r*vr-b.i*vi);
    const double i=(1-fraction)*a.i+fraction*(b.r*vi+b.i*vr);
    soemdsp_maths::dsp_sin_cos(-fraction*angle,&sn,&cs);
    return {(float)(r*cs-i*sn),(float)(r*sn+i*cs)};
  }
  bool frame(const Settings& s) {
    const int count=size/2+1,step=size/4,frames=frameCapacity(size);
    const double nyquist=s.rate*.5;
    for(int k=0;k<count;++k) {
      const double hz=(double)k*s.rate/size;
      const double u=hz==0 ? 0 : hz*(nyquist-s.pivot)/(hz*(nyquist-2*s.pivot)+nyquist*s.pivot);
      const double shape=soemdsp::math::segment_rational01(u,s.curve);
      const double amount=s.spread<0 ? 1-shape:shape;
      const double spread=s.spread<0 ? -s.spread:s.spread;
      delays[k]=(s.base+spread*amount)*.001*s.rate/step;
    }
    for(int c=0;c<2;++c) {
      for(int j=0;j<size;++j) { re[j]=input[c][(position+1+j)%size]*window[j]; im[j]=0; }
      transform(size,re,im,false);
      for(int k=0;k<count;++k) {
        const double delay=delays[k];
        const Complex old=read(c,k,delay>=1 ? delay:1,{0,0});
        const Complex current={(float)(re[k]+s.feedback*old.r),(float)(im[k]+s.feedback*old.i)};
        if(!__builtin_isfinite(current.r) || !__builtin_isfinite(current.i)) return false;
        const Complex wet=delay>=1 ? old:read(c,k,delay,current);
        history[c][cursor*count+k]=current;
        re[k]=wet.r; im[k]=(k==0 || k==count-1) ? 0:wet.i;
        if(k>0 && k<count-1) { re[size-k]=re[k]; im[size-k]=-im[k]; }
      }
      transform(size,re,im,true);
      for(int j=0;j<size;++j) ola[c][(position+1+j)%size]+=re[j]*window[j]*(2.0f/3);
    }
    cursor=(cursor+1)%frames; if(written<frames-1) ++written;
    return true;
  }
  double tick(double l,double r,const Settings& s) {
    const double out=ola[0][position]; right=ola[1][position]; ola[0][position]=ola[1][position]=0;
    input[0][position]=(float)l; input[1][position]=(float)r;
    if(++hop==size/4) { hop=0; if(!frame(s)) { reset(size); fault=true; return 0; } }
    if(samples<1000000000) ++samples;
    position=(position+1)%size; return out;
  }
};
struct State {
  Core cores[2]; Settings settings;
  float dry[2][maximum+1];
  int dryPosition,current,desired,warm;
  bool changing;
  double fade,right,error;
  void reset() {
    for(auto& c:cores) c.reset(desired);
    for(auto& c:dry) for(auto& v:c) v=0;
    dryPosition=current=warm=0; changing=false; fade=right=error=0;
  }
  void initialize() { prepare(); settings=Settings{}; desired=4096; reset(); }
  double dryAt(int channel,int delay) const { return dry[channel][(dryPosition+maximum+1-delay)%(maximum+1)]; }
  double tick(double l,double r,double mix) {
    if(!__builtin_isfinite(l) || !__builtin_isfinite(r) || !__builtin_isfinite(mix)
      || !__builtin_isfinite((float)l) || !__builtin_isfinite((float)r)) { reset(); error=1; return 0; }
    if(!changing && cores[current].size!=desired) {
      cores[1-current].reset(desired); changing=true; fade=0;
      const double spread=settings.spread<0 ? -settings.spread:settings.spread;
      warm=desired+(int)((settings.base+spread)*.001*settings.rate);
    }
    const double a=cores[current].tick(l,r,settings);
    double b=0;
    if(changing) {
      b=cores[1-current].tick(l,r,settings);
      const double spread=settings.spread<0 ? -settings.spread:settings.spread;
      const int needed=cores[1-current].size+(int)((settings.base+spread)*.001*settings.rate)-cores[1-current].samples;
      warm=needed>0 ? needed:0;
    }
    if(cores[current].fault || (changing && cores[1-current].fault)) error=1;
    mix=soemdsp::math::clamp01(mix);
    const double da=dryAt(0,cores[current].size),dar=dryAt(1,cores[current].size);
    double out=da+mix*(a-da); right=dar+mix*(cores[current].right-dar);
    if(changing) {
      if(warm>0) --warm;
      else {
        const double db=dryAt(0,cores[1-current].size),dbr=dryAt(1,cores[1-current].size);
        const double next=db+mix*(b-db),nextr=dbr+mix*(cores[1-current].right-dbr),g=fade*fade*(3-2*fade);
        out+=g*(next-out); right+=g*(nextr-right);
        fade+=1/(.05*settings.rate); if(fade>=1) {current=1-current;changing=false;}
      }
    }
    dry[0][dryPosition]=(float)l; dry[1][dryPosition]=(float)r; dryPosition=(dryPosition+1)%(maximum+1);
    if(!__builtin_isfinite(out) || !__builtin_isfinite(right)) { reset(); error=1; return 0; }
    return out;
  }
};
}
