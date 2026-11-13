// The glass ball, as one full-screen triangle and a fragment shader.
//
// Ported from the mascot lab with two changes for speed and simplicity:
// - The lab ray-marched a rounded box (up to 96 steps plus 4 more samples for
//   the normal) because the ball could stretch into the "error" bar. Only the
//   ball is left, so the ray meets an ellipsoid, solved exactly: one square root.
// - The lab drew "?" from a font texture. Here it is a distance shape, so there
//   are no textures and nothing to load.
//
// The view is orthographic: the ball reads as a flat element, like the logo.
// Output is premultiplied alpha.

export const VERT = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0., 1.); }`;

export const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime, uPhase, uView, uPx, uTheme, uDim, uTint;
uniform vec3 uPos, uScale;
uniform mat3 uRot;
uniform vec4 uEye0, uEye1;      // x, y, size, open
uniform int uKindL, uKindR;     // 0 dot, 1 ?, 2 arc, 3 cross
out vec4 o;

const float PLANE_Z = .3;       // the eyes sit on a plane inside the glass

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<4;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }
vec3 spec(float w){ return clamp(vec3(1.5-abs(w*3.-.3)*1.5, 1.3-abs(w*3.-1.45)*1.3, 1.5-abs(w*3.-2.7)*1.5), 0., 1.); }

// the liquid inside: the logo's flowing lime bands
vec3 liquid(vec2 uv, float depth){
  float t = uPhase;
  float w = fbm(uv*.45 + vec2(t*.05, -t*.035));
  float f = .5 + .5*sin(uv.x*1.5 + uv.y*.8 + w*3.2 + t*.45);
  vec3 c0=vec3(.20,.42,.03), c1=vec3(.55,.80,.10), c2=vec3(.784,.941,.235), c3=vec3(.94,.99,.74);
  float x = clamp(mix(.5, .9, f)*.85 + .1 - depth*.12, 0., 1.);
  vec3 c = x<.33 ? mix(c0,c1,x/.33) : x<.7 ? mix(c1,c2,(x-.33)/.37) : mix(c2,c3,(x-.7)/.3);
  return c * (1. - uDim*.55);
}

// ---- the eyes ----
// a stadium: a rounded box whose short sides are full half-circles
float sdStadium(vec2 q, vec2 h){ float r = min(h.x, h.y); vec2 d = abs(q) - h + r; return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r; }
// a closed eye: a short line with round ends
float closedD(vec2 q, float s){ return sdStadium(q, vec2(s*1.1, s*.22)); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; return length(pa - ba*clamp(dot(pa,ba)/dot(ba,ba), 0., 1.)); }
// "?" in a [-1,1] box: a hook (an arc from the bottom, round the right, over the top), a stem and a dot
float sdQuestion(vec2 p){
  vec2 c = vec2(0., .38); float r = .36, w = .12;
  vec2 d = p - c; float ang = atan(d.y, d.x);
  float a0 = -1.5708, a1 = 2.8;
  float arc = (ang > a0 && ang < a1) ? abs(length(d) - r)
            : min(length(d - r*vec2(cos(a0), sin(a0))), length(d - r*vec2(cos(a1), sin(a1))));
  float stem = sdSeg(p, vec2(0., c.y - r), vec2(0., -.25));
  float dot_ = length(p - vec2(0., -.62)) - .14;
  return min(min(arc, stem) - w, dot_);
}
float eye(vec2 uv, vec4 e, int kind, float aa){
  vec2 q = uv - e.xy; float s = e.z; float k = clamp(e.w, 0., 1.);
  if (kind == 0) {   // a dot that closes into the line: round at the ends, never a squashed oval
    float d = sdStadium(q, vec2(mix(s*1.1, s, k), mix(s*.22, s, k))); return smoothstep(aa, -aa, d); }
  if (kind == 1) {
    // the closed line splits into two lids that part up and down and thin out; the ? shows between them
    float kk = smoothstep(0., 1., k), h = s*2.3;
    float yo = kk*h*.98, th = s*.22*(1. - kk), hw = s*1.1*(1. - kk*.25);
    float lids = 0.;
    if (th > .0015) lids = smoothstep(aa, -aa, min(sdStadium(q - vec2(0., yo), vec2(hw, th)), sdStadium(q + vec2(0., yo), vec2(hw, th))))
                         * (1. - smoothstep(.75, .98, kk));
    float g = smoothstep(aa, -aa, sdQuestion(q/h)*h) * smoothstep(aa, -aa, abs(q.y) - yo);
    return max(lids, g);
  }
  float shape;
  if (kind == 2) {   // the closed line, bent up into a gentle arc with the same round ends
    float ra = s*1.55, ha = .72; vec2 sc = vec2(sin(ha), cos(ha));
    vec2 p = q - vec2(0., -ra + s*.32); p.x = abs(p.x);
    shape = (sc.y*p.x > sc.x*p.y ? length(p - sc*ra) : abs(length(p) - ra)) - s*.22; }
  else {             // 3: a cross
    vec2 a = vec2(q.x + q.y, q.x - q.y)*.7071;
    shape = min(length(vec2(max(abs(a.x) - s*.95, 0.), a.y)), length(vec2(max(abs(a.y) - s*.95, 0.), a.x))) - s*.24; }
  // arcs and crosses grow out of the closed line, and fold back into it
  float d = mix(closedD(q, s), shape, smoothstep(.1, .85, k));
  return smoothstep(aa, -aa, d);
}
float ink(vec2 uv, float aa){
  // as the face turns away from us, the eyes fade round the back
  float face = smoothstep(.12, .5, uRot[2].z);
  return max(eye(uv, uEye0, uKindL, aa), eye(uv, uEye1, uKindR, aa)) * face;
}

// the studio the glass reflects
vec3 env(vec3 d){
  vec3 L1 = normalize(vec3(-.55, .7, .55)), L2 = normalize(vec3(.75, .15, .55)), L3 = normalize(vec3(.1, -.9, .3));
  float sky = smoothstep(-.3, .8, d.y);
  vec3 base = uTheme < .5 ? mix(vec3(.62,.64,.6), vec3(.98), sky) : mix(vec3(.015), vec3(.05), sky);
  float box1 = smoothstep(.86, .97, dot(d, L1));   // a big softbox up left
  float box2 = smoothstep(.93, .985, dot(d, L2));  // a strip on the right
  float bounce = smoothstep(.6, 1., dot(d, L3))*.35;
  return base + vec3(1.)*box1*1.4 + vec3(1.)*box2*.7 + vec3(.6,.85,.2)*bounce;
}

// po: the point on the unit sphere (object space); rd: the view ray (world)
vec3 shade(vec3 po, vec3 rd){
  // the ellipsoid's normal: the sphere's, through the inverse transpose of R·S
  vec3 n = normalize(uRot*(po/uScale));
  float cv = clamp(dot(n, -rd), 0., 1.);
  float F = .04 + .96*pow(1. - cv, 5.);
  float aa = uPx*1.1;
  // the view through the glass: each colour bends a little differently, so the ink fringes in colour
  vec3 col = vec3(0.); float depth = 0.; vec2 uvG = po.xy;
  float etas[3] = float[3](1./1.42, 1./1.47, 1./1.53);
  for (int c = 0; c < 3; c++) {
    vec3 rr = refract(rd, n, etas[c]);
    vec3 rdo = normalize((transpose(uRot)*rr)/uScale);
    // a soft limit instead of a cut-off, so a turned ball shows no seam
    float tp = max((PLANE_Z - po.z)/min(rdo.z, -.35), 0.);
    vec2 q = po.xy + rdo.xy*tp;
    if (c == 1) { uvG = q; depth = clamp(tp/2., 0., 1.); }
    col[c] = ink(q, aa);
  }
  vec3 liq = liquid(uvG, depth);
  vec3 inkc = vec3(.035,.04,.035);
  vec3 body = vec3(mix(liq.r, inkc.r, col.r), mix(liq.g, inkc.g, col.g), mix(liq.b, inkc.b, col.b));
  // glass: reflections of the studio, a spectral rim, the hot spot
  vec3 rf = reflect(rd, n);
  vec3 c = mix(body, env(rf), F*.9);
  float rim = smoothstep(.42, .05, cv);
  float ang = atan(n.y, n.x);
  c = mix(c, mix(vec3(1.), spec(.5+.5*sin(ang*1.2 + 2.)), .55), rim*.28);
  c = mix(c, vec3(1., .35, .28), uTint*smoothstep(.55, .08, cv)*.55);   // error: the edge glows red
  c += vec3(1.)*pow(max(dot(rf, normalize(vec3(-.5,.62,.6))), 0.), 120.)*.9;
  if (uTheme < .5) c *= 1. - .12*smoothstep(.25, 0., cv);                // a darker lip on a light page
  c *= 1. - uDim*.25;
  return c;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - .5*uRes)/uRes.y;
  vec3 ro = vec3(uv*2.*uView, 9.);
  vec3 rd = vec3(0., 0., -1.);

  // into object space, where the ball is the unit sphere
  mat3 Rt = transpose(uRot);
  vec3 oo = (Rt*(ro - uPos))/uScale;
  vec3 od = (Rt*rd)/uScale;
  float A = dot(od, od), B = dot(oo, od);
  float tc = -B/A;                              // where the ray passes closest to the centre
  vec3 pc = oo + od*tc;
  float miss = length(pc) - 1.;                 // > 0: the ray misses, by this much (object units)
  float smin = min(uScale.x, min(uScale.y, uScale.z));
  // coverage from the distance to the edge in pixels: a smooth, one-pixel edge
  float cover = clamp(.5 - miss*smin/uPx, 0., 1.);
  if (cover <= 0.) { o = vec4(0.); return; }
  vec3 po;
  if (miss < 0.) po = oo + od*(tc - sqrt(-miss*(2. + miss)/A));   // the near hit: |pc|^2 + A·dt^2 = 1
  else po = pc/length(pc);                                        // just outside: shade the rim point
  vec3 c = shade(po, rd);
  vec3 dith = vec3((hash(fc + fract(uTime)) - .5)/255.);
  o = vec4((c + dith)*cover, cover);
}`;
