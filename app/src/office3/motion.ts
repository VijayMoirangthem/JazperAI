import { play, settle, type ActorAnimation, type OfficeActor } from "./engine/actors";
import { idleVariant, motionForState } from "./core/motionRules";
import type { InteractionId } from "./core/interactions";

const emoteByBubble: Record<string, "wave" | "thumbsup" | "clap" | "laugh" | "question" | "heart" | "coffee" | "thinking" | "sleep"> = {
  "👋": "wave", "👍": "thumbsup", "👏": "clap", "😄": "laugh", "❓": "question", "❤️": "heart", "☕": "coffee", "💭": "thinking", "💤": "sleep",
};
const emoteAnimations = new Set<ActorAnimation>(["wave", "thumbsup", "clap", "laugh", "question", "heart", "coffee", "thinking", "sleep"]);
const isEmoteAnimation = (animation: ActorAnimation | null): boolean => Boolean(animation && emoteAnimations.has(animation));

const resetGestureBone = (actor: OfficeActor) => {
  if (actor.gestureBone && actor.gestureRest) actor.gestureBone.rotation.copy(actor.gestureRest);
};
const gestureTarget = (actor: OfficeActor) => actor.gestureBone ?? actor.root;

/** Brief object-specific fallback poses while dedicated GLB gesture clips are unavailable. */
export const applyInteractionMotion = (actor: OfficeActor, interaction: InteractionId, time: number): void => {
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
  resetGestureBone(actor);
  const pose = gestureTarget(actor);
  const phase = time + actor.person.slug.length * .37;
  if (["coffee", "vending", "water"].includes(interaction)) { pose.rotation.x += .09 + Math.sin(phase * 6) * .02; pose.rotation.z += Math.sin(phase * 5) * .04; return; }
  if (["printer", "whiteboard", "server"].includes(interaction)) { pose.rotation.x += .14; pose.rotation.z += Math.sin(phase * 2) * .025; return; }
  if (interaction === "sofa") { actor.root.position.y = -.18; actor.root.rotation.x = .08; return; }
  if (interaction === "booth") { pose.rotation.x += .06; pose.rotation.z += Math.sin(phase * 3) * .035; return; }
  pose.rotation.z += Math.sin(phase * 2) * .025;
};

/** Compact visual fallback for chat-wheel emotes when the selected GLB has no matching clip. */
export const applyEmoteMotion = (actor: OfficeActor, bubble: string, time: number): boolean => {
  const emote = emoteByBubble[bubble];
  if (!emote) return false;
  if (actor.actions[emote]) { play(actor, emote); return true; }
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
  resetGestureBone(actor);
  const pose = gestureTarget(actor);
  const phase = time * (emote === "clap" ? 11 : 5) + actor.person.slug.length * .37;
  if (emote === "wave") pose.rotation.z += .17 + Math.sin(phase) * .14;
  else if (emote === "thumbsup") pose.rotation.x += .16;
  else if (emote === "clap") pose.rotation.z += Math.sin(phase) * .15;
  else if (emote === "laugh") { pose.rotation.x += .06; actor.root.position.y = Math.max(0, Math.sin(phase * 1.5)) * .025; }
  else if (emote === "question" || emote === "thinking") pose.rotation.z += Math.sin(phase * .7) * .06;
  else if (emote === "heart") pose.rotation.x += .11;
  else if (emote === "coffee") pose.rotation.x += .09 + Math.sin(phase * 3) * .02;
  else { pose.rotation.x += .12; actor.root.position.y = -.025; }
  return true;
};

/** Lightweight procedural fallback when a look does not ship a dedicated gesture clip. */
export const applyIdleMotion = (actor: OfficeActor, time: number): void => {
  const motion = motionForState((actor.current === "walk" ? "walk" : actor.state) as "idle" | "working" | "planning" | "waiting_human" | "waiting_tool" | "walk");
  // Navigation owns yaw. Reset only the procedural axes so one state cannot
  // leave a pose stuck after an actor changes work state.
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
  resetGestureBone(actor);
  const pose = gestureTarget(actor);
  if (isEmoteAnimation(actor.current)) settle(actor);
  if (motion === "walk") return;
  // A custom GLB may supply a named gesture clip. Let it own the pose; the
  // procedural movement below remains the universal fallback for stock looks.
  const customMotion = motion as keyof typeof actor.actions;
  if (motion !== "idle" && actor.current === customMotion && actor.actions[customMotion]) return;

  const phase = time + actor.person.slug.length * 0.37;
  if (motion === "typing") {
    pose.rotation.x += 0.075 + Math.sin(phase * 8) * 0.025;
    pose.rotation.z += Math.sin(phase * 16) * 0.018;
    return;
  }
  if (motion === "reading") {
    pose.rotation.x += 0.13;
    pose.rotation.z += Math.sin(phase * 1.5) * 0.025;
    return;
  }
  if (motion === "hand-raise") {
    pose.rotation.z += Math.sin(phase * 4) * 0.12;
    actor.root.position.y = 0.02 + Math.sin(phase * 2) * 0.01;
    return;
  }
  if (motion === "pace") {
    pose.rotation.z += Math.sin(phase * 3) * 0.055;
    actor.root.position.y = Math.abs(Math.sin(phase * 3)) * 0.025;
    return;
  }
  if (actor.spot?.type === "seat") return;
  // Mood is already derived from the real task board. Give idle agents a
  // subtle matching posture without competing with work, attention, or clips.
  if (actor.mood === "!") { pose.rotation.x += .028; pose.rotation.z += Math.sin(phase * 1.9) * .035; return; }
  if (actor.mood === "…") { actor.root.rotation.x = .042; actor.root.position.y = Math.max(0, Math.sin(phase * .8)) * .012; return; }
  if (actor.mood === "☺") { actor.root.position.y = Math.max(0, Math.sin(phase * 1.7)) * .018; return; }
  switch (idleVariant(actor.person.slug, time)) {
    case "weight-shift": pose.rotation.z += Math.sin(phase * 1.6) * 0.025; break;
    case "look": pose.rotation.x += Math.sin(phase * 0.9) * 0.018; break;
    case "stretch": actor.root.position.y = Math.max(0, Math.sin(phase * 1.1)) * 0.028; pose.rotation.x -= 0.025; break;
  }
};

export const resetProceduralMotion = (actor: OfficeActor): void => {
  actor.root.rotation.x = 0;
  actor.root.rotation.z = 0;
  actor.root.position.y = 0;
  resetGestureBone(actor);
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
