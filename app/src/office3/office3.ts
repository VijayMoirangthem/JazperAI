import * as THREE from "three";
import type { LiveAgent } from "@/stores/liveAgentsStore";
import { hashParams } from "../office2/constants";
import { navigationModel, parseWorld } from "./core/world";
import { planSeats } from "../office2/people";
import type { Person } from "../office2/types";
import { Office3Bus } from "./core/bus";
import { addActor, removeActor, applyAppearance, applyCustomModel, play, setActorMood, setActorTask, type OfficeActor } from "./engine/actors";
import { layoutActorLabels } from "./engine/labels";
import { PrefabLoader } from "./engine/prefabs";
import { createRenderer } from "./engine/renderer";
import { addWorld, applyTheme } from "./engine/worldView";
import { CameraRig3D } from "./engine/cameraRig";
import { WallOcclusion } from "./engine/wallOcclusion";
import { LightingRig } from "./engine/lighting";
import { applyIncident, applyLiveStates, applySchedule, resolveAttention, wanderActors } from "./systems/director";
import { updateNavigation, walkTo } from "./systems/navigator";
import { EMOTES, type Emote } from "./core/emotes";
import { setActorState } from "./engine/actors";
import { applyIdleMotion, applyInteractionMotion, resetProceduralMotion } from "./motion";
import { pickActor } from "./engine/picking";
import { openContextMenu } from "./ui/ContextMenu";
import { clearSelection, selectionFromBox, toggleSelection } from "./core/selection";
import { createConversations } from "./core/conversations";
import { beginFollow, resolveCallOver, type CallOver, type FollowState } from "./core/follow";
import { evaluateZoneEntry } from "./core/zoneRules";
import { canUseInteraction, interactionMessage, nearestInteraction } from "./core/interactions";
import { planAgentMeetings } from "./core/agentMeetings";
import { fetchAgentThreads } from "./systems/agentLife";
import { BuilderOverlay } from "./engine/builderOverlay";
import { ZoneOverlay } from "./engine/zoneOverlay";
import { InteractionFx } from "./engine/fx";
import { themeById } from "./core/themes";
import { qualityForP95, qualitySettings, type QualityTier } from "./core/quality";
import { scheduledAction, type ScheduleAction } from "./core/schedule";
import { moodFor, rankColor, rankFor } from "./core/moods";
import type { ViewSettings } from "./ui/ViewSettings";
import { instantiateRoomTemplate, templateForRoomKind, type RoomTemplateId } from "./core/roomTemplates";
import { OfficeSync } from "./systems/sync";

export interface Office3Stats { fps: number; calls: number; triangles: number; people: number; loadedMs: number; p95Ms: number; heapMb: number | null }
export interface Office3Handle { ready: Promise<void>; setActive(active: boolean): void; setViewSettings(settings: ViewSettings): void; setTheme(id: string): void; setZoneOverlay(visible: boolean): void; setEditMode(enabled: boolean): void; setBuilderPrefab(id: string): void; insertRoomTemplate(roomId: string, template: RoomTemplateId): void; autoFurnishRoom(roomId: string): void; saveBuilderDraft(): void; sync(people: Person[]): void; setFounderAppearance(appearance: import("./core/appearance").Appearance): void; setFounderCustomModel(url: string): void; focusPerson(slug: string): void; resolveAttention(slug: string, approved: boolean): void; applyLive(live: Record<string, LiveAgent>): void; stats(): Office3Stats; destroy(): void; }
interface Office3DebugActor { slug: string; x: number; z: number; anim: string | null; place: string; state: string; look: string; tint: string }
interface Office3Debug { actors(): Office3DebugActor[]; camera(): { x: number; y: number; z: number; tx: number; ty: number; tz: number }; quality(): string; bus: { count(name: "actor.arrive" | "actor.anim" | "actor.state" | "perf.sample"): number } }
declare global { interface Window { __office3Stats?: Office3Stats; __officeFps?: number; __officePeople?: number; __office3Debug?: Office3Debug } }

