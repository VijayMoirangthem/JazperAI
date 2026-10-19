"use client";

import { Component, type ReactNode, useRef, useMemo, useCallback, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentLive, DeptLive } from "@/stores/agentStore";

// ── 3D floor plan layout ──────────────────────────────────────────────────────

interface RoomLayout { x: number; z: number; w: number; d: number }

const ROOM: Record<string, RoomLayout> = {
  // Executive suite — full-width top row
  executive:      { x: 0,   z: -12,  w: 30, d: 4.5 },
  // Row 1 — 5 depts, 6-unit x spacing (2-unit gap between rooms)
  intelligence:   { x: -12, z: -5,   w: 4,  d: 4.5 },
  communications: { x: -6,  z: -5,   w: 4,  d: 4.5 },
  operations:     { x: 0,   z: -5,   w: 4,  d: 4.5 },
  it:             { x: 6,   z: -5,   w: 4,  d: 4.5 },
  security:       { x: 12,  z: -5,   w: 4,  d: 4.5 },
  // Row 2 — 5 depts
  analytics:      { x: -12, z: 2,    w: 4,  d: 4.5 },
  research:       { x: -6,  z: 2,    w: 4,  d: 4.5 },
  relations:      { x: 0,   z: 2,    w: 4,  d: 4.5 },
  creative:       { x: 6,   z: 2,    w: 4,  d: 4.5 },
  personal:       { x: 12,  z: 2,    w: 4,  d: 4.5 },
  // Row 3 — 4 depts, centred
  marketing:      { x: -9,  z: 9,    w: 4,  d: 4.5 },
  sales:          { x: -3,  z: 9,    w: 4,  d: 4.5 },
  finance:        { x: 3,   z: 9,    w: 4,  d: 4.5 },
  hr:             { x: 9,   z: 9,    w: 4,  d: 4.5 },
};

// ── Agent slot positions inside a room ────────────────────────────────────────

function agentSlots(count: number, w: number, d: number): [number, number, number][] {
  const slots: [number, number, number][] = [];
  if (count === 0) return slots;
  const cols = Math.min(count, Math.max(1, Math.floor((w - 0.6) / 1.15)));
  const rows = Math.ceil(count / cols);
  const sx = Math.min(1.2, (w - 0.8) / Math.max(cols - 1, 1));
  const sz = Math.min(1.2, (d - 0.8) / Math.max(rows - 1, 1));
  let i = 0;
  for (let r = 0; r < rows && i < count; r++) {
    for (let c = 0; c < cols && i < count; c++) {
      slots.push([
        (c - (cols - 1) / 2) * sx,
        0.12,
        (r - (rows - 1) / 2) * sz,
      ]);
      i++;
    }
  }
  return slots;
}

// ── Room edge glow lines ──────────────────────────────────────────────────────

function RoomEdges({ w, d, color, bright }: { w: number; d: number; color: string; bright: boolean }) {
  const geo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.22, d)),
    [w, d]
  );
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} transparent opacity={bright ? 1 : 0.28} />
    </lineSegments>
  );
}

// ── Translucent glass walls ───────────────────────────────────────────────────

