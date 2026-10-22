import type { MapModel, Pt, Spot } from "../../office2/types";
import { findPath, nearestFree } from "../../office2/pathfind";
import { CHARACTER_HEIGHT, type OfficeActor, play, settle } from "../engine/actors";
import type { Office3Bus } from "../core/bus";

const SPEED = 3.2;

export function walkTo(actor: OfficeActor, target: Spot | Pt, model: MapModel): void {
  const isSpot = "x" in target;
  const goal: Pt = isSpot ? [target.x, target.y] : target;
  actor.spot = isSpot ? target : null;
  const here: Pt = [Math.floor(actor.root.position.x), Math.floor(actor.root.position.z)];
  const free = model.blocked[goal[1]]?.[goal[0]] === false ? goal : nearestFree(model.blocked, goal, new Set());
  if (!free) return;
  actor.path = findPath(model.blocked, here, free);
  if (actor.path.length) play(actor, "walk"); else settle(actor);
}

export function updateNavigation(actor: OfficeActor, seconds: number, bus: Office3Bus): void {
  actor.mixer.update(seconds);
  if (!actor.path.length) return;
  const next = actor.path[0], targetX = next[0] + 0.5, targetZ = next[1] + 0.5, position = actor.root.position;
  const dx = targetX - position.x, dz = targetZ - position.z, distance = Math.hypot(dx, dz), step = SPEED * seconds;
  actor.root.rotation.y = Math.atan2(dx, dz);
  if (distance <= step) {
    position.x = targetX; position.z = targetZ; actor.tile = actor.path.shift()!;
    if (!actor.path.length) { settle(actor); bus.emit("actor.arrive", { slug: actor.person.slug }); }
  } else { position.x += dx / distance * step; position.z += dz / distance * step; }
  actor.ring.position.set(position.x, 0.03, position.z);
  actor.label.position.set(position.x, CHARACTER_HEIGHT + 0.35, position.z);
}
