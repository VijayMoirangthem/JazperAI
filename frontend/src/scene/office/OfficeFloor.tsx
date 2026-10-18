"use client";

// The 2D office floor — a Pixi.js view of the CO OS fleet walking between
// department rooms. Ported in spirit from Munder Difflin's OfficeFloor.tsx.
//
// The scene is built from the agent store, which loads async — so instead of
// building once at mount (when the store is still empty) we rebuild the floor
// whenever the agent/department ROSTER changes. Status/action changes sync
// cheaply per frame without rebuilding.

import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import { useAgentStore } from "@/stores/agentStore";
import { buildMap } from "./officeMap";
import type { OfficeMap } from "./officeMap";
import type { FloorAgent, FloorDept } from "./types";
import { Character, TILE } from "./Character";
import { MessageEnvelope } from "./MessageEnvelope";
import { Camera } from "./Camera";

const BG = 0x0a0a12;

interface FloorAgentState extends FloorAgent {
  agent_id: string;
  status: FloorAgent["status"];
}

function toFloorAgent(a: any, deptColor: string): FloorAgentState {
  const runtime = a.runtime ?? {};
  return {
    id: a.agent_id ?? a.codename,
    agent_id: a.agent_id ?? a.codename,
    codename: a.codename,
    name: a.name ?? a.codename,
    status: (runtime.status ?? "idle") as FloorAgent["status"],
    action: runtime.action ?? undefined,
    carrying: runtime.carrying ?? null,
    lastPrompt: runtime.last_prompt ?? null,
    accent: a.badge_color || deptColor || "#6366f1",
    deptId: a.department ?? "executive",
    level: a.level ?? 0,
    isGod: a.codename === "jazper",
  };
}

function deptsFrom(deps: any[]): FloorDept[] {
  return deps.map(d => ({
    id: d.id,
    name: d.name,
    color: d.badge_color || "#64748b",
    enabled: d.enabled,
    floor_position: d.floor_position && typeof d.floor_position.x === "number"
      ? { x: d.floor_position.x, y: d.floor_position.y }
      : null,
  }));
}

/** Roster key — changes only when agents/departments are added/removed/moved,
 *  NOT on status or action updates. */
function rosterKeyOf(agents: any[]): string {
  return agents
    .map(a => `${a.codename}|${a.department ?? ""}|${a.agent_id ?? ""}`)
    .sort()
    .join(";");
}

