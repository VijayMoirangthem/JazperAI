import type { LiveAgent } from "../../stores/liveAgentsStore";
import { assignSpot, placeFor } from "../../office2/behavior";
import type { MapModel } from "../../office2/types";
import { setActorState, type OfficeActor } from "../engine/actors";
import { walkTo } from "./navigator";
import type { Office3Bus } from "../core/bus";
import { mayScheduleMove, type ScheduleAction } from "../core/schedule";

export function applyLiveStates(actors: Map<string, OfficeActor>, model: MapModel, live: Record<string, LiveAgent>, bus: Office3Bus): void {
  for (const [slug, state] of Object.entries(live)) {
    const actor = actors.get(slug);
    if (!actor) continue;
    const bubble = state.state !== "idle" ? (state.bubble ?? state.reason ?? "") : "";
    if (actor.state !== state.state) { setActorState(actor, state.state, bubble); bus.emit("actor.state", { slug, state: state.state }); }
    else if (actor.bubble !== bubble) setActorState(actor, state.state, bubble);
    if (actor.person.kind === "human") continue;
    if (state.state === "waiting_human" || state.state === "escalated") {
      const founder = [...actors.values()].find(item => item.person.kind === "human");
      if (founder) { actor.place = "founder"; walkTo(actor, [founder.tile[0] + 1, founder.tile[1] + 1], model); }
      continue;
    }
    const place = placeFor(state.state, new Date().getHours());
    if (place === actor.place) continue;
    actor.place = place;
    if (place === "desk") { walkTo(actor, actor.home, model); continue; }
    const taken = new Set([...actors.values()].filter((other) => other !== actor).map((other) => other.tile.join(",")));
    const spots = (room: string) => model.spots.filter((spot) => spot.room === room && spot.type === "spot");
    const destination = assignSpot(spots(place), taken, slug) ?? assignSpot(spots("corridor"), taken, slug);
    if (destination) walkTo(actor, destination, model);
  }
}

export function resolveAttention(actors: Map<string, OfficeActor>, model: MapModel, slug: string, approved: boolean): void {
  const actor = actors.get(slug);
  if (!actor) return;
  setActorState(actor, "idle", approved ? "Approved ✓" : "Declined");
  window.setTimeout(() => { if (actor.state === "idle") setActorState(actor, "idle", ""); }, 2200);
  actor.place = "desk";
  walkTo(actor, actor.home, model);
}

export function applyIncident(actors: Map<string, OfficeActor>, model: MapModel, active: boolean): void {
  if (!active) return;
  const destination = model.spots.find(spot => spot.room === "tools" && spot.type === "spot") ?? model.spots.find(spot => spot.room === "tools");
  if (!destination) return;
  for (const actor of actors.values()) {
    if (actor.person.kind === "human" || actor.state === "waiting_human" || actor.state === "escalated") continue;
    if (actor.state === "error" || actor.state === "working" || actor.person.slug.includes("sentry") || actor.person.slug.includes("ops")) walkTo(actor, destination, model);
  }
}

export function wanderActors(actors: Map<string, OfficeActor>, model: MapModel): void {
  for (const actor of actors.values()) {
    if (actor.person.slug.startsWith("sim-") && !actor.path.length && Math.random() < 0.25) {
      walkTo(actor, model.spots[Math.floor(Math.random() * model.spots.length)], model);
    }
  }
}

export function applySchedule(actors: Map<string, OfficeActor>, model: MapModel, action: ScheduleAction): void {
  if (!action) {
    for (const actor of actors.values()) {
      if (actor.person.kind === "human" || !mayScheduleMove({ kind: "agent", state: actor.state })) continue;
      if (actor.place !== "meeting" && actor.place !== "lounge") continue;
      actor.place = "desk";
      walkTo(actor, actor.home, model);
    }
    return;
  }
  const room = action === "standup" ? "meeting" : action === "lunch" ? "social" : "work";
  const type = action === "standup" ? "seat" : "spot";
  // Reserve each selected destination as we go: a stand-up should distribute
  // attendees across seats rather than pathing every agent to the first one.
  const reserved = new Set<string>();
  const destinations = model.spots.filter(item => item.room === room && item.type === type);
  for (const actor of actors.values()) {
    if (actor.person.kind === "human" || !mayScheduleMove({ kind: "agent", state: actor.state })) continue;
    const spot = assignSpot(destinations, reserved, actor.person.slug);
    if (!spot) continue;
    reserved.add(`${spot.x},${spot.y}`);
    actor.place = action === "standup" ? "meeting" : action === "lunch" ? "lounge" : "desk";
    walkTo(actor, spot, model);
  }
}