export async function startOffice3(host: HTMLElement): Promise<Office3Handle> {
  const startedAt = performance.now();
  const persistedWorld = await fetch("/api/v1/office/world").then(async response => response.ok ? (await response.json()).world : null).catch(() => null);
  const world = parseWorld(persistedWorld ?? await fetch("/office3/world.json").then((response) => response.json()));
  world.theme = localStorage.getItem("office3.theme") || world.theme;
  const model = navigationModel(world);
  const view = createRenderer(host, model.width, model.height);
  const prefabs = new PrefabLoader(), actors = new Map<string, OfficeActor>(), bus = new Office3Bus(), conversations = createConversations();
  let network: OfficeSync | null = null, networkIdentity: string | null = null;
  const editorCursors = new Map<string, { marker: THREE.Mesh; seenAt: number }>();
  const socketUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/office/`;
  const startNetwork = (identity: string) => {
    if (networkIdentity === identity && network) return;
    network?.disconnect();
    networkIdentity = identity;
    network = new OfficeSync((event) => {
      const id = typeof event.id === "string" ? event.id : "";
      const actor = actors.get(id);
      if (event.type === "leave") { network?.forget(id); const cursor = editorCursors.get(id); cursor?.marker.removeFromParent(); cursor?.marker.geometry.dispose(); (cursor?.marker.material as THREE.Material | undefined)?.dispose(); editorCursors.delete(id); return; }
      if (id === networkIdentity) return;
      if (event.type === "cursor" && Number.isFinite(event.x) && Number.isFinite(event.z)) { let cursor = editorCursors.get(id); if (!cursor) { const marker = new THREE.Mesh(new THREE.RingGeometry(.28, .36, 20), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .9, side: THREE.DoubleSide })); marker.rotation.x = -Math.PI / 2; view.scene.add(marker); cursor = { marker, seenAt: performance.now() }; editorCursors.set(id, cursor); } cursor.marker.position.set(Number(event.x) + .5, .035, Number(event.z) + .5); cursor.seenAt = performance.now(); }
      if (!actor) return;
      if (event.type === "emote" && typeof event.value === "string") setActorState(actor, actor.state, event.value);
      if (event.type === "status" && typeof event.value === "string") setActorState(actor, event.value, actor.bubble);
    });
    network.connect(socketUrl, identity);
  };
  const follows: FollowState[] = []; const calls = new Map<string, CallOver>();
  const activeAgentMeetings = new Map<string, { from: string; to: string; expiresAt: number }>();
  const meetingLines = new Map<string, THREE.Line>();
  const meetingLineGroup = new THREE.Group(); view.scene.add(meetingLineGroup);
  const conversationHalos = new Map<string, THREE.Mesh>();
  const jobs = addWorld(view.scene, world, prefabs);
  applyTheme(view.scene, themeById(world.theme));
  const cameraRig = new CameraRig3D(view.camera, view.controls, world, bus);
  const builderOverlay = new BuilderOverlay(view.scene, world.size.w, world.size.h);
  const zoneOverlay = new ZoneOverlay(view.scene, world);
  const interactionFx = new InteractionFx(view.scene);
  let editMode = false, builderPrefab = "plant-v1";
  const builderObjects = new Map<string, THREE.Mesh>();
  const templateSeats: { id: string; room: string; pos: [number, number]; facing: "up" | "down" | "left" | "right"; owner: null }[] = [];
  const builderHistory: [string, THREE.Mesh][] = [], builderUndone: [string, THREE.Mesh][] = [];
  const deletedBuilderHistory: [string, THREE.Mesh][] = [], deletedBuilderUndone: [string, THREE.Mesh][] = [];
  let selectedBuilder: [string, THREE.Mesh] | null = null;
  const selectBuilderObject = (item: [string, THREE.Mesh] | null) => { if (selectedBuilder) ((selectedBuilder[1].material as THREE.MeshStandardMaterial).emissive.setHex(0)); selectedBuilder = item; if (selectedBuilder) (selectedBuilder[1].material as THREE.MeshStandardMaterial).emissive.setHex(0x1d4ed8); };
  const addBuilderObject = (key: string, prefab: string): THREE.Mesh | null => { if (builderObjects.has(key)) return null; const [x, z] = key.split(",").map(Number); if (!Number.isFinite(x) || !Number.isFinite(z)) return null; const mesh = new THREE.Mesh(new THREE.BoxGeometry(.8, .8, .8), new THREE.MeshStandardMaterial({ color: prefab.includes("plant") ? 0x22c55e : 0x60a5fa })); mesh.position.set(x + .5, .4, z + .5); mesh.userData.office3Prefab = prefab; view.scene.add(mesh); builderObjects.set(key, mesh); return mesh; };
  const insertTemplate = (roomId: string, template: RoomTemplateId) => { const room = world.rooms.find(item => item.id === roomId); if (!room) return; const plan = instantiateRoomTemplate(template, room); for (const object of plan.objects) addBuilderObject(object.pos.join(","), object.prefab); for (const seat of plan.seats) if (!world.seats.some(item => item.room === roomId && item.pos[0] === seat.pos[0] && item.pos[1] === seat.pos[1]) && !templateSeats.some(item => item.room === roomId && item.pos[0] === seat.pos[0] && item.pos[1] === seat.pos[1])) templateSeats.push({ id: `draft-seat-${roomId}-${seat.pos.join("-")}`, room: roomId, pos: seat.pos, facing: seat.facing, owner: null }); bus.emit("edit.command", { id: `template:${template}` }); };
  try { const draft = JSON.parse(localStorage.getItem("office3.builder.draft") ?? "null") as { objects?: { key: string; prefab: string }[]; seats?: typeof templateSeats } | null; for (const object of draft?.objects ?? []) addBuilderObject(object.key, object.prefab); if (Array.isArray(draft?.seats)) templateSeats.push(...draft.seats.filter(seat => typeof seat?.id === "string" && typeof seat.room === "string" && Array.isArray(seat.pos) && seat.pos.length === 2)); } catch { /* discard malformed local draft */ }
  const lighting = new LightingRig(view.scene, world.size.w, world.size.h);
  const speakerRing = new THREE.Mesh(new THREE.RingGeometry(.52, .62, 28), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .9, side: THREE.DoubleSide })); speakerRing.rotation.x = -Math.PI / 2; speakerRing.visible = false; view.scene.add(speakerRing);
  const incidentBanner = document.createElement("div"); incidentBanner.style.cssText = "position:absolute;z-index:24;top:3.5rem;left:50%;transform:translateX(-50%);display:none;border-radius:.5rem;background:#991b1bdd;padding:.4rem .75rem;color:#fff;font-size:12px;font-weight:600;pointer-events:none"; host.append(incidentBanner);
  const wallOcclusion = new WallOcclusion(view.scene);
  wallOcclusion.setTarget(view.controls.target);
  const founder = () => [...actors.values()].find((actor) => actor.person.kind === "human") ?? actors.values().next().value as OfficeActor | undefined;
  const updateMeetingLines = (now: number) => {
    for (const [thread, meeting] of activeAgentMeetings) {
      if (now >= meeting.expiresAt) { activeAgentMeetings.delete(thread); const line = meetingLines.get(thread); line?.removeFromParent(); line?.geometry.dispose(); (line?.material as THREE.Material | undefined)?.dispose(); meetingLines.delete(thread); continue; }
      const from = actors.get(meeting.from), to = actors.get(meeting.to); if (!from || !to) continue;
      let line = meetingLines.get(thread);
      if (!line) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3)); line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: .55 })); meetingLines.set(thread, line); meetingLineGroup.add(line); }
      const position = line.geometry.getAttribute("position") as THREE.BufferAttribute; position.setXYZ(0, from.root.position.x, 1.35, from.root.position.z); position.setXYZ(1, to.root.position.x, 1.35, to.root.position.z); position.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = .4 + Math.sin(now / 180) * .15;
    }
  };
  const updateConversationHalos = (groups: readonly string[][]) => {
    const next = new Set<string>();
    for (const group of groups) { const key = [...group].sort().join(":"); const members = group.map(slug => actors.get(slug)).filter((actor): actor is OfficeActor => Boolean(actor)); if (members.length < 2) continue; next.add(key); let halo = conversationHalos.get(key); if (!halo) { halo = new THREE.Mesh(new THREE.RingGeometry(.75, .83, 32), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: .45, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; conversationHalos.set(key, halo); view.scene.add(halo); } const x = members.reduce((sum, actor) => sum + actor.root.position.x, 0) / members.length, z = members.reduce((sum, actor) => sum + actor.root.position.z, 0) / members.length; halo.position.set(x, .025, z); halo.scale.setScalar(Math.max(1, Math.sqrt(members.length) * .85)); }
    for (const [key, halo] of conversationHalos) if (!next.has(key)) { halo.removeFromParent(); halo.geometry.dispose(); (halo.material as THREE.Material).dispose(); conversationHalos.delete(key); }
  };
  const interactionUse = new Map<string, number>();
  const useNearbyInteraction = (actor: OfficeActor) => {
    const found = nearestInteraction(world.objects, actor.tile);
    if (!found || !canUseInteraction(found.interaction, interactionUse.get(found.target.id) ?? -Infinity, performance.now(), actor.person.kind !== "human")) return false;
    interactionUse.set(found.target.id, performance.now());
    actor.root.userData.office3Interaction = found.interaction.id;
    setActorState(actor, "interacting", interactionMessage(found.interaction.id));
    interactionFx.spawn(found.interaction.id, actor.root.position.x, actor.root.position.z);
    bus.emit("interaction.done", { slug: actor.person.slug, id: found.interaction.id });
    window.dispatchEvent(new CustomEvent("office3:interaction", { detail: found.interaction.id }));
    window.setTimeout(() => { if (!actor.path.length) setActorState(actor, "idle", ""); delete actor.root.userData.office3Interaction; }, 1200);
    return true;
  };
  const walkToAllowed = (actor: OfficeActor, target: readonly [number, number]) => {
    const room = world.rooms.find((item) => target[0] >= item.rect[0] && target[0] <= item.rect[2] && target[1] >= item.rect[1] && target[1] <= item.rect[3]);
    if (!room) { walkTo(actor, target, model); return; }
    const occupancy = [...actors.values()].filter((item) => item !== actor && item.tile[0] >= room.rect[0] && item.tile[0] <= room.rect[2] && item.tile[1] >= room.rect[1] && item.tile[1] <= room.rect[3]).length;
    const rules = { ...room.rules, capacity: room.rules.capacity > 0 ? room.rules.capacity : undefined };
    const effects = evaluateZoneEntry(rules, actor.person.kind === "human" ? "founder" : "member", occupancy);
    if (effects.includes("block")) { setActorState(actor, actor.state, `${room.label} is unavailable`); return; }
    walkTo(actor, target, model);
    if (effects.includes("tooltip") && room.rules.tooltip) setActorState(actor, actor.state, room.rules.tooltip);
    else if (effects.includes("ambience") && room.rules.ambience && room.rules.ambience !== "none") setActorState(actor, actor.state, `${room.rules.ambience[0].toUpperCase()}${room.rules.ambience.slice(1)} zone`);
    else if (effects.includes("silent")) setActorState(actor, actor.state, "Quiet zone");
  };
  const onKey = (event: KeyboardEvent) => {
    if (!(document.activeElement === view.renderer.domElement || host.contains(document.activeElement))) return;
    const key = event.key.toLowerCase();
    if (editMode && event.ctrlKey && key === "z") { event.preventDefault(); const deleted = deletedBuilderHistory.pop(); if (deleted) { view.scene.add(deleted[1]); builderObjects.set(deleted[0], deleted[1]); deletedBuilderUndone.push(deleted); bus.emit("edit.undo", {}); return; } const item = builderHistory.pop(); if (item) { item[1].removeFromParent(); builderObjects.delete(item[0]); builderUndone.push(item); bus.emit("edit.undo", {}); } return; }
    if (editMode && event.ctrlKey && key === "y") { event.preventDefault(); const deleted = deletedBuilderUndone.pop(); if (deleted) { deleted[1].removeFromParent(); builderObjects.delete(deleted[0]); deletedBuilderHistory.push(deleted); bus.emit("edit.redo", {}); return; } const item = builderUndone.pop(); if (item) { view.scene.add(item[1]); builderObjects.set(item[0], item[1]); builderHistory.push(item); bus.emit("edit.redo", {}); } return; }
    if (editMode && (key === "delete" || key === "backspace")) { const item = selectedBuilder; if (item) { item[1].removeFromParent(); builderObjects.delete(item[0]); deletedBuilderHistory.push(item); deletedBuilderUndone.length = 0; selectBuilderObject(null); bus.emit("edit.command", { id: "delete" }); } return; }
    if (editMode && key === "r") { if (selectedBuilder) { selectedBuilder[1].rotation.y += Math.PI / 2; bus.emit("edit.command", { id: "rotate" }); } return; }
    if (key === "escape") { follows.splice(0); calls.clear(); }
    if (key === "escape") { applySelection(clearSelection()); return; }
    if (event.ctrlKey && key === "a") { event.preventDefault(); applySelection(new Set(actors.keys())); return; }
    if (key === "e") { const actor = founder(); if (actor) { event.preventDefault(); useNearbyInteraction(actor); } return; }
    if (event.altKey && /^[1-9]$/.test(key)) { const actor = founder(); const emote = Object.keys(EMOTES)[Number(key) - 1] as Emote | undefined; if (actor && emote) { const prior = actor.bubble; setActorState(actor, actor.state, EMOTES[emote]); bus.emit("emote", { slug: actor.person.slug, id: emote }); window.setTimeout(() => setActorState(actor, actor.state, prior), 2500); } return; }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      const actor = founder(); if (!actor) return;
      const strafe = key === "a" || key === "arrowleft" ? -1 : key === "d" || key === "arrowright" ? 1 : 0;
      const forward = key === "w" || key === "arrowup" ? 1 : key === "s" || key === "arrowdown" ? -1 : 0;
      const [dx, dz] = cameraRig.movementDelta(forward, strafe);
      if (dx || dz) { event.preventDefault(); walkToAllowed(actor, [actor.tile[0] + dx, actor.tile[1] + dz]); }
      return;
    }
    cameraRig.handle(key, event.shiftKey);
  };
  bus.on("follow.request", ({ from, to }) => { const next = beginFollow(follows, to, from, performance.now()); if (next) follows.push(next); });
  const raycaster = new THREE.Raycaster();
  let selected = clearSelection();
  let dragStart: { x: number; y: number } | null = null, ignoreClickUntil = 0;
  const selectionBox = document.createElement("div"); selectionBox.style.cssText = "position:absolute;z-index:25;border:1px solid #60a5fa;background:#3b82f633;pointer-events:none;display:none"; host.append(selectionBox);
  const interactionHint = document.createElement("div"); interactionHint.style.cssText = "position:absolute;z-index:24;left:50%;bottom:5.5rem;transform:translateX(-50%);display:none;border-radius:.5rem;background:#020617dd;padding:.35rem .6rem;color:#fff;font-size:12px;pointer-events:none"; host.append(interactionHint);
  const updateInteractionHint = () => { const actor = founder(); const nearby = actor && nearestInteraction(world.objects, actor.tile); interactionHint.style.display = nearby ? "block" : "none"; if (nearby) interactionHint.textContent = `Use E · ${nearby.interaction.id}`; };
  const applySelection = (next: Set<string>) => { selected = next; for (const item of actors.values()) item.ring.scale.setScalar(selected.has(item.person.slug) ? 1.35 : 1); bus.emit("select.change", { id: selected.values().next().value ?? null }); window.dispatchEvent(new CustomEvent("office3:selection", { detail: selected.size })); };
  const clearSelectionEvent = () => applySelection(clearSelection());
  const onClick = (event: MouseEvent) => {
    if (performance.now() < ignoreClickUntil) return;
    const picked = pickActor(event, view.renderer.domElement, view.camera, actors.values());
    if (picked) { applySelection(event.ctrlKey || event.shiftKey ? toggleSelection(selected, picked.person.slug) : new Set([picked.person.slug])); if (["waiting_human", "escalated"].includes(picked.state)) window.dispatchEvent(new CustomEvent("office3:attention", { detail: picked.person.slug })); return; }
    const actor = founder(); if (!actor) return;
    const bounds = view.renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (hit) { const goal: [number, number] = [Math.floor(hit.x), Math.floor(hit.z)]; if (editMode) { network?.cursor(goal[0], goal[1]); const key = goal.join(","), existing = builderObjects.get(key); if (existing) { selectBuilderObject([key, existing]); return; } const mesh = addBuilderObject(key, builderPrefab); if (mesh) { const item: [string, THREE.Mesh] = [key, mesh]; builderHistory.push(item); builderUndone.length = 0; selectBuilderObject(item); bus.emit("edit.command", { id: `place:${builderPrefab}` }); } return; } walkToAllowed(actor, goal); }
  };
  let hovered: OfficeActor | null = null;
  const onPointerMove = (event: MouseEvent) => { const bounds = view.renderer.domElement.getBoundingClientRect(); if (dragStart) { const x = event.clientX - bounds.left, y = event.clientY - bounds.top; selectionBox.style.display = "block"; selectionBox.style.left = `${Math.min(x, dragStart.x)}px`; selectionBox.style.top = `${Math.min(y, dragStart.y)}px`; selectionBox.style.width = `${Math.abs(x - dragStart.x)}px`; selectionBox.style.height = `${Math.abs(y - dragStart.y)}px`; } raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera); const floorHit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (editMode && floorHit) builderOverlay.preview(floorHit.x, floorHit.z, !builderObjects.has(`${Math.floor(floorHit.x)},${Math.floor(floorHit.z)}`)); const next = pickActor(event, view.renderer.domElement, view.camera, actors.values()) ?? null; if (hovered === next) return; if (hovered) hovered.ring.scale.setScalar(1); hovered = next; if (hovered) hovered.ring.scale.setScalar(1.35); };
  const onPointerDown = (event: MouseEvent) => { if (event.shiftKey && !editMode) { const bounds = view.renderer.domElement.getBoundingClientRect(); dragStart = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; } };
  const onPointerUp = (event: MouseEvent) => { if (!dragStart) return; const bounds = view.renderer.domElement.getBoundingClientRect(), end = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; if (Math.hypot(end.x - dragStart.x, end.y - dragStart.y) > 6) { const projected = [...actors.values()].map(item => { const point = item.root.position.clone().project(view.camera); return { id: item.person.slug, x: (point.x + 1) * .5 * bounds.width, y: (1 - point.y) * .5 * bounds.height }; }); applySelection(selectionFromBox(projected, { left: dragStart.x, top: dragStart.y, right: end.x, bottom: end.y })); ignoreClickUntil = performance.now() + 80; } dragStart = null; selectionBox.style.display = "none"; };
  const onContextMenu = (event: MouseEvent) => { event.preventDefault(); const actor = pickActor(event, view.renderer.domElement, view.camera, actors.values()); if (actor) openContextMenu(host, actor, event.clientX - host.getBoundingClientRect().left, event.clientY - host.getBoundingClientRect().top, (action, target) => { bus.emit("ctx.action", { id: target.person.slug, action }); if (action === "view-card") { window.dispatchEvent(new CustomEvent("office3:visit-card", { detail: { slug: target.person.slug, name: target.person.name, kind: target.person.kind, state: target.state } })); } else if (action === "go-to") { const self = founder(); if (self) walkToAllowed(self, [target.tile[0] + 1, target.tile[1]]); } else if (action === "follow") { const self = founder(); if (self) bus.emit("follow.request", { from: self.person.slug, to: target.person.slug }); } else if (action === "message") { const self = founder(); if (self) window.dispatchEvent(new CustomEvent("office3:open-conversation", { detail: [self.person, target.person] })); } else if (action === "call-over") { const self = founder(); if (self) { calls.set(target.person.slug, { slug: target.person.slug, origin: [...target.tile] as [number, number], requestedAt: performance.now(), status: "walking" }); walkToAllowed(target, self.tile); bus.emit("call.request", { slug: target.person.slug }); } } else if (action === "wave") { const prior = target.bubble; setActorState(target, target.state, EMOTES.wave); window.setTimeout(() => setActorState(target, target.state, prior), 1800); } }); };
  view.renderer.domElement.addEventListener("click", onClick);
  view.renderer.domElement.addEventListener("contextmenu", onContextMenu);
  view.renderer.domElement.addEventListener("mousemove", onPointerMove);
  view.renderer.domElement.addEventListener("mousedown", onPointerDown);
  view.renderer.domElement.addEventListener("mouseup", onPointerUp);
  window.addEventListener("keydown", onKey);
  window.addEventListener("office3:clear-selection", clearSelectionEvent);
  const names: string[] = await fetch("/office3/characters/index.json").then((response) => response.json());
  const sync = (people: Person[]) => {
    const self = people.find(person => person.kind === "human");
    if (self) startNetwork(self.slug);
    const wanted = new Set(people.map((person) => person.slug));
    for (const [slug, actor] of actors) if (!wanted.has(slug)) { removeActor(view.scene, actor); actors.delete(slug); }
    const seats = planSeats(people, model.spots);
    for (const person of people) if (!actors.has(person.slug)) void addActor(view.scene, actors, prefabs, names, person, seats.get(person.slug)!);
  };
  const stats: Office3Stats = { fps: 0, calls: 0, triangles: 0, people: 0, loadedMs: 0, p95Ms: 0, heapMb: null };
  let quality: QualityTier = "high";
  let automaticQuality = true;
  const clock = new THREE.Clock();
  let active = true, frame = 0, sampleElapsed = 0, sampleFrames = 0, wanderElapsed = 0, conversationElapsed = 0, agentLifeElapsed = 0, scheduleElapsed = 0, speakerElapsed = 0, incidentElapsed = 0, networkElapsed = 0, speakerIndex = 0, qualityChangedAt = performance.now(), activeSchedule: ScheduleAction = null;
  let labelMode: "all" | "near" | "hover" | "off" = "all", reducedMotion = false;
  const farActorUpdatedAt = new Map<string, number>();
  let taskElapsed = 0;
  const frameMs: number[] = [];
  const wandering = hashParams().get("wander") === "1";
  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (!active) return;
    const seconds = Math.min(clock.getDelta(), 0.1);
    frameMs.push(seconds * 1000);
    if ((networkElapsed += seconds) >= .2) { networkElapsed = 0; const self = networkIdentity && actors.get(networkIdentity); if (self) network?.move(self.root.position.x, self.root.position.z, self.root.rotation.y, self.current ?? "idle"); }
    if (network && networkIdentity) for (const actor of actors.values()) { if (actor.person.slug === networkIdentity) continue; const position = network.interpolated(actor.person.slug); if (!position) continue; actor.root.position.set(position.x, actor.root.position.y, position.z); actor.ring.position.set(position.x, .03, position.z); actor.label.position.set(position.x, 2.45, position.z); actor.tile = [Math.floor(position.x), Math.floor(position.z)]; actor.root.rotation.y = position.facing; play(actor, position.anim === "walk" ? "walk" : "idle"); }
    for (const actor of actors.values()) { const far = actor.root.position.distanceTo(view.camera.position) > 45; const interval = far ? 1 / qualitySettings(quality).farAnimationHz : 0; const now = performance.now(); if (interval && now - (farActorUpdatedAt.get(actor.person.slug) ?? 0) < interval * 1000) continue; farActorUpdatedAt.set(actor.person.slug, now); updateNavigation(actor, seconds, bus); const interaction = actor.root.userData.office3Interaction as import("./core/interactions").InteractionId | undefined; if (reducedMotion) resetProceduralMotion(actor); else if (interaction) applyInteractionMotion(actor, interaction, now / 1000); else applyIdleMotion(actor, now / 1000); }
    for (const follow of follows) { const leader = actors.get(follow.leader), follower = actors.get(follow.follower); if (leader && follower && !follower.path.length) walkTo(follower, [leader.tile[0], leader.tile[1] + 1], model); }
    for (const [slug, call] of calls) { const target = actors.get(slug), self = founder(); if (!target || !self) { calls.delete(slug); continue; } const next = resolveCallOver(call, performance.now(), Math.hypot(target.tile[0] - self.tile[0], target.tile[1] - self.tile[1])); calls.set(slug, next); if (next.status === "arrived") { setActorState(target, "waiting_human", "Anything else?"); bus.emit("call.arrive", { slug }); calls.delete(slug); } else if (next.status === "timed-out") calls.delete(slug); }
    if ((agentLifeElapsed += seconds) >= 3) { agentLifeElapsed = 0; void fetchAgentThreads().then(threads => { const meetings = planAgentMeetings(threads, [...actors.values()].filter(actor => actor.person.kind !== "human").map(actor => ({ slug: actor.person.slug, tile: actor.tile, busy: actor.path.length > 0 })), activeAgentMeetings.size); for (const meeting of meetings) { const from = actors.get(meeting.from), to = actors.get(meeting.to); if (!from || !to || activeAgentMeetings.has(meeting.thread)) continue; activeAgentMeetings.set(meeting.thread, { from: meeting.from, to: meeting.to, expiresAt: performance.now() + 8000 }); walkTo(from, meeting.point, model); walkTo(to, meeting.point, model); setActorState(from, from.state, meeting.text); } }).catch(() => undefined); }
    if ((taskElapsed += seconds) >= 5) { taskElapsed = 0; void fetch("/api/hive/tasks").then(response => response.ok ? response.json() : {}).then((board: Record<string, { title?: string; assignee?: string }[]>) => { const tasks = Object.entries(board).flatMap(([status, entries]) => entries.map(task => ({ ...task, status }))); for (const actor of actors.values()) { const assigned = tasks.filter(item => item.assignee === actor.person.slug || item.assignee === actor.person.name); const task = assigned.find(item => item.status === "doing") ?? assigned[0]; setActorTask(actor, task?.title ?? ""); if (actor.person.kind !== "human") { const completed = assigned.filter(item => item.status === "done").length, failures = assigned.filter(item => item.status === "blocked").length; const mood = moodFor(completed, failures, assigned.length), rank = rankFor(completed); setActorMood(actor, ({ focused: "◉", happy: "☺", strained: "!", tired: "…" })[mood], rankColor(rank)); } } }).catch(() => undefined); }
    if ((scheduleElapsed += seconds) >= 5) { scheduleElapsed = 0; const simulated = hashParams().get("now")?.match(/^(\d{1,2}):(\d{2})$/); const now = new Date(), hour = simulated ? Number(simulated[1]) : now.getHours(), minute = simulated ? Number(simulated[2]) : now.getMinutes(), next = scheduledAction(hour, minute); if (next !== activeSchedule) { if (activeSchedule === "standup") { bus.emit("meeting.end", { room: "meeting" }); speakerRing.visible = false; } activeSchedule = next; applySchedule(actors, model, next); if (next === "standup") bus.emit("meeting.start", { room: "meeting" }); } }
    if (activeSchedule === "standup" && (speakerElapsed += seconds) >= 3) { speakerElapsed = 0; const attendees = [...actors.values()].filter(actor => actor.person.kind !== "human" && actor.place === "meeting"); const speakers = attendees.filter(actor => !actor.path.length); const speaker = (speakers.length ? speakers : attendees)[speakerIndex++ % Math.max(1, speakers.length || attendees.length)]; if (speaker) { cameraRig.focusPoint(speaker.root.position.x, speaker.root.position.z); speakerRing.position.set(speaker.root.position.x, .04, speaker.root.position.z); speakerRing.visible = true; setActorState(speaker, speaker.state, "Speaking"); window.setTimeout(() => { if (speaker.bubble === "Speaking") setActorState(speaker, speaker.state, ""); }, 1800); bus.emit("meeting.speaker", { slug: speaker.person.slug }); } }
    if ((incidentElapsed += seconds) >= 15) { incidentElapsed = 0; void fetch("/api/v1/alerts/").then(response => response.ok ? response.json() : { open: [] }).then((alerts: { open?: { title?: string }[] }) => { const activeIncident = Boolean(alerts.open?.length); lighting.setIncident(activeIncident); incidentBanner.style.display = activeIncident ? "block" : "none"; incidentBanner.textContent = activeIncident ? `Incident: ${alerts.open?.[0]?.title ?? "Attention required"}` : ""; applyIncident(actors, model, activeIncident); }).catch(() => undefined); }
    const cursorNow = performance.now(); for (const [id, cursor] of editorCursors) if (cursorNow - cursor.seenAt > 5000) { cursor.marker.removeFromParent(); cursor.marker.geometry.dispose(); (cursor.marker.material as THREE.Material).dispose(); editorCursors.delete(id); } updateMeetingLines(cursorNow); interactionFx.update(cursorNow);
    layoutActorLabels(actors.values(), view.camera, view.renderer.domElement.clientWidth, view.renderer.domElement.clientHeight, labelMode);
    updateInteractionHint();
    if ((conversationElapsed += seconds) >= .25) { conversationElapsed = 0; const update = conversations.update([...actors.values()].map(item => ({ id: item.person.slug, tile: item.tile, walking: item.path.length > 0, silent: false, dnd: item.state === "dnd", focus: item.state === "focus" }))); updateConversationHalos(update.groups); for (const slug of update.joined) bus.emit("conv.join", { slug }); for (const slug of update.left) bus.emit("conv.leave", { slug }); const self = founder(); const group = self && update.groups.find(item => item.includes(self.person.slug)); if (group) { const members = group.map(slug => actors.get(slug)?.person).filter(Boolean); window.dispatchEvent(new CustomEvent("office3:conversation-group", { detail: members })); } }
    if (wandering && (wanderElapsed += seconds) > 1) { wanderElapsed = 0; wanderActors(actors, model); }
    lighting.update(); view.controls.update(); wallOcclusion.setTarget(view.controls.target); wallOcclusion.update(view.camera); view.renderer.render(view.scene, view.camera);
    sampleElapsed += seconds; sampleFrames++;
    if (sampleElapsed >= 1) {
      const fps = Math.round(sampleFrames / sampleElapsed);
      const sorted = frameMs.sort((a, b) => a - b);
      const p95Ms = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
      const nextQuality = automaticQuality ? qualityForP95(p95Ms, quality) : quality; if (nextQuality !== quality && performance.now() - qualityChangedAt >= 30000) { quality = nextQuality; qualityChangedAt = performance.now(); view.setQuality(quality); }
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      Object.assign(stats, { fps, calls: view.renderer.info.render.calls, triangles: view.renderer.info.render.triangles, people: actors.size, p95Ms: Math.round(p95Ms * 100) / 100, heapMb: heap === undefined ? null : Math.round(heap / 1048576 * 10) / 10 });
      window.__officeFps = fps; window.__officePeople = actors.size; window.__office3Stats = { ...stats };
      bus.emit("perf.sample", { fps: stats.fps, calls: stats.calls, triangles: stats.triangles, people: stats.people, p95Ms: stats.p95Ms, heapMb: stats.heapMb }); sampleElapsed = 0; sampleFrames = 0; frameMs.length = 0;
    }
  };
  loop();
  const observer = new ResizeObserver(view.resize); observer.observe(host);
  window.__office3Debug = {
    actors: () => [...actors.values()].map((actor) => ({ slug: actor.person.slug, x: actor.root.position.x, z: actor.root.position.z, anim: actor.current, place: actor.place, state: actor.state, look: actor.appearance.look, tint: actor.appearance.tints.top })),
    camera: () => ({ x: view.camera.position.x, y: view.camera.position.y, z: view.camera.position.z, tx: view.controls.target.x, ty: view.controls.target.y, tz: view.controls.target.z }),
    quality: () => quality, bus: { count: (name) => bus.count(name) },
  };
  const ready = Promise.all(jobs).then(() => { stats.loadedMs = Math.round(performance.now() - startedAt); });
  return {
    ready, sync, focusPerson: (slug) => { const actor = actors.get(slug); if (actor) { cameraRig.focusPoint(actor.root.position.x, actor.root.position.z); } }, setFounderAppearance: (appearance) => { const actor = founder(); if (actor) { applyAppearance(actor, appearance); localStorage.setItem("office3.appearance", JSON.stringify(appearance)); } }, setFounderCustomModel: (url) => { const actor = founder(); if (actor) void applyCustomModel(actor, prefabs, url).catch(() => undefined); }, resolveAttention: (slug, approved) => resolveAttention(actors, model, slug, approved), applyLive: (live) => applyLiveStates(actors, model, live, bus), stats: () => ({ ...stats }),
    setActive: (next) => { active = next; if (next) clock.getDelta(); },
    setViewSettings: (settings) => { wallOcclusion.setMode(settings.walls as "auto" | "cutaway" | "full"); lighting.setMode(settings.lighting as import("./core/dayclock").LightingMode); labelMode = settings.labels as typeof labelMode; reducedMotion = settings.reducedMotion; automaticQuality = settings.quality === "auto"; if (!automaticQuality) { quality = settings.quality as QualityTier; qualityChangedAt = performance.now(); view.setQuality(quality); } },
    setTheme: (id) => { const theme = themeById(id); world.theme = theme.id; applyTheme(view.scene, theme); lighting.setMode(theme.light); localStorage.setItem("office3.theme", theme.id); },
    setZoneOverlay: (visible) => zoneOverlay.setVisible(visible),
    setEditMode: (enabled) => { editMode = enabled; builderOverlay.setEnabled(enabled); if (enabled) bus.emit("edit.enter", {}); else bus.emit("edit.exit", {}); },
    setBuilderPrefab: (id) => { builderPrefab = id; },
    insertRoomTemplate: insertTemplate, autoFurnishRoom: (roomId) => { const room = world.rooms.find(item => item.id === roomId); if (room) insertTemplate(roomId, templateForRoomKind(room.kind)); },
    saveBuilderDraft: () => { localStorage.setItem("office3.builder.draft", JSON.stringify({ v: 1, savedAt: Date.now(), objects: [...builderObjects].map(([key, mesh]) => ({ key, prefab: String(mesh.userData.office3Prefab ?? "unknown") })), seats: templateSeats })); },
    destroy: () => { cancelAnimationFrame(frame); network?.disconnect(); observer.disconnect(); window.removeEventListener("keydown", onKey); window.removeEventListener("office3:clear-selection", clearSelectionEvent); view.renderer.domElement.removeEventListener("click", onClick); view.renderer.domElement.removeEventListener("contextmenu", onContextMenu); view.renderer.domElement.removeEventListener("mousemove", onPointerMove); view.renderer.domElement.removeEventListener("mousedown", onPointerDown); view.renderer.domElement.removeEventListener("mouseup", onPointerUp); selectionBox.remove(); interactionHint.remove(); interactionFx.dispose(); incidentBanner.remove(); speakerRing.removeFromParent(); speakerRing.geometry.dispose(); (speakerRing.material as THREE.Material).dispose(); for (const line of meetingLines.values()) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); } for (const halo of conversationHalos.values()) { halo.geometry.dispose(); (halo.material as THREE.Material).dispose(); } for (const cursor of editorCursors.values()) { cursor.marker.removeFromParent(); cursor.marker.geometry.dispose(); (cursor.marker.material as THREE.Material).dispose(); } meetingLineGroup.removeFromParent(); cameraRig.dispose(); builderOverlay.dispose(); zoneOverlay.dispose(); view.dispose(); window.__officeFps = undefined; window.__officePeople = undefined; window.__office3Stats = undefined; },
  };
}