function GlassWalls({ w, d, color, opacity }: { w: number; d: number; color: string; opacity: number }) {
  return (
    <>
      <mesh position={[0, 0.86, d / 2]}>
        <boxGeometry args={[w, 1.5, 0.03]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.86, -d / 2]}>
        <boxGeometry args={[w, 1.5, 0.03]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <mesh position={[-w / 2, 0.86, 0]}>
        <boxGeometry args={[0.03, 1.5, d]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <mesh position={[w / 2, 0.86, 0]}>
        <boxGeometry args={[0.03, 1.5, d]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
    </>
  );
}

// ── Canvas sprite labels — replaces Html overlays (major perf win) ────────────

const LABEL_W = 280;
const LABEL_H = 60;

function createAgentLabel(
  codename: string,
  emoji:    string,
  color:    string,
  isHead:   boolean,
  isActive: boolean,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width  = LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const mid = LABEL_H / 2;

  // Emoji (left side)
  ctx.font         = `${LABEL_H * 0.58}px serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(emoji || "🤖", 4, mid + 2);

  let textX = LABEL_H * 0.74;

  // Crown star for head
  if (isHead) {
    ctx.font       = `bold ${LABEL_H * 0.34}px monospace`;
    ctx.fillStyle  = "#f59e0b";
    ctx.shadowColor = "#f59e0b";
    ctx.shadowBlur  = 8;
    ctx.fillText("★", textX, mid);
    textX += LABEL_H * 0.38;
    ctx.shadowBlur = 0;
  }

  // Codename
  ctx.font         = `${isHead ? "bold " : ""}${isHead ? LABEL_H * 0.31 : LABEL_H * 0.29}px monospace`;
  ctx.fillStyle    = isActive ? color : "#303050";
  ctx.shadowColor  = isActive ? color : "transparent";
  ctx.shadowBlur   = isActive ? (isHead ? 12 : 8) : 0;
  ctx.textBaseline = "middle";
  ctx.fillText(codename.toUpperCase(), textX, mid);
  ctx.shadowBlur   = 0;

  return new THREE.CanvasTexture(canvas);
}

// ── Agent humanoid figure ─────────────────────────────────────────────────────

const SKIN  = "#c4a882";
const DARK  = "#12121e";
const CHAIR = "#18182a";

function AgentHumanoid({ agent, pos, phase, isHead = false }: {
  agent:   AgentLive;
  pos:     [number, number, number];
  phase:   number;
  isHead?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef  = useRef<THREE.Mesh>(null);
  const torsoRef = useRef<THREE.Mesh>(null);

  const isActive   = agent.status === "active";
  const isWorking  = agent.runtime_status === "working";
  const isThinking = agent.runtime_status === "thinking";
  const isError    = agent.runtime_status === "error";
  const isSelected = useAgentStore(s => s.selectedAgentId === agent.agent_id);
  const setSelectedAgent = useAgentStore(s => s.setSelectedAgent);
  const setContextMenu   = useAgentStore(s => s.setContextMenu);

  const color   = agent.badge_color || "#6366f1";
  const opacity = isActive ? 1 : 0.32;

  const dotColor = isError ? "#ef4444" : isWorking ? "#22c55e" : isThinking ? "#f59e0b" : "#1e2845";
  const dotGlow  = isError ? 2.5 : isWorking ? 2.2 : isThinking ? 1.6 : 0;

  // Canvas sprite label — zero DOM overhead vs <Html>
  const labelTexture = useMemo(
    () => createAgentLabel(agent.codename, agent.avatar_emoji, color, isHead, isActive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent.codename, agent.avatar_emoji, color, isHead, isActive]
  );
  useEffect(() => () => { labelTexture.dispose(); }, [labelTexture]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime() + phase;

    if (!isActive) {
      groupRef.current.position.y = pos[1];
      groupRef.current.rotation.y = 0;
      return;
    }
    if (isWorking) {
      groupRef.current.position.y = pos[1] + Math.sin(t * 3.1) * 0.055;
      groupRef.current.rotation.y = Math.sin(t * 0.9) * 0.09;
    } else if (isThinking) {
      groupRef.current.position.y = pos[1] + Math.sin(t * 1.3) * 0.022;
      if (headRef.current) headRef.current.rotation.z = Math.sin(t * 0.75) * 0.17;
    } else {
      // Idle: gentle sway + breathing torso
      groupRef.current.position.y = pos[1] + Math.sin(t * 0.85) * 0.028;
      groupRef.current.rotation.y = Math.sin(t * 0.3) * 0.055;
      if (torsoRef.current) {
        torsoRef.current.scale.y = 1 + Math.sin(t * 0.72 + phase * 0.4) * 0.022;
      }
    }
  });

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      setSelectedAgent(agent.agent_id);
    },
    [agent.agent_id, setSelectedAgent]
  );

  const onContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      e.nativeEvent.preventDefault();
      setContextMenu({
        agentId: agent.agent_id,
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      });
    },
    [agent.agent_id, setContextMenu]
  );

  return (
    <group
      ref={groupRef}
      position={pos}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      {/* Selection ring + spotlight */}
      {isSelected && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
            <ringGeometry args={[0.22, 0.30, 20]} />
            <meshBasicMaterial color={color} transparent opacity={0.72} side={THREE.DoubleSide} />
          </mesh>
          <pointLight position={[0, 1.1, 0]} intensity={2.5} color={color} distance={3.0} decay={2} />
        </>
      )}

      {/* Legs — reduced segments */}
      <mesh position={[-0.07, 0.13, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.26, 6]} />
        <meshStandardMaterial color={DARK} roughness={0.85} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0.07, 0.13, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.26, 6]} />
        <meshStandardMaterial color={DARK} roughness={0.85} transparent opacity={opacity} />
      </mesh>

      {/* Torso — has breathing ref */}
      <mesh ref={torsoRef} position={[0, 0.49, 0]}>
        <boxGeometry args={[0.26, 0.36, 0.13]} />
        <meshStandardMaterial
          color={color} emissive={color}
          emissiveIntensity={isActive ? 0.14 : 0}
          roughness={0.42} metalness={0.22}
          transparent opacity={opacity}
        />
      </mesh>

      {/* Status dot on chest */}
      <mesh position={[0.07, 0.53, 0.07]}>
        <sphereGeometry args={[0.032, 6, 5]} />
        <meshStandardMaterial color={dotColor} emissive={dotColor} emissiveIntensity={dotGlow} roughness={0} metalness={0} />
      </mesh>

      {/* Arms — reduced segments */}
      <mesh position={[-0.17, 0.47, 0]} rotation={[0, 0, 0.30]}>
        <cylinderGeometry args={[0.04, 0.036, 0.24, 5]} />
        <meshStandardMaterial color={DARK} roughness={0.85} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0.17, 0.47, 0]} rotation={[0, 0, -0.30]}>
        <cylinderGeometry args={[0.04, 0.036, 0.24, 5]} />
        <meshStandardMaterial color={DARK} roughness={0.85} transparent opacity={opacity} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 0.71, 0]}>
        <cylinderGeometry args={[0.037, 0.042, 0.08, 6]} />
        <meshStandardMaterial color={SKIN} roughness={0.6} transparent opacity={opacity} />
      </mesh>

      {/* Head — reduced segments */}
      <mesh ref={headRef} position={[0, 0.88, 0]}>
        <sphereGeometry args={[0.135, 8, 7]} />
        <meshStandardMaterial color={SKIN} roughness={0.55} metalness={0} transparent opacity={opacity} />
      </mesh>

      {/* Canvas sprite label — billboard, no DOM overhead */}
      <sprite position={[0, 1.40, 0]} scale={[1.1, 1.1 * (LABEL_H / LABEL_W), 1]}>
        <spriteMaterial map={labelTexture} transparent alphaTest={0.01} depthWrite={false} />
      </sprite>
    </group>
  );
}

// ── Agent workstation (desk + chair + keyboard + monitor + screen glow) ────────

function AgentWorkstation({ agent, pos, phase, isHead }: {
  agent:  AgentLive;
  pos:    [number, number, number];
  phase:  number;
  isHead: boolean;
}) {
  const monitorRef = useRef<THREE.Mesh>(null);
  const glowRef    = useRef<THREE.Mesh>(null);

  const isActive   = agent.status === "active";
  const isWorking  = agent.runtime_status === "working";
  const isThinking = agent.runtime_status === "thinking";
  const isError    = agent.runtime_status === "error";
  const color      = agent.badge_color || "#6366f1";

  const screenColor = isError   ? "#ef4444"
                    : isWorking  ? color
                    : isThinking ? "#f59e0b"
                    : "#1a2545";

  const deskEdgeGeo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.64, 0.04, 0.46)),
    []
  );

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + phase;
    if (monitorRef.current) {
      const mat = monitorRef.current.material as THREE.MeshStandardMaterial;
      if (!isActive) {
        mat.emissiveIntensity = 0.02;
      } else if (isError) {
        mat.emissiveIntensity = Math.sin(t * 14) > 0 ? 1.4 : 0.12;
      } else if (isWorking) {
        mat.emissiveIntensity = 0.78 + Math.sin(t * 4.0 + phase) * 0.32;
      } else if (isThinking) {
        mat.emissiveIntensity = 0.28 + Math.sin(t * 1.5) * 0.18;
      } else {
        mat.emissiveIntensity = 0.16;
      }
      if (glowRef.current) {
        const gm = glowRef.current.material as THREE.MeshBasicMaterial;
        gm.opacity = mat.emissiveIntensity * 0.18;
      }
    }
  });

  return (
    <group position={pos}>
      {/* Head-agent raised dais */}
      {isHead && (
        <mesh position={[0, 0.022, 0]}>
          <boxGeometry args={[1.12, 0.044, 0.98]} />
          <meshStandardMaterial
            color={color} emissive={color} emissiveIntensity={0.18}
            roughness={0.65} metalness={0.20}
          />
        </mesh>
      )}

      {/* Table legs — 4 corners */}
      {([ [-0.27, -0.18], [-0.27, 0.18], [0.27, -0.18], [0.27, 0.18] ] as [number,number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.19, lz]}>
          <cylinderGeometry args={[0.024, 0.024, 0.38, 6]} />
          <meshStandardMaterial color="#09091a" roughness={0.88} metalness={0.18} />
        </mesh>
      ))}

      {/* Desk surface */}
      <mesh position={[0, 0.385, -0.02]}>
        <boxGeometry args={[0.64, 0.04, 0.46]} />
        <meshStandardMaterial
          color={isHead ? "#1c1130" : "#0d0d1e"}
          roughness={0.60} metalness={0.14}
        />
      </mesh>

      {/* Head: glowing desk border */}
      {isHead && (
        <lineSegments geometry={deskEdgeGeo} position={[0, 0.385, -0.02]}>
          <lineBasicMaterial color={color} transparent opacity={0.70} />
        </lineSegments>
      )}

      {/* Keyboard on desk surface */}
      <mesh position={[0, 0.413, 0.06]}>
        <boxGeometry args={[0.22, 0.016, 0.10]} />
        <meshStandardMaterial color="#131326" roughness={0.82} metalness={0.05} />
      </mesh>

      {/* Screen glow pool */}
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.410, -0.13]}>
        <planeGeometry args={[0.28, 0.16]} />
        <meshBasicMaterial
          color={screenColor} transparent opacity={0.04}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>

      {/* Monitor stand */}
      <mesh position={[0, 0.458, -0.20]}>
        <cylinderGeometry args={[0.018, 0.026, 0.10, 6]} />
        <meshStandardMaterial color="#07070e" roughness={0.9} />
      </mesh>

      {/* Monitor screen */}
      <mesh ref={monitorRef} position={[0, 0.604, -0.15]} rotation={[-0.22, 0, 0]}>
        <boxGeometry args={[0.37, 0.24, 0.022]} />
        <meshStandardMaterial
          color={screenColor} emissive={screenColor}
          emissiveIntensity={isActive ? 0.16 : 0.02}
          roughness={0.05} metalness={0.05}
        />
      </mesh>

      {/* Chair — base disc */}
      <mesh position={[0, 0.012, 0.52]}>
        <cylinderGeometry args={[0.145, 0.145, 0.024, 10]} />
        <meshStandardMaterial color={CHAIR} roughness={0.8} metalness={0.1} />
      </mesh>
      {/* Chair post */}
      <mesh position={[0, 0.165, 0.52]}>
        <cylinderGeometry args={[0.022, 0.022, 0.29, 5]} />
        <meshStandardMaterial color={CHAIR} roughness={0.8} metalness={0.1} />
      </mesh>
      {/* Chair seat */}
      <mesh position={[0, 0.32, 0.50]}>
        <boxGeometry args={[0.30, 0.04, 0.29]} />
        <meshStandardMaterial color={CHAIR} roughness={0.72} metalness={0.05} />
      </mesh>
      {/* Chair backrest */}
      <mesh position={[0, 0.50, 0.62]}>
        <boxGeometry args={[0.28, 0.28, 0.04]} />
        <meshStandardMaterial color={CHAIR} roughness={0.72} metalness={0.05} />
      </mesh>

      {/* Agent humanoid — seated position: torso+head above desk, legs hidden below */}
      <AgentHumanoid agent={agent} pos={[0, -0.12, 0.05]} phase={phase} isHead={isHead} />
    </group>
  );
}

// ── Department room ───────────────────────────────────────────────────────────

function DeptRoom({ dept, agents }: { dept: DeptLive; agents: AgentLive[] }) {
  const layout = ROOM[dept.id];
  if (!layout) return null;

  const { x, z, w, d } = layout;
  const { setSelectedDept, selectedDeptId } = useAgentStore();
  const isSelected  = selectedDeptId === dept.id;
  const hasActive   = dept.enabled && agents.some(a => a.status === "active");
  const color       = dept.badge_color || "#6366f1";
  const label       = (dept.name || dept.id).toUpperCase();
  const wallOpacity = isSelected ? 0.14 : hasActive ? 0.07 : 0.025;

  // Head agent gets front-centre slot; others fill a grid shifted toward the back
  const headAgent   = dept.head_agent
    ? agents.find(a => a.codename === dept.head_agent) ?? null
    : null;
  const otherAgents = headAgent
    ? agents.filter(a => a.agent_id !== headAgent.agent_id)
    : agents;

  const headSlot: [number, number, number] = [0, 0.12, d / 2 - 0.9];
  const gridD    = headAgent ? d * 0.76 : d;
  const gridZ    = headAgent ? -(d * 0.12) : 0;
  const rawSlots = agentSlots(otherAgents.length, w, gridD);
  const slots    = rawSlots.map(([sx, sy, sz]) =>
    [sx, sy, sz + gridZ] as [number, number, number]
  );

  // Ceiling strip light dimensions
  const stripW = Math.min(w * 0.44, 5.0);

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      setSelectedDept(isSelected ? null : dept.id);
    },
    [dept.id, isSelected, setSelectedDept]
  );

  return (
    <group position={[x, 0, z]}>
      {/* Floor slab */}
      <mesh
        onClick={onClick}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = "default"; }}
      >
        <boxGeometry args={[w, 0.22, d]} />
        <meshStandardMaterial
          color={isSelected ? color : "#0d1117"}
          emissive={color}
          emissiveIntensity={isSelected ? 0.3 : hasActive ? 0.07 : 0}
          roughness={0.75} metalness={0.15}
        />
      </mesh>

      <RoomEdges w={w} d={d} color={color} bright={hasActive || isSelected} />
      <GlassWalls w={w} d={d} color={color} opacity={wallOpacity} />

      {/* Ceiling light strips — emissive bar + weak fill light for selected rooms */}
      <mesh position={[-(stripW * 0.6), 1.72, 0]}>
        <boxGeometry args={[stripW, 0.045, 0.11]} />
        <meshStandardMaterial color="#c8e4ff" emissive="#c8e4ff" emissiveIntensity={hasActive ? 0.65 : 0.12} roughness={1} />
      </mesh>
      <mesh position={[stripW * 0.6, 1.72, 0]}>
        <boxGeometry args={[stripW, 0.045, 0.11]} />
        <meshStandardMaterial color="#c8e4ff" emissive="#c8e4ff" emissiveIntensity={hasActive ? 0.65 : 0.12} roughness={1} />
      </mesh>

      {/* Single fill light — only on selected room (perf: max 1 dynamic light at a time) */}
      {isSelected && (
        <pointLight position={[0, 3.5, 0]} intensity={1.4} color={color} distance={9} decay={2} />
      )}


      {/* Dept label */}
      <Html
        center
        position={[0, 2.6, 0]}
        style={{ pointerEvents: "none", userSelect: "none" }}
        distanceFactor={12}
        occlude={false}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textAlign: "center", whiteSpace: "nowrap" }}>
          <span style={{
            fontSize: dept.id === "executive" ? 13 : 9,
            fontWeight: 900, letterSpacing: "0.1em",
            color, textShadow: "0 0 8px currentColor", fontFamily: "monospace",
          }}>
            {label}
          </span>
          <span style={{ fontSize: 8, letterSpacing: "0.06em", color: hasActive ? color : "#333355", fontFamily: "monospace" }}>
            {hasActive ? "● ONLINE" : dept.enabled ? "○ STANDBY" : "○ OFFLINE"}
          </span>
        </div>
      </Html>

      {/* Department head — front-centre special workstation */}
      {headAgent && (
        <AgentWorkstation
          key={headAgent.agent_id}
          agent={headAgent}
          pos={headSlot}
          phase={0}
          isHead={true}
        />
      )}

      {/* Regular agent workstations — grid in rear of room */}
      {otherAgents.map((agent, i) => {
        const slot = slots[i] ?? [0, 0.12, 0] as [number, number, number];
        return (
          <AgentWorkstation
            key={agent.agent_id}
            agent={agent}
            pos={slot}
            phase={i * 1.57 + ((dept.id.charCodeAt(0) || 0) % 6)}
            isHead={false}
          />
        );
      })}
    </group>
  );
}

// ── Comm arc types ────────────────────────────────────────────────────────────

interface CommRecord {
  from_agent: string;
  to_agent:   string;
  subject:    string;
  created_at: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function agentToDept(codename: string, agents: AgentLive[]): string | null {
  return agents.find(a => a.codename === codename)?.department ?? null;
}

function roomCenter(deptId: string, y = 1.5): [number, number, number] {
  const r = ROOM[deptId];
  if (!r) return [0, y, 0];
  return [r.x, y, r.z];
}

function buildArc(a: [number, number, number], b: [number, number, number], lift = 6): THREE.Vector3[] {
  const mid: [number, number, number] = [
    (a[0] + b[0]) / 2,
    Math.max(a[1], b[1]) + lift,
    (a[2] + b[2]) / 2,
  ];
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(...a),
    new THREE.Vector3(...mid),
    new THREE.Vector3(...b),
  );
  return curve.getPoints(40);
}

// ── Single animated comm arc ──────────────────────────────────────────────────

function CommArc({ fromDept, toDept, color }: { fromDept: string; toDept: string; color: string }) {
  const progressRef = useRef(0);
  const dotRef      = useRef<THREE.Mesh>(null);

  const a = roomCenter(fromDept);
  const b = roomCenter(toDept);
  const pts = useMemo(() => buildArc(a, b), [fromDept, toDept]); // eslint-disable-line react-hooks/exhaustive-deps

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  }, [pts]);

  useFrame((_, delta) => {
    progressRef.current = (progressRef.current + delta * 0.45) % 1;
    if (dotRef.current) {
      const idx = Math.floor(progressRef.current * (pts.length - 1));
      const pt  = pts[idx];
      dotRef.current.position.set(pt.x, pt.y, pt.z);
    }
  });

  return (
    <group>
      {/* @ts-expect-error — R3F <line> collides with SVG <line> in strict TS, works at runtime */}
      <line geometry={geo}>
        <lineBasicMaterial color={color} transparent opacity={0.22} linewidth={1} />
      </line>
      <mesh ref={dotRef} position={[a[0], a[1], a[2]]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} roughness={0} metalness={0} />
      </mesh>
    </group>
  );
}

// ── Comm arc layer ────────────────────────────────────────────────────────────

function CommArcs({ agents }: { agents: AgentLive[] }) {
  const [comms, setComms] = useState<CommRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch(`${API_URL}/api/agents/communications?minutes=15&limit=30`);
        if (r.ok && !cancelled) {
          const data = await r.json();
          setComms(data.comms ?? []);
        }
      } catch { /**/ }
    }
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const seen = new Set<string>();
  const arcs: { fromDept: string; toDept: string; color: string }[] = [];

  for (const c of comms) {
    const fromDept = agentToDept(c.from_agent, agents);
    const toDept   = agentToDept(c.to_agent,   agents);
    if (!fromDept || !toDept || fromDept === toDept) continue;
    const key = [fromDept, toDept].sort().join("→");
    if (seen.has(key)) continue;
    seen.add(key);
    const fromAgent = agents.find(a => a.codename === c.from_agent);
    arcs.push({ fromDept, toDept, color: fromAgent?.badge_color ?? "#6366f1" });
  }

  return (
    <>
      {arcs.map(a => (
        <CommArc key={`${a.fromDept}→${a.toDept}`}
          fromDept={a.fromDept} toDept={a.toDept} color={a.color} />
      ))}
    </>
  );
}

// ── Ambient particle cloud (1 InstancedMesh per active room = 1 draw call) ────

const PARTICLE_COUNT = 12;

function RoomParticles({ w, d, color }: { w: number; d: number; color: string }) {
  const meshRef  = useRef<THREE.InstancedMesh>(null);
  const dummy    = useMemo(() => new THREE.Object3D(), []);

  // Fixed random layout computed once at mount
  const particles = useMemo(() =>
    Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      x:     (((i * 137.508) % 1) - 0.5) * (w - 0.6),
      z:     (((i * 97.321)  % 1) - 0.5) * (d - 0.5),
      speed: 0.14 + ((i * 53.7) % 0.28),
      phase: (i * 2.399) % (Math.PI * 2),
    })),
  [w, d]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      const y    = ((t * p.speed + p.phase * 0.5) % 2.0);
      const fade = y < 0.25 ? y / 0.25 : y > 1.5 ? (2.0 - y) / 0.5 : 1.0;
      dummy.position.set(
        p.x + Math.sin(t * 0.28 + p.phase) * 0.20,
        y * 0.85,
        p.z + Math.cos(t * 0.21 + p.phase * 1.3) * 0.20,
      );
      const s = fade * (0.28 + Math.sin(t * p.speed * 1.6 + p.phase) * 0.10);
      dummy.scale.setScalar(Math.max(0.01, s));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]} renderOrder={1}>
      <sphereGeometry args={[1, 4, 3]} />
      <meshStandardMaterial
        color={color} emissive={color} emissiveIntensity={2.2}
        roughness={0} metalness={0} transparent opacity={0.65} depthWrite={false}
      />
    </instancedMesh>
  );
}

// ── Radar sweep ring (expands from centre, one draw call) ─────────────────────

function RadarScanner() {
  const ringRef = useRef<THREE.Mesh>(null);
  const prog    = useRef(0.35); // start mid-cycle

  useFrame((_, delta) => {
    if (!ringRef.current) return;
    prog.current = (prog.current + delta * 0.09) % 1;
    const t  = prog.current;
    const r  = t * 38;
    const op = Math.max(0, (1 - t) * 0.18);
    ringRef.current.scale.set(r, 1, r);
    (ringRef.current.material as THREE.MeshBasicMaterial).opacity = op;
  });

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} scale={[0, 1, 0]}>
      <ringGeometry args={[0.94, 1.0, 48]} />
      <meshBasicMaterial color="#00d4ff" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ── Keyboard camera panning / rotation (arrow keys + Shift) ──────────────────

// ── Hotkey reference overlay ──────────────────────────────────────────────────

function HotkeyHelp({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const rows: [string, string][] = [
    ["← → ↑ ↓",      "Pan camera"],
    ["Shift + arrows","Rotate / orbit"],
    ["+ / =",         "Zoom in"],
    ["–",             "Zoom out"],
    ["R",             "Reset camera"],
    ["F",             "Fit all to view"],
    ["Esc",           "Deselect agent / dept"],
    ["?",             "Toggle this help"],
  ];
  return (
    <Html
      position={[0, 0, 0]}
      style={{
        position: "fixed", right: 14, bottom: 52,
        background: "rgba(8,8,20,0.93)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8,
        padding: "10px 14px", pointerEvents: "none", minWidth: 220,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6366f1", marginBottom: 7 }}>
        Keyboard Shortcuts
      </div>
      {rows.map(([key, desc]) => (
        <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 4 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#c8d0e8", fontWeight: 700 }}>{key}</span>
          <span style={{ fontSize: 10, color: "#6b7a9a" }}>{desc}</span>
        </div>
      ))}
    </Html>
  );
}

// ── Keyboard camera panning / rotation (arrow keys + Shift) ──────────────────

function KeyboardCam() {
  const keysRef    = useRef(new Set<string>());
  const helpRef    = useRef(false);
  const [showHelp, setShowHelp] = useState(false);
  const controls   = useThree(s => s.controls);
  const setSelectedAgent = useAgentStore(s => s.setSelectedAgent);
  const setSelectedDept  = useAgentStore(s => s.setSelectedDept);

  useEffect(() => {
    const MANAGED = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","=","-","_","r","R","f","F","?","Escape"];

    const onDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (MANAGED.includes(e.key)) e.preventDefault();

      // one-shot hotkeys
      const ctrl = controls as unknown as {
        truck:  (x: number, y: number) => void;
        rotate: (a: number, p: number) => void;
        dolly:  (d: number, animate?: boolean) => void;
        setLookAt: (px:number,py:number,pz:number,lx:number,ly:number,lz:number,animate:boolean) => void;
        fitToBox: (box: unknown, animate: boolean) => void;
      } | null;

      if (e.key === "?" || e.key === "/") {
        helpRef.current = !helpRef.current;
        setShowHelp(helpRef.current);
        return;
      }
      if ((e.key === "r" || e.key === "R") && ctrl) {
        ctrl.setLookAt(0, 28, 32, 0, 0, 0, true);
        return;
      }
      if ((e.key === "f" || e.key === "F") && ctrl) {
        ctrl.setLookAt(0, 40, 14, 0, -2, 0, true);
        return;
      }
      if (e.key === "Escape") {
        setSelectedAgent(null);
        setSelectedDept(null);
        return;
      }

      keysRef.current.add(e.key);
    };
    const onUp = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup",   onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup",   onUp);
    };
  }, [controls, setSelectedAgent, setSelectedDept]);

  useFrame((_, delta) => {
    if (!controls) return;
    const k = keysRef.current;
    if (k.size === 0) return;
    const ctrl = controls as unknown as {
      truck:  (x: number, y: number) => void;
      rotate: (a: number, p: number) => void;
      dolly:  (d: number) => void;
    };
    const spd   = 12 * delta;
    const rspd  = 1.4 * delta;
    const zspd  = 14 * delta;
    const shift = k.has("Shift");

    if (k.has("ArrowLeft"))  shift ? ctrl.rotate(-rspd, 0) : ctrl.truck(-spd, 0);
    if (k.has("ArrowRight")) shift ? ctrl.rotate( rspd, 0) : ctrl.truck( spd, 0);
    if (k.has("ArrowUp"))    shift ? ctrl.rotate(0, -rspd) : ctrl.truck(0, -spd);
    if (k.has("ArrowDown"))  shift ? ctrl.rotate(0,  rspd) : ctrl.truck(0,  spd);
    if (k.has("+") || k.has("=")) ctrl.dolly(-zspd);
    if (k.has("-") || k.has("_")) ctrl.dolly( zspd);
  });

  return <HotkeyHelp visible={showHelp} />;
}

// ── Smart camera — free CameraControls (no auto fly-to) ──────────────────────

function SmartCamera() {
  return (
    <CameraControls
      maxPolarAngle={Math.PI / 2.15}
      minDistance={3}
      maxDistance={150}
      makeDefault
    />
  );
}

// ── Full scene ────────────────────────────────────────────────────────────────

function Scene() {
  const { agents, departments } = useAgentStore();

  return (
    <>
      <ambientLight intensity={0.26} />
      <directionalLight position={[12, 22, 8]} intensity={0.65} color="#c8d4ff" />
      <hemisphereLight color="#1a1a4e" groundColor="#04040f" intensity={0.30} />

      {/* Base floor — visible dark navy (NOT near-black) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, 0]}>
        <planeGeometry args={[90, 80]} />
        <meshStandardMaterial color="#0d1630" roughness={0.82} metalness={0.14} />
      </mesh>

      {/* Mid-layer — slightly lighter under the dept zone, adds depth */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, -1.5]}>
        <planeGeometry args={[38, 32]} />
        <meshStandardMaterial color="#111e3a" roughness={0.85} metalness={0.10} transparent opacity={0.85} />
      </mesh>

      {/* Floor grid — clearly visible indigo lines */}
      <gridHelper args={[100, 80, "#243870", "#182858"]} position={[0, -0.1, 0]} />

      {departments.map(dept => {
        const deptAgents = agents.filter(a => a.department === dept.id);
        return <DeptRoom key={dept.id} dept={dept} agents={deptAgents} />;
      })}

      <CommArcs agents={agents} />
      <RadarScanner />
      <SmartCamera />
      <KeyboardCam />
    </>
  );
}

// ── Error boundary ────────────────────────────────────────────────────────────

class SceneBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: "100%", background: "#04040f", display: "flex",
          alignItems: "center", justifyContent: "center", flexDirection: "column",
          gap: 12, padding: 32, color: "#ef4444", fontFamily: "monospace",
        }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>3D Scene Error</div>
          <div style={{ fontSize: 12, maxWidth: 600, textAlign: "center", opacity: 0.85 }}>
            {(this.state.error as Error).message}
          </div>
          <pre style={{ fontSize: 10, opacity: 0.5, overflow: "auto", maxWidth: 700, maxHeight: 200 }}>
            {(this.state.error as Error).stack?.split("\n").slice(0, 8).join("\n")}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Canvas export (dynamically imported, ssr: false) ──────────────────────────

export default function CommandCenter3DScene() {
  return (
    <SceneBoundary>
      <Canvas
        camera={{ position: [0, 28, 32], fov: 44 }}
        gl={{ antialias: true }}
        dpr={[1, 1.5]}
        style={{ width: "100%", height: "100%", background: "#04040f" }}
      >
        <Scene />
      </Canvas>
    </SceneBoundary>
  );
}