export default function OfficeFloor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container | null>(null);
  const charsRef = useRef<Map<string, Character>>(new Map());
  const mapRef = useRef<OfficeMap | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const envelopesRef = useRef<Set<MessageEnvelope>>(new Set());
  const seenMessagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const app = new PIXI.Application();
    appRef.current = app;
    let disposed = false;
    let inited = false;

    const ro = new ResizeObserver(() => {
      if (appRef.current && cameraRef.current) {
        cameraRef.current.setViewport(app.screen.width, app.screen.height);
      }
    });
    ro.observe(el);

    (async () => {
      try {
        await app.init({
          background: BG,
          antialias: true,
          resizeTo: el,
          resolution: Math.min(2, window.devicePixelRatio || 1),
          autoDensity: true,
        });
      } catch (e) {
        console.warn("[OfficeFloor] Pixi init failed:", e);
        return;
      }
      if (disposed) return;
      inited = true;
      el.appendChild(app.canvas);
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      app.canvas.style.display = "block";

      const world = new PIXI.Container();
      world.sortableChildren = true;
      app.stage.addChild(world);
      worldRef.current = world;

      const camera = new Camera();
      cameraRef.current = camera;

      let chars: Map<string, Character> = new Map();
      let map: OfficeMap | null = null;
      let rosterKey = "";

      // ── Build / rebuild the whole scene from the store roster ─────────
      const buildScene = (depts: FloorDept[], agents: FloorAgentState[]) => {
        // clear previous scene (characters, envelopes, labels, floor)
        for (const env of envelopesRef.current) {
          if (env.parent) world.removeChild(env);
          env.destroy({ children: true });
        }
        envelopesRef.current.clear();
        while (world.children.length) {
          const c = world.children[0];
          world.removeChild(c);
          c.destroy({ children: true });
        }
        chars = new Map();
        charsRef.current = chars;

        map = buildMap(depts, agents);
        mapRef.current = map;

        // floor tiles
        const floorG = new PIXI.Graphics();
        const wallColor = 0x14141f;
        const corridorColor = 0x111118;
        for (let y = 0; y < map.h; y++) {
          for (let x = 0; x < map.w; x++) {
            const walkable = map.walk[y * map.w + x] === 1;
            const room = map.rooms.find(r =>
              x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
            );
            let color = corridorColor;
            if (walkable) {
              if (room) {
                const c = parseInt(room.color.replace("#", ""), 16) || 0x6366f1;
                const dim = 0.16;
                const r = Math.round(((c >> 16) & 255) * dim);
                const g = Math.round(((c >> 8) & 255) * dim);
                const b = Math.round((c & 255) * dim);
                color = (r << 16) | (g << 8) | b;
              } else {
                color = corridorColor;
              }
            } else {
              color = wallColor;
            }
            floorG.rect(x * TILE, y * TILE, TILE, TILE).fill(color);
          }
        }
        // wall lines around rooms
        for (const room of map.rooms) {
          const c = parseInt(room.color.replace("#", ""), 16) || 0x6366f1;
          floorG.rect(room.x * TILE - 1, room.y * TILE - 1, room.w * TILE + 2, 2).fill(0x22222e);
          floorG.rect(room.x * TILE - 1, (room.y + room.h) * TILE - 1, room.w * TILE + 2, 2).fill(0x22222e);
          floorG.rect(room.x * TILE - 1, room.y * TILE - 1, 2, room.h * TILE + 2).fill(0x22222e);
          floorG.rect((room.x + room.w) * TILE - 1, room.y * TILE - 1, 2, room.h * TILE + 2).fill(0x22222e);
        }
        world.addChild(floorG);

        // room labels
        for (const room of map.rooms) {
          const label = new PIXI.Text({
            text: room.label.toUpperCase(),
            style: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, fill: room.color, letterSpacing: 2, fontWeight: "700" },
          });
          label.anchor.set(0.5, 0.5);
          label.position.set((room.x + room.w / 2) * TILE, (room.y + room.h / 2) * TILE - 8);
          label.zIndex = 2;
          world.addChild(label);
        }

        // desk markers
        for (const desk of map.desks) {
          const dot = new PIXI.Graphics();
          dot.rect(desk.x * TILE + 4, desk.y * TILE + 4, TILE - 8, TILE - 8).fill({ color: 0xffffff, alpha: 0.06 });
          world.addChild(dot);
        }

        // characters
        for (const a of agents) {
          const desk = map.desks.find(d => d.id === a.id) ?? null;
          const ch = new Character(map, a, desk);
          chars.set(a.codename, ch);
          world.addChild(ch);
        }
        charsRef.current = chars;

        // reset the camera to fit the rebuilt world
        camera.fitToWorld(map.w * TILE, map.h * TILE);
        camera.snap();
        camera.apply(world);
      };

      // initial build (store may be empty — the ticker rebuilds when it fills)
      const { agents: liveAgents, departments: liveDepts } = useAgentStore.getState();
      buildScene(deptsFrom(liveDepts), liveAgents.map(a => toFloorAgent(a, "#64748b")));

      // ── Interactions ──
      const onClick = (e: PointerEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const all = Array.from(chars.values()).reverse();
        const hit = all.find(ch => {
          const p = camera.toScreen(ch.centerPx().x, ch.centerPx().y);
          return Math.hypot(sx - p.x, sy - p.y) < 22;
        });
        if (hit) {
          useAgentStore.getState().setSelectedAgent(hit.agentId);
          camera.focus(hit.centerPx().x, hit.centerPx().y);
        } else if (map) {
          useAgentStore.getState().setSelectedAgent(null);
          camera.fitToWorld(map.w * TILE, map.h * TILE);
        }
      };
      const onMove = (e: PointerEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const all = Array.from(chars.values()).reverse();
        const hit = all.find(ch => {
          const p = camera.toScreen(ch.centerPx().x, ch.centerPx().y);
          return Math.hypot(sx - p.x, sy - p.y) < 22;
        });
        app.canvas.style.cursor = hit ? "pointer" : "default";
      };
      const onCtx = (e: MouseEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const all = Array.from(chars.values()).reverse();
        const hit = all.find(ch => {
          const p = camera.toScreen(ch.centerPx().x, ch.centerPx().y);
          return Math.hypot(sx - p.x, sy - p.y) < 22;
        });
        if (hit) {
          e.preventDefault();
          useAgentStore.getState().setContextMenu({ agentId: hit.agentId, x: e.clientX, y: e.clientY });
          useAgentStore.getState().setSelectedAgent(hit.agentId);
        }
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (e.deltaY < 0) camera.zoom(1.12);
        else camera.zoom(1 / 1.12);
      };

      app.canvas.addEventListener("pointerdown", onClick);
      app.canvas.addEventListener("pointermove", onMove);
      app.canvas.addEventListener("contextmenu", onCtx);
      app.canvas.addEventListener("wheel", onWheel, { passive: false });

      // ── Ticker ──
      let idleTimer = 0;
      const ticker = app.ticker.add((ticker) => {
        const dtMS = Math.min(50, ticker.deltaMS);
        const dtSec = dtMS / 1000;

        const { agents: la, departments: ld, selectedAgentId } = useAgentStore.getState();
        const depts = deptsFrom(ld);
        const deptColor = (id: string) => depts.find(d => d.id === id)?.color ?? "#64748b";

        // rebuild the scene if the roster changed (e.g. data just loaded)
        const key = rosterKeyOf(la);
        if (key !== rosterKey) {
          rosterKey = key;
          if (la.length > 0 && map && mapRef.current) {
            buildScene(depts, la.map(a => toFloorAgent(a, deptColor(a.department))));
          }
        }

        if (map && chars.size > 0) {
          // sync agent states from the store
          for (const a of la) {
            const ch = chars.get(a.codename);
            if (!ch) continue;
            ch.setState(toFloorAgent(a, deptColor(a.department)));
            ch.setSelected(a.agent_id === selectedAgentId);
          }

          // envelopes for new messages
          const msgs = useAgentStore.getState().messages;
          for (const m of msgs) {
            if (seenMessagesRef.current.has(m.id)) continue;
            seenMessagesRef.current.add(m.id);
            const from = chars.get(m.from_codename || m.from || "jazper");
            const to = chars.get(m.to_codename || m.to || "jazper");
            if (from && to && from !== to) {
              const env = new MessageEnvelope(from, to, m.subject || m.body || "", m.act || "inform", from.accent);
              world.addChild(env);
              envelopesRef.current.add(env);
              env.on("arrived", () => {
                to.showBubble(m.subject || m.body || "", 4);
              });
            }
          }

          // idle agents wander occasionally
          idleTimer += dtSec;
          if (idleTimer > 6) {
            idleTimer = 0;
            for (const ch of chars.values()) {
              if (ch.status === "idle" && Math.random() < 0.4) ch.wander();
            }
          }

          // follow selection
          const sel = selectedAgentId ? chars.get(selectedAgentId) : null;
          if (sel) {
            const c = sel.centerPx();
            camera.focus(c.x, c.y);
            camera.zoom(1.6);
          } else if (map) {
            camera.fitToWorld(map.w * TILE, map.h * TILE);
          }
          camera.lerp(0.08);
          camera.apply(world);

          // update characters + envelopes
          for (const ch of chars.values()) ch.update(dtMS);
          for (const env of envelopesRef.current) env.update(dtMS, dtSec);
          for (const env of Array.from(envelopesRef.current)) {
            if (env.isDone) {
              world.removeChild(env);
              envelopesRef.current.delete(env);
              env.destroy({ children: true });
            }
          }
        }
      });
    })();

    return () => {
      disposed = true;
      ro.disconnect();
      appRef.current = null;
      worldRef.current = null;
      charsRef.current = new Map();
      mapRef.current = null;
      try {
        if (inited) app.destroy(true, { children: true });
      } catch (e) {
        console.warn("[OfficeFloor] app destroy skipped:", e);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", inset: 0,
        background: "#0a0a12", overflow: "hidden",
      }}
    />
  );
}