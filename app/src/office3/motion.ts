import type { OfficeActor } from "./engine/actors";
import { idleVariant, motionForState } from "./core/motionRules";
import type { InteractionId } from "./core/interactions";

/** Brief object-specific fallback poses while dedicated GLB gesture clips are unavailable. */
export const applyInteractionMotion = (actor: OfficeActor, interaction: InteractionId, time: number): void => {
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
  const phase = time + actor.person.slug.length * .37;
  if (["coffee", "vending", "water"].includes(interaction)) { actor.root.rotation.x = .09 + Math.sin(phase * 6) * .02; actor.root.rotation.z = Math.sin(phase * 5) * .04; return; }
  if (["printer", "whiteboard", "server"].includes(interaction)) { actor.root.rotation.x = .14; actor.root.rotation.z = Math.sin(phase * 2) * .025; return; }
  if (interaction === "sofa") { actor.root.position.y = -.18; actor.root.rotation.x = .08; return; }
  if (interaction === "booth") { actor.root.rotation.x = .06; actor.root.rotation.z = Math.sin(phase * 3) * .035; return; }
  actor.root.rotation.z = Math.sin(phase * 2) * .025;
};

/** Lightweight procedural fallback when a look does not ship a dedicated gesture clip. */
export const applyIdleMotion = (actor: OfficeActor, time: number): void => {
  const motion = motionForState((actor.current === "walk" ? "walk" : actor.state) as "idle" | "working" | "planning" | "waiting_human" | "waiting_tool" | "walk");
  // Navigation owns yaw. Reset only the procedural axes so one state cannot
  // leave a pose stuck after an actor changes work state.
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
  if (motion === "walk") return;

  const phase = time + actor.person.slug.length * 0.37;
  if (motion === "typing") {
    actor.root.rotation.x = 0.075 + Math.sin(phase * 8) * 0.025;
    actor.root.rotation.z = Math.sin(phase * 16) * 0.018;
    return;
  }
  if (motion === "reading") {
    actor.root.rotation.x = 0.13;
    actor.root.rotation.z = Math.sin(phase * 1.5) * 0.025;
    return;
  }
  if (motion === "hand-raise") {
    actor.root.rotation.z = Math.sin(phase * 4) * 0.12;
    actor.root.position.y = 0.02 + Math.sin(phase * 2) * 0.01;
    return;
  }
  if (motion === "pace") {
    actor.root.rotation.z = Math.sin(phase * 3) * 0.055;
    actor.root.position.y = Math.abs(Math.sin(phase * 3)) * 0.025;
    return;
  }
  if (actor.spot?.type === "seat") return;
  switch (idleVariant(actor.person.slug, time)) {
    case "weight-shift": actor.root.rotation.z = Math.sin(phase * 1.6) * 0.025; break;
    case "look": actor.root.rotation.x = Math.sin(phase * 0.9) * 0.018; break;
    case "stretch": actor.root.position.y = Math.max(0, Math.sin(phase * 1.1)) * 0.028; actor.root.rotation.x = -0.025; break;
  }
};

export const resetProceduralMotion = (actor: OfficeActor): void => {
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
};

export const labelPositions = (actors: OfficeActor[]): void => {
  const used: { x: number; z: number }[] = [];
  for (const actor of actors) {
    let z = actor.root.position.z;
    while (used.some(point => Math.abs(point.x - actor.root.position.x) < 1.8 && Math.abs(point.z - z) < 0.55)) z += 0.55;
    actor.label.position.z = z;
    used.push({ x: actor.root.position.x, z });
  }
};
