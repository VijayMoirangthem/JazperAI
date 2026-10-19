"use client";

import { useRef, useMemo, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type ConvState = "idle" | "listening" | "processing" | "thinking" | "speaking" | "error" | "chaining";

interface SphereProps {
  stateRef:     RefObject<ConvState>;
  amplitudeRef: RefObject<number>;
}

// ── Simplex 3D noise (McEwan et al. efficient GLSL implementation) ─────────────
const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314*r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0,i1.z,i2.z,1.0)) +
    i.y + vec4(0.0,i1.y,i2.y,1.0)) +
    i.x + vec4(0.0,i1.x,i2.x,1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0*x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(
    dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(
    dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(
    dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const vertexShader = `
${NOISE_GLSL}
uniform float uTime;
uniform float uAmp;
uniform float uSpeed;
uniform float uFreq;
varying float vDisp;
varying vec3  vNorm;

void main() {
  // Three-octave noise for organic blob feel
  float n1 = snoise(normal * uFreq       + uTime * uSpeed);
  float n2 = snoise(normal * uFreq * 2.1 + uTime * uSpeed * 1.7) * 0.5;
  float n3 = snoise(normal * uFreq * 4.3 + uTime * uSpeed * 2.5) * 0.25;
  float n  = n1 + n2 + n3;

  vDisp = n;
  vNorm = normal;

  vec3 pos = position + normal * n * uAmp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const fragmentShader = `
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
varying float vDisp;
varying vec3  vNorm;

void main() {
  float t   = vDisp * 0.5 + 0.5;
  vec3  col = mix(uC1, uC2, t);
  col       = mix(col, uC3, t * t * 0.6);

  // Rim highlight — bright glow at silhouette edges
  float rim = 1.0 - abs(vNorm.z);
  col += uC2 * pow(rim, 2.5) * 0.55;

  // Specular shimmer from a fixed light
  vec3  lightDir = normalize(vec3(0.5, 0.8, 1.0));
  float spec     = pow(max(dot(normalize(vNorm), lightDir), 0.0), 12.0) * 0.25;
  col  = clamp(col + spec, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

const glowVert = `
varying vec3 vNorm;
void main() {
  vNorm = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const glowFrag = `
uniform vec3 uGlow;
varying vec3 vNorm;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNorm), vec3(0.0, 0.0, 1.0))), 2.2);
  gl_FragColor = vec4(uGlow, rim * 0.4);
}
`;

// ── Per-state config (colors, base amplitude, morph speed/frequency) ──────────
interface StateCfg { c1: string; c2: string; c3: string; amp: number; spd: number; freq: number; }

const STATE_CFG: Record<ConvState, StateCfg> = {
  idle:       { c1:"#0f0e24", c2:"#4f46e5", c3:"#818cf8", amp:0.06,  spd:0.28, freq:1.8 },
  listening:  { c1:"#042f2e", c2:"#0d9488", c3:"#5eead4", amp:0.08,  spd:0.50, freq:2.2 },
  processing: { c1:"#1c0f00", c2:"#d97706", c3:"#fcd34d", amp:0.20,  spd:1.80, freq:2.5 },
  thinking:   { c1:"#100d24", c2:"#7c3aed", c3:"#c084fc", amp:0.24,  spd:3.00, freq:3.1 },
  speaking:   { c1:"#040e1c", c2:"#2563eb", c3:"#93c5fd", amp:0.12,  spd:0.70, freq:2.0 },
  error:      { c1:"#1c0404", c2:"#dc2626", c3:"#fca5a5", amp:0.14,  spd:1.20, freq:2.0 },
  chaining:   { c1:"#1a1000", c2:"#f59e0b", c3:"#fde68a", amp:0.18,  spd:1.40, freq:2.8 },
};

// Precomputed THREE.Color targets — no per-frame string parsing
function buildColorTargets() {
  const out = {} as Record<ConvState, { c1: THREE.Color; c2: THREE.Color; c3: THREE.Color }>;
  for (const [k, v] of Object.entries(STATE_CFG)) {
    out[k as ConvState] = {
      c1: new THREE.Color(v.c1),
      c2: new THREE.Color(v.c2),
      c3: new THREE.Color(v.c3),
    };
  }
  return out;
}

// ── Inner sphere mesh (morph blob) ────────────────────────────────────────────
function SphereMesh({ stateRef, amplitudeRef }: SphereProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  // Stable uniforms — mutated directly inside useFrame, never recreated
  const U = useRef({
    uTime:  { value: 0 },
    uAmp:   { value: 0.06 },
    uSpeed: { value: 0.28 },
    uFreq:  { value: 1.8 },
    uC1:    { value: new THREE.Color("#0f0e24") },
    uC2:    { value: new THREE.Color("#4f46e5") },
    uC3:    { value: new THREE.Color("#818cf8") },
  }).current;

  const G = useRef({ uGlow: { value: new THREE.Color("#4f46e5") } }).current;

  // Precomputed color targets (no allocations per frame)
  const TARGETS = useMemo(buildColorTargets, []);

  useFrame(({ clock }) => {
    const t   = clock.getElapsedTime();
    const st  = stateRef.current ?? "idle";
    const amp = amplitudeRef.current ?? 0;
    const cfg = STATE_CFG[st];
    const tgt = TARGETS[st];

    U.uTime.value  = t;

    const targetAmp = cfg.amp + amp * 0.35;
    U.uAmp.value   = U.uAmp.value   + (targetAmp - U.uAmp.value)   * 0.10;
    U.uSpeed.value = U.uSpeed.value + (cfg.spd   - U.uSpeed.value) * 0.06;
    U.uFreq.value  = U.uFreq.value  + (cfg.freq  - U.uFreq.value)  * 0.06;

    U.uC1.value.lerp(tgt.c1, 0.05);
    U.uC2.value.lerp(tgt.c2, 0.05);
    U.uC3.value.lerp(tgt.c3, 0.05);
    G.uGlow.value.lerp(tgt.c2, 0.05);

    // Gentle breathing scale in idle
    if (meshRef.current) {
      const target = st === "idle" ? 1 + Math.sin(t * 0.55) * 0.013 : 1;
      const cur    = meshRef.current.scale.x;
      meshRef.current.scale.setScalar(cur + (target - cur) * 0.08);
    }
  });

  return (
    <group>
      {/* Outer glow halo — rendered from inside (BackSide) for Fresnel effect */}
      <mesh>
        <sphereGeometry args={[1.75, 32, 32]} />
        <shaderMaterial
          vertexShader={glowVert}
          fragmentShader={glowFrag}
          uniforms={G}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Morphing blob */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[1.5, 64, 64]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={U}
        />
      </mesh>
    </group>
  );
}

// ── Canvas wrapper (exported for dynamic import in VoiceModePanel) ─────────────
export function VoiceCanvas({ stateRef, amplitudeRef }: SphereProps) {
  return (
    <Canvas
      camera={{ fov: 60, position: [0, 0, 5] }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.1} />
      <SphereMesh stateRef={stateRef} amplitudeRef={amplitudeRef} />
    </Canvas>
  );
}
