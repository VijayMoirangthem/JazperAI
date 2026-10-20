"use client";

import { useEffect, useRef } from "react";
import { miniToWorld, worldToMini } from "@/office2/camera";
import { T } from "@/office2/constants";
import type { OfficeHandle } from "@/office2/OfficeScene";
import { ringColor } from "@/office2/behavior";

const W = 160, H = 107;
const KIND_COLOR: Record<string, string> = { work: "#1e3a8a", private: "#8a5a33", transit: "#cbd5e1", meet: "#5b2a7a", tools: "#334155", social: "#b58455" };

export function Minimap({ handle }: { handle: OfficeHandle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const draw = () => {
      const c = ref.current, s = handle.scene;
      if (!c || !s.model || !s.avatars) return;
      const world = { w: s.model.width * T, h: s.model.height * T }, mini = { w: W, h: H };
      if (!bg.current) {
        const b = document.createElement("canvas"); b.width = W; b.height = H;
        const g = b.getContext("2d")!, px = W / s.model.width, py = H / s.model.height;
        g.fillStyle = "#0b0f14"; g.fillRect(0, 0, W, H);
        for (const a of s.model.areas) { g.fillStyle = KIND_COLOR[a.kind] ?? "#475569"; g.fillRect(a.x * px, a.y * py, a.w * px, a.h * py); }
        g.fillStyle = "#0f172a";
        s.model.blocked.forEach((row, y) => row.forEach((b2, x) => { if (b2) g.fillRect(x * px, y * py, Math.ceil(px), Math.ceil(py)); }));
        bg.current = b;
      }
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bg.current, 0, 0);
      for (const a of s.avatars.avatars.values()) {
        const [x, y] = worldToMini(a.sprite.x, a.sprite.y, world, mini);
        ctx.fillStyle = "#" + ringColor(a.state).toString(16).padStart(6, "0");
        ctx.fillRect(x - 1, y - 1, a.person.kind === "human" ? 4 : 3, a.person.kind === "human" ? 4 : 3);
      }
      const v = s.cameras.main.worldView, [vx, vy] = worldToMini(v.x, v.y, world, mini), [vw, vh] = worldToMini(v.width, v.height, world, mini);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.strokeRect(vx, vy, vw, vh);
    };
    const t = setInterval(draw, 250);
    return () => clearInterval(t);
  }, [handle]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), s = handle.scene;
    const [x, y] = miniToWorld(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, { w: s.model.width * T, h: s.model.height * T }, { w: W, h: H });
    s.rig.centerOn(x, y);
  };

  return <canvas ref={ref} width={W} height={H} onClick={click} data-testid="office2-minimap" className="absolute bottom-3 right-3 cursor-pointer rounded-lg ring-1 ring-white/20" style={{ width: W, height: H }} />;
}
