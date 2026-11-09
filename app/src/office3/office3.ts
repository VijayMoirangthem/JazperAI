import * as THREE from "three";
import type { LiveAgent } from "@/stores/liveAgentsStore";
import { hashParams } from "../office2/constants";
import { navigationModel, parseWorld } from "./core/world";
import { planSeats } from "../office2/people";
import type { Person } from "../office2/types";
import { Office3Bus } from "./core/bus";
import { loadJournal, saveJournal } from "./core/historyStore";
import { addActor, removeActor, applyAppearance, applyCustomModel, placeActor, play, settle, setActorLod, setActorMood, setActorTask, type ActorAnimation, type OfficeActor } from "./engine/actors";
import { layoutActorLabels } from "./engine/labels";
import { PrefabLoader } from "./engine/prefabs";
import { createRenderer } from "./engine/renderer";
import { addWorld, applyTheme, applyWorldObjectTransform, updateDoors } from "./engine/worldView";
import { CameraRig3D } from "./engine/cameraRig";
import { WallOcclusion } from "./engine/wallOcclusion";
import { OfficeAudio } from "./engine/audio";
import { LightingRig } from "./engine/lighting";
import { applyIncident, applyLiveStates, applySchedule, resolveAttention, wanderActors } from "./systems/director";
import { updateNavigation, walkTo } from "./systems/navigator";
import { EMOTES, type Emote } from "./core/emotes";
import { setActorState } from "./engine/actors";
import { applyEmoteMotion, applyIdleMotion, applyInteractionMotion, resetProceduralMotion } from "./motion";
import { pickActor, pickWorldObject } from "./engine/picking";
import { openContextMenu, openFloorContextMenu, openObjectContextMenu, openRoomContextMenu } from "./ui/ContextMenu";
import { clearSelection, selectionFromBox, toggleSelection } from "./core/selection";
import { createConversations } from "./core/conversations";
import { beginFollow, resolveCallOver, type CallOver, type FollowState } from "./core/follow";
import { evaluateZoneEntry } from "./core/zoneRules";
import { canUseInteraction, interactionForPrefab, interactionMessage, nearestInteraction } from "./core/interactions";
import { planAgentMeetings, queuedAgentThreads } from "./core/agentMeetings";
import { fetchAgentThreadMessages, fetchAgentThreads } from "./systems/agentLife";
import { BuilderOverlay } from "./engine/builderOverlay";
import { ZoneOverlay } from "./engine/zoneOverlay";
import { InteractionFx } from "./engine/fx";
import { themeById } from "./core/themes";
import { qualityForP95, qualitySettings, type QualityTier } from "./core/quality";
import { createFrameBenchmark, type FrameBenchmarkResult } from "./core/benchmark";
import { safeStorage } from "./core/storage";
import { loadOfficePersonSession, officePersonAuthHeaders } from "./core/auth";
import { scheduledAction, type ScheduleAction } from "./core/schedule";
import { moodFor, rankColor, rankFor } from "./core/moods";
import type { ViewSettings } from "./ui/ViewSettings";
import { instantiateRoomTemplate, templateForRoomKind, type RoomTemplateId } from "./core/roomTemplates";
import { OfficeSync } from "./systems/sync";
import { inWorldBounds, overlapsBlockingObject, type BuilderObject } from "./core/builder";
import { rotatedFootprint } from "./core/catalog";
import { shouldSkipFrame } from "../lib/perfRuntime";

export interface Office3Stats { fps: number; calls: number; triangles: number; people: number; loadedMs: number; p95Ms: number; heapMb: number | null }
export interface Office3Handle { ready: Promise<void>; setActive(active: boolean): void; setViewSettings(settings: ViewSettings): void; setTheme(id: string): void; setZoneOverlay(visible: boolean): void; setEditMode(enabled: boolean): void; setPhotoMode(enabled: boolean): void; capturePng(transparent?: boolean): string; setBuilderPrefab(id: string): void; insertRoomTemplate(roomId: string, template: RoomTemplateId): void; autoFurnishRoom(roomId: string): void; applyRoomRules(roomId: string, rules: import("./core/world").World["rooms"][number]["rules"]): void; applyRoomRect(roomId: string, rect: [number, number, number, number]): void; applyObjectTransform(id: string, patch: Partial<Pick<import("./core/world").World["objects"][number], "pos" | "rot" | "scale">>): void; setFounderSpawn(position: [number, number]): void; saveBuilderDraft(): void; sync(people: Person[]): void; setFounderAppearance(appearance: import("./core/appearance").Appearance): void; setFounderCustomModel(url: string): Promise<void>; rooms(): { id: string; label: string; kind: string }[]; focusPerson(slug: string): void; focusRoom(id: string): void; focusPoint(x: number, z: number): void; resolveAttention(slug: string, approved: boolean): void; applyLive(live: Record<string, LiveAgent>): void; stats(): Office3Stats; destroy(): void; }
interface Office3DebugActor { slug: string; kind: Person["kind"]; x: number; z: number; anim: string | null; place: string; state: string; look: string; tint: string }
interface Office3Debug { actors(): Office3DebugActor[]; camera(): { x: number; y: number; z: number; tx: number; ty: number; tz: number }; quality(): string; bus: { count(name: "actor.arrive" | "actor.anim" | "actor.state" | "perf.sample"): number } }
declare global { interface Window { __office3Stats?: Office3Stats; __officeFps?: number; __officePeople?: number; __office3Benchmark?: FrameBenchmarkResult & { screenshot: string }; __office3Debug?: Office3Debug } }

export async function startOffice3(host: HTMLElement): Promise<Office3Handle> {
  const startedAt = performance.now();
  const benchmark = hashParams().get("bench") === "1" ? createFrameBenchmark() : null;
  let benchmarkPublished = false;
  const persistedWorld = await fetch("/api/v1/office/world").then(async response => response.ok ? (await response.json()).world : null).catch(() => null);
  const world = parseWorld(persistedWorld ?? await fetch("/office3/world.json").then((response) => response.json()));
  world.theme = localStorage.getItem("office3.theme") || world.theme;
  const model = navigationModel(world);
  const view = createRenderer(host, model.width, model.height);
  const actorProxyInstances = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.24, .82, 3, 8), new THREE.MeshStandardMaterial({ roughness: .82, metalness: 0, vertexColors: true }), 256);
  actorProxyInstances.frustumCulled = false;
  actorProxyInstances.count = 0;
  view.scene.add(actorProxyInstances);
  const actorProxyActors = new Map<number, OfficeActor>();
  actorProxyInstances.userData.officeActorInstances = actorProxyActors;
  const proxyMatrix = new THREE.Matrix4(), proxyPosition = new THREE.Vector3(), proxyScale = new THREE.Vector3(1, 1, 1), proxyRotation = new THREE.Quaternion();
  const disposeRenderer = view.dispose;
  view.dispose = () => { actorProxyInstances.removeFromParent(); actorProxyInstances.geometry.dispose(); (actorProxyInstances.material as THREE.Material).dispose(); for (const mesh of (view.scene.userData.office3WorldInstanceRoots as THREE.InstancedMesh[] | undefined) ?? []) { mesh.removeFromParent(); mesh.geometry.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose()); else mesh.material.dispose(); } disposeRenderer(); };
  const prefabs = new PrefabLoader(), actors = new Map<string, OfficeActor>(), bus = new Office3Bus(), conversations = createConversations();
  const deskPlantPots = new THREE.InstancedMesh(new THREE.CylinderGeometry(.11, .15, .24, 8), new THREE.MeshStandardMaterial({ color: 0x9a4d2e, roughness: .8 }), 256);
  const deskPlantLeaves = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.18, 0), new THREE.MeshStandardMaterial({ color: 0x3f8f57, roughness: .7 }), 256);
  deskPlantPots.name = "office3-desk-plant-pots"; deskPlantLeaves.name = "office3-desk-plant-leaves"; deskPlantPots.castShadow = deskPlantLeaves.castShadow = true; deskPlantPots.receiveShadow = deskPlantLeaves.receiveShadow = true; deskPlantPots.count = deskPlantLeaves.count = 0; view.scene.add(deskPlantPots, deskPlantLeaves);
  const refreshDeskPlants = () => { let count = 0; const matrix = new THREE.Matrix4(); for (const actor of actors.values()) { if (actor.person.kind === "human" || count >= 256) continue; const x = actor.home.x + .25, z = actor.home.y + .25; matrix.makeTranslation(x, .12, z); deskPlantPots.setMatrixAt(count, matrix); matrix.makeTranslation(x, .39, z); deskPlantLeaves.setMatrixAt(count, matrix); count++; } deskPlantPots.count = deskPlantLeaves.count = count; deskPlantPots.instanceMatrix.needsUpdate = deskPlantLeaves.instanceMatrix.needsUpdate = true; };
  const pausedAgents = new Set<string>((() => { try { const value = JSON.parse(safeStorage.get("office3.paused-agents") ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } })());
  const savePausedAgents = () => safeStorage.set("office3.paused-agents", JSON.stringify([...pausedAgents].sort()));
  const saveAgentControl = (slug: string, paused: boolean) => void fetch(`/api/v1/office/agent-controls/${encodeURIComponent(slug)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ paused }) }).catch(() => undefined);
  void fetch("/api/v1/office/agent-controls", { headers: officePersonAuthHeaders() }).then(response => response.ok ? response.json() : null).then(value => {
    if (!Array.isArray(value?.controls)) return;
    for (const item of value.controls) if (typeof item?.slug === "string") { if (item.paused) pausedAgents.add(item.slug); else pausedAgents.delete(item.slug); }
    savePausedAgents();
    for (const actor of actors.values()) if (actor.person.kind !== "human") { if (pausedAgents.has(actor.person.slug)) { actor.path.length = 0; setActorState(actor, "paused", "Paused by founder"); } else if (actor.state === "paused") setActorState(actor, "idle", ""); }
  }).catch(() => undefined);
  let network: OfficeSync | null = null, networkIdentity: string | null = null;
  const editorCursors = new Map<string, { marker: THREE.Mesh; seenAt: number }>();
  const officeSocketToken = process.env.NEXT_PUBLIC_OFFICE_WS_TOKEN ?? "";
  const socketUrl = (identity: string) => { const query = new URLSearchParams(); if (officeSocketToken) query.set("token", officeSocketToken); const session = loadOfficePersonSession(); if (session?.personId === identity) query.set("person_token", session.accessToken); const suffix = query.size ? `?${query.toString()}` : ""; return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/office/${suffix}`; };
  const startNetwork = (identity: string) => {
    if (networkIdentity === identity && network) return;
    network?.disconnect();
    networkIdentity = identity;
    network = new OfficeSync((event) => {
      const id = typeof event.id === "string" ? event.id : "";
      const actor = actors.get(id);
      if (event.type === "connect") { bus.emit("net.connect", {}); return; }
      if (event.type === "drop") { bus.emit("net.drop", {}); return; }
      if (event.type === "reconnecting") return;
      if (event.type === "rejoin") { bus.emit("net.rejoin", {}); return; }
      if (event.type === "conv.invite" && typeof event.id === "string") {
        const inviter = actors.get(event.id), self = founder();
        if (!inviter || !self || ["dnd", "focus", "paused", "busy"].includes(self.state) || self.path.length) { network?.respondToConversationInvite(event.id, "decline"); return; }
        incomingConversationInvites.set(inviter.person.slug, performance.now() + 15000);
        invitationPulses.set(self.person.slug, performance.now() + 900);
        const prior = self.bubble;
        setActorState(self, self.state, `Invite from ${inviter.person.name}`);
        const decline = () => {
          if (!incomingConversationInvites.delete(inviter.person.slug)) return;
          network?.respondToConversationInvite(inviter.person.slug, "decline");
          if (self.bubble === `Invite from ${inviter.person.name}`) setActorState(self, self.state, prior);
        };
        const accept = () => {
          if (!incomingConversationInvites.delete(inviter.person.slug)) return;
          if (!routeActor(self, inviter.tile, "Joining conversation")) { network?.respondToConversationInvite(inviter.person.slug, "decline"); if (self.bubble === `Invite from ${inviter.person.name}`) setActorState(self, self.state, prior); return; }
          network?.respondToConversationInvite(inviter.person.slug, "accept");
        };
        window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${inviter.person.name} invited you to a conversation.`, priority: "info", actions: [{ label: "Accept", run: accept }, { label: "Decline", run: decline }] } }));
        window.setTimeout(decline, 15000);
        return;
      }
      if (event.type === "conv.invite.response" && typeof event.id === "string" && (event.value === "accept" || event.value === "decline")) {
        const respondent = actors.get(event.id);
        if (!respondent) return;
        conversationInvites.delete(respondent.person.slug);
        if (event.value === "accept") { bus.emit("conv.invite.accept", { from: networkIdentity ?? "founder", to: respondent.person.slug }); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${respondent.person.name} accepted your conversation invite.`, priority: "success" } })); }
        else window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${respondent.person.name} declined your conversation invite.`, priority: "info" } }));
        return;
      }
      if (event.type === "error" && event.code === "world_unavailable") { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: "office-world-unavailable", text: "Office movement is temporarily unavailable while the world reloads.", priority: "warning" } })); return; }
      if (event.type === "world" && Number.isFinite(event.rev)) {
        const change = event.change;
        const objectChange = change && typeof change === "object" ? change as { kind?: unknown; id?: unknown; object?: unknown } : null;
        if (event.world_id === world.id && objectChange?.kind === "object" && typeof objectChange.id === "string" && objectChange.object && typeof objectChange.object === "object") {
          const object = world.objects.find(item => item.id === objectChange.id);
          if (object) {
            Object.assign(object, objectChange.object);
            applyWorldObjectTransform(view.scene, objectChange.id, object);
            window.dispatchEvent(new CustomEvent("office3:world-object-patched", { detail: { id: objectChange.id, object: { ...object } } }));
            window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: `office-world-object:${objectChange.id}`, text: "A builder edit was applied.", priority: "success" } }));
            return;
          }
        }
        window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Office world changed to revision ${event.rev}. Refresh the 3D scene before making further edits.`, priority: "warning", action: { label: "Refresh scene", run: () => window.dispatchEvent(new Event("office3:refresh-scene")) } } })); return;
      }
      if (event.type === "leave") { network?.forget(id); const cursor = editorCursors.get(id); cursor?.marker.removeFromParent(); cursor?.marker.geometry.dispose(); (cursor?.marker.material as THREE.Material | undefined)?.dispose(); editorCursors.delete(id); return; }
      if (id === networkIdentity) return;
      if (event.type === "cursor" && Number.isFinite(event.x) && Number.isFinite(event.z)) { let cursor = editorCursors.get(id); if (!cursor) { const marker = new THREE.Mesh(new THREE.RingGeometry(.28, .36, 20), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .9, side: THREE.DoubleSide })); marker.rotation.x = -Math.PI / 2; view.scene.add(marker); cursor = { marker, seenAt: performance.now() }; editorCursors.set(id, cursor); } cursor.marker.position.set(Number(event.x) + .5, .035, Number(event.z) + .5); cursor.seenAt = performance.now(); }
      if (!actor) return;
      if (event.type === "emote" && typeof event.value === "string") { setActorState(actor, actor.state, event.value); const self = founder(); audio.emote(event.value, actor.root.position, self?.root.position); }
      if (event.type === "status" && typeof event.value === "string") setActorState(actor, event.value, actor.bubble);
    });
    network.connect(socketUrl(identity), identity);
  };
  const follows: FollowState[] = []; const calls = new Map<string, CallOver>(); const conversationInvites = new Map<string, { from: string; expiresAt: number }>(); const incomingConversationInvites = new Map<string, number>(); const invitationPulses = new Map<string, number>();
  bus.on("ctx.action", ({ id, action }) => { if (action === "pause-agent") { pausedAgents.add(id); savePausedAgents(); saveAgentControl(id, true); } else if (action === "resume-agent") { pausedAgents.delete(id); savePausedAgents(); saveAgentControl(id, false); } });
  const conversationStartedAt = new Map<string, number>();
  bus.on("conv.join", ({ slug }) => { conversationStartedAt.set(slug, performance.now()); });
  bus.on("conv.leave", ({ slug }) => { const startedAt = conversationStartedAt.get(slug); conversationStartedAt.delete(slug); const actor = actors.get(slug); if (!actor || !startedAt || performance.now() - startedAt < 20000 || actor.path.length || actor.spot?.type === "seat") return; const prior = actor.bubble; setActorState(actor, actor.state, EMOTES.wave); window.setTimeout(() => { if (actor.bubble === EMOTES.wave) setActorState(actor, actor.state, prior); }, 1800); });
  const activeAgentMeetings = new Map<string, { from: string; to: string; expiresAt: number; text: string; toText?: string; fromBubble: string; toBubble: string }>();
  const meetingLines = new Map<string, THREE.Line>();
  const meetingLineGroup = new THREE.Group(); view.scene.add(meetingLineGroup);
  let activeMinutes: { room: string; startedAt: number; participants: Set<string>; transcript: { text: string; speaker: string }[] } | null = null;
  const saveMinutes = () => {
    const meeting = activeMinutes; activeMinutes = null;
    if (!meeting) return;
    for (const actor of actors.values()) if (actor.place === "meeting") meeting.participants.add(actor.person.slug);
    const duration_seconds = Math.max(1, Math.round((performance.now() - meeting.startedAt) / 1000));
    void fetch("/api/v1/office/minutes", { method: "POST", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ room_id: meeting.room, participants: [...meeting.participants], duration_seconds, transcript: meeting.transcript.slice(-100) }) }).then(response => {
      if (!response.ok) throw Error("minutes save failed");
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Meeting minutes saved.", priority: "success" } }));
      window.dispatchEvent(new Event("office3:minutes-saved"));
    }).catch(() => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Meeting ended; minutes could not be saved.", priority: "warning" } })));
  };
  bus.on("meeting.start", ({ room }) => { if (activeMinutes) saveMinutes(); activeMinutes = { room, startedAt: performance.now(), participants: new Set([...actors.values()].filter(actor => actor.place === "meeting").map(actor => actor.person.slug)), transcript: [] }; });
  bus.on("meeting.speaker", ({ slug }) => { const actor = actors.get(slug); if (!activeMinutes || !actor) return; activeMinutes.participants.add(slug); const text = actor.bubble.trim(); if (text && text !== "Speaking") activeMinutes.transcript.push({ speaker: slug, text: text.slice(0, 1000) }); });
  bus.on("meeting.end", saveMinutes);
  const conversationHalos = new Map<string, THREE.Mesh>();
  const jobs = addWorld(view.scene, world, prefabs);
  const builderPrefabMetadata = new Map<string, { footprint: [number, number]; blocks: boolean }>(await fetch("/office3/catalog.json").then(async response => response.ok ? await response.json() : []).then((items: unknown[]) => items.flatMap(item => { const value = item as { id?: unknown; footprint?: unknown; blocks?: unknown }; return typeof value.id === "string" && Array.isArray(value.footprint) && value.footprint.length === 2 && value.footprint.every(Number.isInteger) && value.footprint[0] > 0 && value.footprint[1] > 0 ? [[value.id, { footprint: [value.footprint[0], value.footprint[1]] as [number, number], blocks: value.blocks !== false }] as const] : []; })).catch(() => []));
  applyTheme(view.scene, themeById(world.theme));
  const cameraRig = new CameraRig3D(view.camera, view.controls, world, bus);
  const builderOverlay = new BuilderOverlay(view.scene, world.size.w, world.size.h);
  const zoneOverlay = new ZoneOverlay(view.scene, world);
  const interactionFx = new InteractionFx(view.scene);
  const birthdayCelebrated = new Set<string>();
  const onBirthday = (event: Event) => { const slug = (event as CustomEvent<{ slug?: unknown }>).detail?.slug; const day = new Date().toDateString(); if (typeof slug !== "string" || birthdayCelebrated.has(`${day}:${slug}`)) return; const actor = actors.get(slug); if (!actor) return; birthdayCelebrated.add(`${day}:${slug}`); for (let index = 0; index < 24; index++) interactionFx.spawn("birthday", actor.root.position.x, actor.root.position.z); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: `birthday:${slug}`, text: `Happy birthday, ${actor.person.name}!`, priority: "success" } })); };
  window.addEventListener("office3:birthday", onBirthday);
  const floorMaterialAt = (tile: readonly [number, number]) => world.floors.find(fill => tile[0] >= fill.rect[0] && tile[0] <= fill.rect[2] && tile[1] >= fill.rect[1] && tile[1] <= fill.rect[3])?.material ?? "office";
  let editMode = false, builderPrefab = "plant-v1";
  const builderObjects = new Map<string, THREE.Mesh>();
  const templateSeats: { id: string; room: string; pos: [number, number]; facing: "up" | "down" | "left" | "right"; owner: null }[] = [];
  const builderHistory: [string, THREE.Mesh][] = [], builderUndone: [string, THREE.Mesh][] = [];
  const deletedBuilderHistory: [string, THREE.Mesh][] = [], deletedBuilderUndone: [string, THREE.Mesh][] = [];
  const builderDraftStorageKey = `office3.builder.draft.${world.id}`;
  // One-time migration: drafts used to be shared by every world, which could
  // accidentally place an unpublished draft into a newly activated world.
  try {
    const legacyDraft = safeStorage.get("office3.builder.draft");
    if (legacyDraft && !safeStorage.get(builderDraftStorageKey)) safeStorage.set(builderDraftStorageKey, legacyDraft);
    if (legacyDraft) safeStorage.remove("office3.builder.draft");
  } catch { /* local storage is optional */ }
  const persistJournal = () => { try { const snap = (mesh: THREE.Mesh) => ({ prefab: String(mesh.userData.office3Prefab ?? "unknown"), rot: mesh.rotation.y }); saveJournal({ version: 1, world: world.id, done: [...builderHistory.map(([id, mesh]) => ({ id, op: "add" as const, before: null, after: snap(mesh) })), ...deletedBuilderHistory.map(([id, mesh]) => ({ id, op: "remove" as const, before: snap(mesh), after: null }))], undone: [] }, { setItem: (k, v) => { safeStorage.set(k, v); }, removeItem: k => { safeStorage.remove(k); } }); } catch { /* history persistence is optional */ } };
  const persistBuilderDraft = () => { persistJournal(); return safeStorage.set(builderDraftStorageKey, JSON.stringify({ v: 1, savedAt: Date.now(), objects: [...builderObjects].map(([key, mesh]) => ({ key, prefab: String(mesh.userData.office3Prefab ?? "unknown"), rot: mesh.rotation.y })), seats: templateSeats })); };
  let selectedBuilder: [string, THREE.Mesh] | null = null;
  const selectBuilderObject = (item: [string, THREE.Mesh] | null) => { if (selectedBuilder) ((selectedBuilder[1].material as THREE.MeshStandardMaterial).emissive.setHex(0)); selectedBuilder = item; if (selectedBuilder) (selectedBuilder[1].material as THREE.MeshStandardMaterial).emissive.setHex(0x1d4ed8); };
  const builderObject = (key: string, mesh: THREE.Mesh): BuilderObject => { const [x, z] = key.split(",").map(Number), footprint = mesh.userData.office3Footprint as [number, number] | undefined; return { id: String(mesh.uuid), pos: [x, z], footprint: rotatedFootprint(footprint ?? [1, 1], Math.round(mesh.rotation.y / (Math.PI / 2))), blocks: mesh.userData.office3Blocks !== false }; };
  const canPlaceBuilderObject = (key: string, prefab: string, rotation = 0, ignored?: THREE.Mesh): boolean => { const [x, z] = key.split(",").map(Number); if (!Number.isInteger(x) || !Number.isInteger(z)) return false; const metadata = builderPrefabMetadata.get(prefab) ?? { footprint: [1, 1] as [number, number], blocks: true }, turns = Math.round(rotation / (Math.PI / 2)); const candidate: BuilderObject = { id: "candidate", pos: [x, z], footprint: rotatedFootprint(metadata.footprint, turns), blocks: metadata.blocks }; if (!inWorldBounds(candidate.pos, candidate.footprint, [world.size.w, world.size.h])) return false; if (builderObjects.has(key) && builderObjects.get(key) !== ignored) return false; return !overlapsBlockingObject(candidate, [...builderObjects].filter(([, mesh]) => mesh !== ignored).map(([objectKey, mesh]) => builderObject(objectKey, mesh))); };
  const positionBuilderMesh = (mesh: THREE.Mesh, position: [number, number], rotation = mesh.rotation.y) => { const footprint = rotatedFootprint((mesh.userData.office3Footprint as [number, number] | undefined) ?? [1, 1], Math.round(rotation / (Math.PI / 2))); mesh.position.set(position[0] + footprint[0] / 2, mesh.position.y, position[1] + footprint[1] / 2); };
  const moveSelectedBuilderTo = (next: [number, number]) => { if (!selectedBuilder) return false; const [key, mesh] = selectedBuilder, nextKey = next.join(","), prefab = String(mesh.userData.office3Prefab ?? "unknown"); if (nextKey === key || !canPlaceBuilderObject(nextKey, prefab, mesh.rotation.y, mesh)) return false; for (const history of [builderHistory, builderUndone, deletedBuilderHistory, deletedBuilderUndone]) for (const item of history) if (item[1] === mesh) item[0] = nextKey; builderObjects.delete(key); positionBuilderMesh(mesh, next); builderObjects.set(nextKey, mesh); selectBuilderObject([nextKey, mesh]); persistBuilderDraft(); bus.emit("edit.command", { id: "move" }); return true; };
  const nudgeSelectedBuilder = (dx: number, dz: number) => { if (!selectedBuilder) return; const [x, z] = selectedBuilder[0].split(",").map(Number); moveSelectedBuilderTo([x + dx, z + dz]); };
  const addBuilderObject = (key: string, prefab: string): THREE.Mesh | null => { if (!canPlaceBuilderObject(key, prefab)) return null; const [x, z] = key.split(",").map(Number), metadata = builderPrefabMetadata.get(prefab) ?? { footprint: [1, 1] as [number, number], blocks: true }; const mesh = new THREE.Mesh(new THREE.BoxGeometry(metadata.footprint[0] * .8, .8, metadata.footprint[1] * .8), new THREE.MeshStandardMaterial({ color: prefab.includes("plant") ? 0x22c55e : 0x60a5fa })); mesh.position.set(x + metadata.footprint[0] / 2, .4, z + metadata.footprint[1] / 2); mesh.userData.office3Prefab = prefab; mesh.userData.office3Footprint = metadata.footprint; mesh.userData.office3Blocks = metadata.blocks; view.scene.add(mesh); builderObjects.set(key, mesh); return mesh; };
  const insertTemplate = (roomId: string, template: RoomTemplateId) => { const room = world.rooms.find(item => item.id === roomId); if (!room) return; const plan = instantiateRoomTemplate(template, room); for (const object of plan.objects) addBuilderObject(object.pos.join(","), object.prefab); for (const seat of plan.seats) if (!world.seats.some(item => item.room === roomId && item.pos[0] === seat.pos[0] && item.pos[1] === seat.pos[1]) && !templateSeats.some(item => item.room === roomId && item.pos[0] === seat.pos[0] && item.pos[1] === seat.pos[1])) templateSeats.push({ id: `draft-seat-${roomId}-${seat.pos.join("-")}`, room: roomId, pos: seat.pos, facing: seat.facing, owner: null }); persistBuilderDraft(); bus.emit("edit.command", { id: `template:${template}` }); };
  try { const draft = JSON.parse(safeStorage.get(builderDraftStorageKey) ?? "null") as { objects?: { key: string; prefab: string; rot?: number }[]; seats?: typeof templateSeats } | null; for (const object of draft?.objects ?? []) { const mesh = addBuilderObject(object.key, object.prefab); if (mesh && Number.isFinite(object.rot) && canPlaceBuilderObject(object.key, object.prefab, object.rot, mesh)) { mesh.rotation.y = object.rot ?? 0; positionBuilderMesh(mesh, object.key.split(",").map(Number) as [number, number]); } } if (Array.isArray(draft?.seats)) templateSeats.push(...draft.seats.filter(seat => typeof seat?.id === "string" && typeof seat.room === "string" && Array.isArray(seat.pos) && seat.pos.length === 2)); } catch { /* discard malformed local draft */ }
  try { // restore the undo journal that belongs to this draft
    const journal = loadJournal(world.id, { getItem: k => safeStorage.get(k) });
    for (const entry of journal.done) {
      const shape = (entry.op === "add" ? entry.after : entry.before) as { prefab?: unknown; rot?: unknown } | null;
      if (entry.op === "add") { const mesh = builderObjects.get(entry.id); if (mesh) builderHistory.push([entry.id, mesh]); }
      else if (typeof shape?.prefab === "string" && !builderObjects.has(entry.id)) { const mesh = addBuilderObject(entry.id, shape.prefab); if (mesh) { if (typeof shape.rot === "number" && Number.isFinite(shape.rot)) mesh.rotation.y = shape.rot; mesh.removeFromParent(); builderObjects.delete(entry.id); deletedBuilderHistory.push([entry.id, mesh]); } }
    }
  } catch { /* undo history is optional */ }
  const lighting = new LightingRig(view.scene, world.size.w, world.size.h), audio = new OfficeAudio();
  const onToastAudio = (event: Event) => { const priority = (event as CustomEvent<{ priority?: unknown }>).detail?.priority; audio.notice(priority === "success" || priority === "warning" || priority === "error" ? priority : "info"); };
  window.addEventListener("office3:toast", onToastAudio);
  const speakerRing = new THREE.Mesh(new THREE.RingGeometry(.52, .62, 28), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .9, side: THREE.DoubleSide })); speakerRing.rotation.x = -Math.PI / 2; speakerRing.visible = false; view.scene.add(speakerRing);
  const incidentBanner = document.createElement("button"); let activeAlertId: number | null = null; incidentBanner.type = "button"; incidentBanner.style.cssText = "position:absolute;z-index:24;top:3.5rem;left:50%;transform:translateX(-50%);display:none;border:0;border-radius:.5rem;background:#991b1bdd;padding:.4rem .75rem;color:#fff;font-size:12px;font-weight:600;cursor:pointer"; incidentBanner.onclick = () => { if (activeAlertId === null) return; void fetch(`/api/alerts/${activeAlertId}/ack`, { method: "POST" }).then(response => { if (!response.ok) throw Error("ack failed"); activeAlertId = null; incidentBanner.style.display = "none"; lighting.setIncident(false); applyIncident(actors, model, false); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Incident acknowledged. Responders are returning to their desks.", priority: "success" } })); }).catch(() => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Unable to acknowledge incident.", priority: "error" } }))); }; host.append(incidentBanner);
  const wallOcclusion = new WallOcclusion(view.scene);
  wallOcclusion.setTarget(view.controls.target);
  const founder = () => [...actors.values()].find((actor) => actor.person.kind === "human") ?? actors.values().next().value as OfficeActor | undefined;
  const onPersonSessionChanged = () => { const self = founder(); if (!self) return; networkIdentity = null; startNetwork(self.person.slug); };
  window.addEventListener("office3:person-session-changed", onPersonSessionChanged);
  let founderLastActiveAt = performance.now();
  const markFounderActive = () => { founderLastActiveAt = performance.now(); const self = founder(); if (self?.state === "away") setActorState(self, "idle", ""); };
  window.addEventListener("pointerdown", markFounderActive, true);
  const updateMeetingLines = (now: number) => {
    for (const [thread, meeting] of activeAgentMeetings) {
      if (now >= meeting.expiresAt) { activeAgentMeetings.delete(thread); const from = actors.get(meeting.from), to = actors.get(meeting.to); if (from?.bubble === meeting.text) setActorState(from, from.state, meeting.fromBubble); if (to && (to.bubble === "…" || to.bubble === meeting.toText)) setActorState(to, to.state, meeting.toBubble); if (from && !from.path.length) walkTo(from, from.home, model); if (to && !to.path.length) walkTo(to, to.home, model); const line = meetingLines.get(thread); line?.removeFromParent(); line?.geometry.dispose(); (line?.material as THREE.Material | undefined)?.dispose(); meetingLines.delete(thread); continue; }
      const from = actors.get(meeting.from), to = actors.get(meeting.to); if (!from || !to) continue;
      let line = meetingLines.get(thread);
      if (!line) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3)); line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: .55 })); line.userData.office3AgentThread = thread; meetingLines.set(thread, line); meetingLineGroup.add(line); }
      const position = line.geometry.getAttribute("position") as THREE.BufferAttribute; position.setXYZ(0, from.root.position.x, 1.35, from.root.position.z); position.setXYZ(1, to.root.position.x, 1.35, to.root.position.z); position.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = .4 + Math.sin(now / 180) * .15;
    }
  };
  const updateConversationHalos = (groups: readonly string[][], locked = new Set<string>()) => {
    const next = new Set<string>();
    for (const group of groups) { const key = [...group].sort().join(":"); const members = group.map(slug => actors.get(slug)).filter((actor): actor is OfficeActor => Boolean(actor)); if (members.length < 2) continue; next.add(key); let halo = conversationHalos.get(key); if (!halo) { halo = new THREE.Mesh(new THREE.RingGeometry(.75, .83, 32), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: .45, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; conversationHalos.set(key, halo); view.scene.add(halo); } (halo.material as THREE.MeshBasicMaterial).color.setHex(locked.has(key) ? 0xfbbf24 : 0x67e8f9); const x = members.reduce((sum, actor) => sum + actor.root.position.x, 0) / members.length, z = members.reduce((sum, actor) => sum + actor.root.position.z, 0) / members.length; halo.position.set(x, .025, z); halo.scale.setScalar(Math.max(1, Math.sqrt(members.length) * .85)); for (const actor of members) if (!actor.path.length && actor.spot?.type !== "seat") actor.root.rotation.y = Math.atan2(x - actor.root.position.x, z - actor.root.position.z); }
    for (const [key, halo] of conversationHalos) if (!next.has(key)) { halo.removeFromParent(); halo.geometry.dispose(); (halo.material as THREE.Material).dispose(); conversationHalos.delete(key); }
  };
  const interactionUse = new Map<string, number>();
  const waterCoolerBubbles = new Map<string, string>();
  const interactionClip = (id: import("./core/interactions").InteractionId): ActorAnimation => ({ coffee: "coffee", water: "coffee", printer: "typing", whiteboard: "reading", vending: "coffee", sofa: "sit", server: "typing", booth: "typing", reception: "wave" } as Record<string, ActorAnimation>)[id];
  const playInteractionClip = (actor: OfficeActor, id: import("./core/interactions").InteractionId): boolean => {
    const animation = interactionClip(id);
    if (!actor.actions[animation]) return false;
    play(actor, animation);
    return true;
  };
  bus.on("actor.arrive", ({ slug }) => { const prior = waterCoolerBubbles.get(slug), actor = actors.get(slug); if (prior === undefined || !actor) return; waterCoolerBubbles.delete(slug); if (actor.bubble === "Joining at the water cooler") setActorState(actor, actor.state, prior); });
  const useInteraction = (actor: OfficeActor, found: NonNullable<ReturnType<typeof nearestInteraction>>) => {
    if (!canUseInteraction(found.interaction, interactionUse.get(found.target.id) ?? -Infinity, performance.now(), actor.person.kind !== "human")) return false;
    interactionUse.set(found.target.id, performance.now());
    actor.root.userData.office3Interaction = found.interaction.id;
    actor.root.userData.office3InteractionClip = playInteractionClip(actor, found.interaction.id);
    setActorState(actor, "interacting", interactionMessage(found.interaction.id));
    audio.interaction(found.interaction.id, actor.root.position, founder()?.root.position);
    interactionFx.spawn(found.interaction.id, actor.root.position.x, actor.root.position.z);
    bus.emit("interaction.done", { slug: actor.person.slug, id: found.interaction.id });
    window.dispatchEvent(new CustomEvent("office3:interaction", { detail: found.interaction.id }));
    if (found.interaction.id === "booth" && actor.person.kind === "human" && activeConversationGroup.includes(actor.person.slug)) { conversations.lockGroup(activeConversationGroup); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Nearby conversation locked for privacy.", priority: "success" } })); }
    if (found.interaction.id === "reception" && actor.person.kind === "human") { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: "reception-welcome", text: "Welcome to Office 3. Start with movement, people, and interactions.", priority: "success", action: { label: "Open controls", run: () => window.dispatchEvent(new Event("office3:open-help")) } } })); window.dispatchEvent(new CustomEvent("office3:feature-tip", { detail: { id: "reception", text: "Tip: Help explains movement, people actions, interaction keys, emotes, and photo mode." } })); }
    if (found.interaction.id === "water" && actor.person.kind === "human") { const companion = [...actors.values()].filter(candidate => candidate.person.kind !== "human" && candidate.state === "idle" && !candidate.path.length).sort((left, right) => Math.hypot(left.tile[0] - actor.tile[0], left.tile[1] - actor.tile[1]) - Math.hypot(right.tile[0] - actor.tile[0], right.tile[1] - actor.tile[1]))[0]; if (companion) { waterCoolerBubbles.set(companion.person.slug, companion.bubble); setActorState(companion, "idle", "Joining at the water cooler"); walkToAllowed(companion, [actor.tile[0] + 1, actor.tile[1]]); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${companion.person.name} is joining you at the water cooler.`, priority: "info" } })); } }
    window.dispatchEvent(new CustomEvent("office3:feature-tip", { detail: { id: "interactions", text: "Tip: use the interaction key near objects, or right-click one and choose Use." } }));
    const duration = found.interaction.id === "sofa" ? 5000 : 1200;
    window.setTimeout(() => { if (!actor.path.length) setActorState(actor, "idle", ""); delete actor.root.userData.office3Interaction; delete actor.root.userData.office3InteractionClip; settle(actor); }, duration);
    return true;
  };
  const useNearbyInteraction = (actor: OfficeActor) => { const found = nearestInteraction(world.objects, actor.tile); return found ? useInteraction(actor, found) : false; };
  const clearPendingInteraction = (actor: OfficeActor) => {
    if (typeof actor.root.userData.office3PendingInteraction !== "string") return;
    delete actor.root.userData.office3PendingInteraction;
    delete actor.root.userData.office3PendingInteractionUntil;
  };
  const completePendingInteraction = (actor: OfficeActor, now: number) => {
    const id = actor.root.userData.office3PendingInteraction;
    if (typeof id !== "string") return;
    const expiresAt = Number(actor.root.userData.office3PendingInteractionUntil ?? 0);
    if (now >= expiresAt) { clearPendingInteraction(actor); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Could not reach that object.", priority: "warning" } })); return; }
    const target = world.objects.find(item => item.id === id), found = target && nearestInteraction([target], actor.tile);
    if (!found) return;
    clearPendingInteraction(actor);
    useInteraction(actor, found);
  };
  const walkToAllowed = (actor: OfficeActor, target: readonly [number, number]) => {
    const room = world.rooms.find((item) => target[0] >= item.rect[0] && target[0] <= item.rect[2] && target[1] >= item.rect[1] && target[1] <= item.rect[3]);
    if (!room) { if (actor.person.kind === "human") audio.setAmbience("none"); walkTo(actor, target, model); return true; }
    const occupancy = [...actors.values()].filter((item) => item !== actor && item.tile[0] >= room.rect[0] && item.tile[0] <= room.rect[2] && item.tile[1] >= room.rect[1] && item.tile[1] <= room.rect[3]).length;
    const rules = { ...room.rules, capacity: room.rules.capacity > 0 ? room.rules.capacity : undefined };
    const effects = evaluateZoneEntry(rules, actor.person.kind === "human" ? "founder" : "member", occupancy);
    if (effects.includes("block")) { setActorState(actor, actor.state, `${room.label} is unavailable`); return false; }
    walkTo(actor, target, model);
    if (actor.person.kind === "human") audio.setAmbience(room.rules.ambience ?? "none");
    if (effects.includes("tooltip") && room.rules.tooltip) setActorState(actor, actor.state, room.rules.tooltip);
    else if (effects.includes("ambience") && room.rules.ambience && room.rules.ambience !== "none") setActorState(actor, actor.state, `${room.rules.ambience[0].toUpperCase()}${room.rules.ambience.slice(1)} zone`);
    else if (effects.includes("silent")) setActorState(actor, actor.state, "Quiet zone");
    return true;
  };
  const routeActor = (actor: OfficeActor, target: readonly [number, number], bubble: string) => { if (!walkToAllowed(actor, target)) return false; setActorState(actor, "walking", bubble); return true; };
  let selectedWorldObjectId: string | null = null;
  const triggerEmote = (actor: OfficeActor, emote: Emote) => { const prior = actor.bubble; setActorState(actor, actor.state, EMOTES[emote]); audio.emote(emote, actor.root.position, founder()?.root.position); bus.emit("emote", { slug: actor.person.slug, id: emote }); window.dispatchEvent(new CustomEvent("office3:feature-tip", { detail: { id: "emotes", text: "Tip: press B for the emote picker, or use Alt+1 through Alt+9 for quick emotes." } })); window.setTimeout(() => { if (actor.bubble === EMOTES[emote]) setActorState(actor, actor.state, prior); }, 2500); };
  const onKey = (event: KeyboardEvent) => {
    if (!(document.activeElement === view.renderer.domElement || host.contains(document.activeElement))) return;
    markFounderActive();
    audio.unlock();
    const key = event.key.toLowerCase();
    if (editMode && event.ctrlKey && key === "z") { event.preventDefault(); const deleted = deletedBuilderHistory.pop(); if (deleted) { view.scene.add(deleted[1]); builderObjects.set(deleted[0], deleted[1]); deletedBuilderUndone.push(deleted); persistBuilderDraft(); bus.emit("edit.undo", {}); return; } const item = builderHistory.pop(); if (item) { item[1].removeFromParent(); builderObjects.delete(item[0]); builderUndone.push(item); persistBuilderDraft(); bus.emit("edit.undo", {}); } return; }
    if (editMode && event.ctrlKey && key === "y") { event.preventDefault(); const deleted = deletedBuilderUndone.pop(); if (deleted) { deleted[1].removeFromParent(); builderObjects.delete(deleted[0]); deletedBuilderHistory.push(deleted); persistBuilderDraft(); bus.emit("edit.redo", {}); return; } const item = builderUndone.pop(); if (item) { view.scene.add(item[1]); builderObjects.set(item[0], item[1]); builderHistory.push(item); persistBuilderDraft(); bus.emit("edit.redo", {}); } return; }
    if (editMode && (key === "delete" || key === "backspace")) { const item = selectedBuilder; if (item) { item[1].removeFromParent(); builderObjects.delete(item[0]); deletedBuilderHistory.push(item); deletedBuilderUndone.length = 0; selectBuilderObject(null); persistBuilderDraft(); bus.emit("edit.command", { id: "delete" }); } return; }
    if (editMode && key === "r") { if (selectedBuilder) { const [positionKey, mesh] = selectedBuilder, rotation = mesh.rotation.y + Math.PI / 2, prefab = String(mesh.userData.office3Prefab ?? "unknown"); if (canPlaceBuilderObject(positionKey, prefab, rotation, mesh)) { mesh.rotation.y = rotation; positionBuilderMesh(mesh, positionKey.split(",").map(Number) as [number, number]); persistBuilderDraft(); bus.emit("edit.command", { id: "rotate" }); } } return; }
    if (editMode && event.shiftKey && ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) { event.preventDefault(); nudgeSelectedBuilder(key === "arrowright" ? 1 : key === "arrowleft" ? -1 : 0, key === "arrowdown" ? 1 : key === "arrowup" ? -1 : 0); return; }
    if (key === "escape") { follows.splice(0); calls.clear(); for (const actor of actors.values()) { const origin = actor.root.userData.office3CallOrigin as [number, number] | undefined; if (!origin) continue; delete actor.root.userData.office3CallOrigin; actor.root.userData.office3ReturningCall = true; walkToAllowed(actor, origin); setActorState(actor, "idle", "Returning to desk"); bus.emit("call.done", { slug: actor.person.slug }); } }
    if (key === "escape") { clearSelectionEvent(); return; }
    if (key === "enter" && selectedWorldObjectId) { event.preventDefault(); window.dispatchEvent(new CustomEvent("office3:edit-object", { detail: selectedWorldObjectId })); return; }
    if (event.ctrlKey && key === "a") { event.preventDefault(); applySelection(new Set(actors.keys())); return; }
    if (key === interactionKey && !event.shiftKey) { const actor = founder(); if (actor) { event.preventDefault(); useNearbyInteraction(actor); } return; }
    if (event.altKey && /^[1-9]$/.test(key)) { const actor = founder(); const emote = Object.keys(EMOTES)[Number(key) - 1] as Emote | undefined; if (actor && emote) triggerEmote(actor, emote); return; }
    if (key === "b") { event.preventDefault(); window.dispatchEvent(new Event("office3:open-emote-wheel")); return; }
    if (key === "f") { const slug = selected.size === 1 ? selected.values().next().value : founder()?.person.slug; const actor = slug ? actors.get(slug) : undefined; if (!actor) return; event.preventDefault(); cameraFollowSlug = cameraFollowSlug === slug ? null : (slug ?? null); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: cameraFollowSlug ? `Following camera: ${actor.person.name}. Press F to stop.` : "Camera follow stopped.", priority: "info" } })); return; }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      const actor = founder(); if (!actor) return;
      const strafe = key === "a" || key === "arrowleft" ? -1 : key === "d" || key === "arrowright" ? 1 : 0;
      const forward = key === "w" || key === "arrowup" ? 1 : key === "s" || key === "arrowdown" ? -1 : 0;
      const [dx, dz] = cameraRig.movementDelta(forward, strafe);
      if (dx || dz) { event.preventDefault(); clearPendingInteraction(actor); walkToAllowed(actor, [actor.tile[0] + dx, actor.tile[1] + dz]); }
      return;
    }
    cameraRig.handle(key, event.shiftKey, cameraCycleKey);
  };
  bus.on("follow.request", ({ from, to }) => { const target = actors.get(to); if (!target || ["dnd", "focus", "paused", "busy"].includes(target.state) || target.path.length) { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target?.person.name ?? "That person"} cannot be followed right now.`, priority: "warning" } })); bus.emit("follow.stop", { slug: from }); return; } const next = beginFollow(follows, to, from, performance.now()); if (next) { follows.push(next); bus.emit("follow.accept", { from, to }); } else window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Follow request could not be started.", priority: "warning" } })); });
  const raycaster = new THREE.Raycaster();
  let selected = clearSelection(), cameraFollowSlug: string | null = null;
  const stopCameraFollowOnManualControl = () => {
    if (!cameraFollowSlug) return;
    cameraFollowSlug = null;
    window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Camera follow stopped for manual control.", priority: "info" } }));
  };
  view.controls.addEventListener("start", stopCameraFollowOnManualControl);
  const worldObjectSelection = new THREE.Box3Helper(new THREE.Box3(), 0x60a5fa); worldObjectSelection.visible = false; view.scene.add(worldObjectSelection);
  let dragStart: { x: number; y: number } | null = null, builderDrag: { key: string; mesh: THREE.Mesh } | null = null, ignoreClickUntil = 0;
  const selectionBox = document.createElement("div"); selectionBox.style.cssText = "position:absolute;z-index:25;border:1px solid #60a5fa;background:#3b82f633;pointer-events:none;display:none"; host.append(selectionBox);
  const interactionHint = document.createElement("div"); interactionHint.style.cssText = "position:absolute;z-index:24;left:50%;bottom:5.5rem;transform:translateX(-50%);display:none;border-radius:.5rem;background:#020617dd;padding:.35rem .6rem;color:#fff;font-size:12px;pointer-events:none"; host.append(interactionHint);
  const conversationChip = document.createElement("div"); conversationChip.style.cssText = "position:absolute;z-index:24;left:50%;bottom:8rem;transform:translateX(-50%);display:none;align-items:center;gap:.35rem;border-radius:.5rem;background:#020617dd;padding:.35rem .5rem;color:#fff;font-size:12px";
  const conversationLabel = document.createElement("span"), conversationTalk = document.createElement("button"), conversationLock = document.createElement("button"), conversationLeave = document.createElement("button");
  conversationTalk.type = "button"; conversationTalk.style.cssText = "border:0;border-radius:.3rem;background:#1d4ed8;color:#fff;padding:.2rem .4rem;cursor:pointer"; conversationTalk.textContent = "Talk";
  conversationLock.type = "button"; conversationLock.style.cssText = "border:0;border-radius:.3rem;background:#334155;color:#fff;padding:.2rem .4rem;cursor:pointer";
  conversationLeave.type = "button"; conversationLeave.style.cssText = "border:0;border-radius:.3rem;background:#334155;color:#fff;padding:.2rem .4rem;cursor:pointer"; conversationLeave.textContent = "Leave";
  conversationChip.append(conversationLabel, conversationTalk, conversationLock, conversationLeave); host.append(conversationChip);
  let activeConversationGroup: string[] = [], activeConversationLocked = false, activeConversationPrivate = false;
  conversationTalk.onclick = () => { const members = activeConversationGroup.map(slug => actors.get(slug)?.person).filter((person): person is Person => Boolean(person)); if (members.length > 1) window.dispatchEvent(new CustomEvent("office3:open-conversation", { detail: { members, privateRoom: activeConversationPrivate } })); };
  conversationLock.onclick = () => { if (activeConversationLocked) conversations.unlockGroup(activeConversationGroup); else conversations.lockGroup(activeConversationGroup); };
  conversationLeave.onclick = () => { const self = founder(); if (!self) return; conversations.leave(self.person.slug); conversationChip.style.display = "none"; window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Left the nearby conversation.", priority: "info" } })); };
  const callChip = document.createElement("div"); callChip.style.cssText = "position:absolute;z-index:24;left:50%;top:4.25rem;transform:translateX(-50%);display:none;align-items:center;gap:.35rem;border-radius:.5rem;background:#172554ee;padding:.4rem .55rem;color:#fff;font-size:12px";
  const callLabel = document.createElement("span"), callChat = document.createElement("button"), callTasks = document.createElement("button"), callDismiss = document.createElement("button");
  for (const [button, text] of [[callChat, "Chat"], [callTasks, "Tasks"], [callDismiss, "Dismiss"]] as const) { button.type = "button"; button.textContent = text; button.style.cssText = "border:0;border-radius:.3rem;background:#1e3a8a;color:#fff;padding:.2rem .4rem;cursor:pointer"; }
  callChip.append(callLabel, callChat, callTasks, callDismiss); host.append(callChip);
  let activeCallActor: OfficeActor | null = null;
  callChat.onclick = () => { const self = founder(); if (self && activeCallActor) window.dispatchEvent(new CustomEvent("office3:open-conversation", { detail: [self.person, activeCallActor.person] })); };
  callTasks.onclick = () => window.dispatchEvent(new Event("office3:open-task-board"));
  callDismiss.onclick = () => { const target = activeCallActor, origin = target?.root.userData.office3CallOrigin as [number, number] | undefined; if (!target || !origin) return; delete target.root.userData.office3CallOrigin; target.root.userData.office3ReturningCall = true; walkToAllowed(target, origin); setActorState(target, "idle", "Returning to desk"); bus.emit("call.done", { slug: target.person.slug }); callChip.style.display = "none"; };
  const updateInteractionHint = () => { if (photoMode) { interactionHint.style.display = "none"; return; } const actor = founder(); const nearby = actor && nearestInteraction(world.objects, actor.tile); interactionHint.style.display = nearby ? "block" : "none"; if (nearby) interactionHint.textContent = `Use ${interactionKey.toUpperCase()} · ${nearby.interaction.id}`; };
  const applySelection = (next: Set<string>) => { selected = next; if (next.size) { selectedWorldObjectId = null; worldObjectSelection.visible = false; } for (const item of actors.values()) item.ring.scale.setScalar(selected.has(item.person.slug) ? 1.35 : 1); bus.emit("select.change", { id: selected.values().next().value ?? null }); window.dispatchEvent(new CustomEvent("office3:selection", { detail: selected.size })); };
  const clearSelectionEvent = () => { selectedWorldObjectId = null; worldObjectSelection.visible = false; applySelection(clearSelection()); };
  const onClick = (event: MouseEvent) => {
    audio.unlock();
    if (performance.now() < ignoreClickUntil) return;
    const lineBounds = view.renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - lineBounds.left) / lineBounds.width * 2 - 1, -(event.clientY - lineBounds.top) / lineBounds.height * 2 + 1), view.camera);
    const lineHit = raycaster.intersectObject(meetingLineGroup, true)[0]?.object.userData.office3AgentThread;
    if (typeof lineHit === "string") { window.dispatchEvent(new CustomEvent("office3:open-agent-thread", { detail: { thread: lineHit } })); return; }
    const picked = pickActor(event, view.renderer.domElement, view.camera, actors.values(), [actorProxyInstances]);
    if (picked) { applySelection(event.ctrlKey || event.shiftKey ? toggleSelection(selected, picked.person.slug) : new Set([picked.person.slug])); if (["waiting_human", "escalated"].includes(picked.state)) window.dispatchEvent(new CustomEvent("office3:attention", { detail: picked.person.slug })); return; }
    const pickedObject = pickWorldObject(event, view.renderer.domElement, view.camera, view.scene);
    if (pickedObject) {
      selectedWorldObjectId = typeof pickedObject.userData.office3WorldObjectId === "string" ? pickedObject.userData.office3WorldObjectId : null;
      worldObjectSelection.box.setFromObject(pickedObject);
      worldObjectSelection.visible = true;
      applySelection(clearSelection());
      window.dispatchEvent(new CustomEvent("office3:object-selected", { detail: pickedObject.userData.office3WorldObjectId }));
      window.dispatchEvent(new CustomEvent("office3:selection", { detail: 1 }));
      return;
    }
    selectedWorldObjectId = null; worldObjectSelection.visible = false;
    const actor = founder(); if (!actor) return;
    const bounds = view.renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (hit) { const goal: [number, number] = [Math.floor(hit.x), Math.floor(hit.z)]; if (editMode) { network?.cursor(goal[0], goal[1]); const key = goal.join(","), existing = builderObjects.get(key); if (existing) { selectBuilderObject([key, existing]); return; } const mesh = addBuilderObject(key, builderPrefab); if (mesh) { const item: [string, THREE.Mesh] = [key, mesh]; builderHistory.push(item); builderUndone.length = 0; selectBuilderObject(item); persistBuilderDraft(); bus.emit("edit.command", { id: `place:${builderPrefab}` }); } return; } clearPendingInteraction(actor); walkToAllowed(actor, goal); }
  };
  let hovered: OfficeActor | null = null;
  const onPointerLeave = () => { if (!hovered) return; hovered.ring.scale.setScalar(selected.has(hovered.person.slug) ? 1.35 : 1); hovered = null; };
  const onPointerMove = (event: MouseEvent) => { const bounds = view.renderer.domElement.getBoundingClientRect(); if (dragStart) { const x = event.clientX - bounds.left, y = event.clientY - bounds.top; selectionBox.style.display = "block"; selectionBox.style.left = `${Math.min(x, dragStart.x)}px`; selectionBox.style.top = `${Math.min(y, dragStart.y)}px`; selectionBox.style.width = `${Math.abs(x - dragStart.x)}px`; selectionBox.style.height = `${Math.abs(y - dragStart.y)}px`; } raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera); const floorHit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (editMode && floorHit) { const x = Math.floor(floorHit.x), z = Math.floor(floorHit.z), key = `${x},${z}`, mesh = builderDrag?.mesh, prefab = mesh ? String(mesh.userData.office3Prefab ?? "unknown") : builderPrefab; builderOverlay.preview(floorHit.x, floorHit.z, canPlaceBuilderObject(key, prefab, mesh?.rotation.y ?? 0, mesh)); } const next = pickActor(event, view.renderer.domElement, view.camera, actors.values(), [actorProxyInstances]) ?? null; if (hovered === next) return; if (hovered) hovered.ring.scale.setScalar(1); hovered = next; if (hovered) hovered.ring.scale.setScalar(1.35); };
  const onPointerDown = (event: MouseEvent) => { const bounds = view.renderer.domElement.getBoundingClientRect(); if (editMode && event.button === 0) { raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera); const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (hit) { const key = `${Math.floor(hit.x)},${Math.floor(hit.z)}`, mesh = builderObjects.get(key); if (mesh) { selectBuilderObject([key, mesh]); builderDrag = { key, mesh }; event.preventDefault(); return; } } } if (event.shiftKey && !editMode) dragStart = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; };
  const onPointerUp = (event: MouseEvent) => { const bounds = view.renderer.domElement.getBoundingClientRect(); if (builderDrag) { raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera); const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); builderDrag = null; builderOverlay.hidePreview(); if (hit) moveSelectedBuilderTo([Math.floor(hit.x), Math.floor(hit.z)]); ignoreClickUntil = performance.now() + 80; return; } if (!dragStart) return; const end = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; if (Math.hypot(end.x - dragStart.x, end.y - dragStart.y) > 6) { const projected = [...actors.values()].map(item => { const point = item.root.position.clone().project(view.camera); return { id: item.person.slug, x: (point.x + 1) * .5 * bounds.width, y: (1 - point.y) * .5 * bounds.height }; }); applySelection(selectionFromBox(projected, { left: dragStart.x, top: dragStart.y, right: end.x, bottom: end.y })); ignoreClickUntil = performance.now() + 80; } dragStart = null; selectionBox.style.display = "none"; };
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const actor = pickActor(event, view.renderer.domElement, view.camera, actors.values(), [actorProxyInstances]);
    const menuX = event.clientX - host.getBoundingClientRect().left, menuY = event.clientY - host.getBoundingClientRect().top;
    if (actor) {
      if (actor.person.kind === "human") { actor.root.userData.office3Conversation = activeConversationGroup; actor.root.userData.office3ConversationLocked = activeConversationLocked; }
      actor.root.userData.office3Following = follows.some(follow => follow.leader === actor.person.slug && follow.follower === founder()?.person.slug && follow.status === "following");
      openContextMenu(host, actor, menuX, menuY, (action, target) => {
        bus.emit("ctx.action", { id: target.person.slug, action });
        if (action === "view-card") { window.dispatchEvent(new CustomEvent("office3:visit-card", { detail: { slug: target.person.slug, name: target.person.name, kind: target.person.kind, state: target.state } })); }
        else if (action === "edit-appearance") { window.dispatchEvent(new Event("office3:open-appearance-editor")); }
        else if (action === "go-to") { const self = founder(); if (self) walkToAllowed(self, [target.tile[0] + 1, target.tile[1]]); }
        else if (action === "follow") { const self = founder(); if (self) bus.emit("follow.request", { from: self.person.slug, to: target.person.slug }); }
        else if (action === "stop-following") { const self = founder(); if (!self) return; for (let index = follows.length - 1; index >= 0; index--) if (follows[index].leader === target.person.slug && follows[index].follower === self.person.slug) follows.splice(index, 1); bus.emit("follow.stop", { slug: self.person.slug }); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Stopped following ${target.person.name}.`, priority: "info" } })); }
        else if (action === "lock-conversation") { conversations.lockGroup(activeConversationGroup); }
        else if (action === "unlock-conversation") { conversations.unlockGroup(activeConversationGroup); }
        else if (action === "set-focus") { target.path.length = 0; localStorage.setItem("office3.founder-status", "focus"); setActorState(target, "focus", "Focus mode"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Focus mode enabled.", priority: "success" } })); }
        else if (action === "set-dnd") { target.path.length = 0; localStorage.setItem("office3.founder-status", "dnd"); setActorState(target, "dnd", "Do not disturb"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Do Not Disturb enabled.", priority: "success" } })); }
        else if (action === "set-available") { localStorage.removeItem("office3.founder-status"); setActorState(target, "idle", "Available"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "You are available.", priority: "success" } })); }
        else if (action === "return-to-desk") { const self = founder(); if (!self) return; clearPendingInteraction(self); window.dispatchEvent(new Event("office3:return-to-desk")); walkToAllowed(self, [self.home.x, self.home.y]); if (self.path.length) setActorState(self, "walking", "Returning to desk"); else if (self.tile[0] === self.home.x && self.tile[1] === self.home.y) { setActorState(self, "idle", "At your desk"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "You are already at your desk.", priority: "info" } })); } }
        else if (action === "message") { const self = founder(); if (self) window.dispatchEvent(new CustomEvent("office3:open-conversation", { detail: [self.person, target.person] })); }
        else if (action === "invite-conversation" && target.person.kind === "human") { const self = founder(); if (!self || ["dnd", "focus", "paused", "busy"].includes(target.state) || target.path.length) { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target.person.name} cannot join right now.`, priority: "warning" } })); return; } conversationInvites.set(target.person.slug, { from: self.person.slug, expiresAt: performance.now() + 15000 }); invitationPulses.set(target.person.slug, performance.now() + 900); setActorState(target, target.state, "Conversation invite sent"); network?.inviteConversation(target.person.slug); bus.emit("conv.invite", { from: self.person.slug, to: target.person.slug }); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Invited ${target.person.name}; waiting for their response.`, priority: "info" } })); window.setTimeout(() => { const invite = conversationInvites.get(target.person.slug); if (!invite || invite.from !== self.person.slug) return; conversationInvites.delete(target.person.slug); if (target.bubble === "Conversation invite sent") setActorState(target, target.state, ""); }, 15000); }
        else if (action === "invite-conversation") { const self = founder(); if (!self) return; if (["dnd", "focus", "paused", "busy"].includes(target.state) || target.path.length) { setActorState(target, target.state, "Busy right now"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target.person.name} cannot join right now.`, priority: "warning" } })); return; } conversationInvites.set(target.person.slug, { from: self.person.slug, expiresAt: performance.now() + 15000 }); invitationPulses.set(target.person.slug, performance.now() + 900); setActorState(target, target.state, "Conversation invite"); bus.emit("conv.invite", { from: self.person.slug, to: target.person.slug }); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Invited ${target.person.name} to your conversation.`, priority: "success" } })); window.setTimeout(() => { const invite = conversationInvites.get(target.person.slug); if (!invite || invite.from !== self.person.slug) return; conversationInvites.delete(target.person.slug); target.ring.scale.setScalar(selected.has(target.person.slug) ? 1.35 : 1); if (["dnd", "focus", "paused", "busy"].includes(target.state) || target.path.length) return; if (routeActor(target, self.tile, "Joining conversation")) bus.emit("conv.invite.accept", { from: self.person.slug, to: target.person.slug }); }, 900); }
        else if (action === "call-over") { const self = founder(); if (!self) return; if (["dnd", "focus", "paused", "busy"].includes(target.state) || target.path.length) { const prior = target.bubble; setActorState(target, target.state, "Busy right now"); window.setTimeout(() => { if (target.bubble === "Busy right now") setActorState(target, target.state, prior); }, 1800); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target.person.name} cannot be called over right now.`, priority: "warning" } })); bus.emit("call.done", { slug: target.person.slug }); return; } const origin = [...target.tile] as [number, number]; target.root.userData.office3CallOrigin = origin; calls.set(target.person.slug, { slug: target.person.slug, origin, requestedAt: performance.now(), status: "walking" }); const prior = target.bubble; setActorState(target, target.state, "Finishing current step…"); window.setTimeout(() => { if (!calls.has(target.person.slug) || target.root.userData.office3CallOrigin !== origin) return; if (["dnd", "focus", "paused", "busy"].includes(target.state) || target.path.length) { calls.delete(target.person.slug); delete target.root.userData.office3CallOrigin; setActorState(target, target.state, prior); return; } if (!routeActor(target, self.tile, "Coming over")) { calls.delete(target.person.slug); delete target.root.userData.office3CallOrigin; window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target.person.name} cannot reach this room.`, priority: "warning" } })); } }, 1000); bus.emit("call.request", { slug: target.person.slug }); }
        else if (action === "dismiss-call") { const origin = target.root.userData.office3CallOrigin as [number, number] | undefined; if (origin) { delete target.root.userData.office3CallOrigin; target.root.userData.office3ReturningCall = true; walkToAllowed(target, origin); setActorState(target, "idle", "Returning to desk"); bus.emit("call.done", { slug: target.person.slug }); } }
        else if (action === "pause-agent") { target.path.length = 0; setActorState(target, "paused", "Paused by founder"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target.person.name} paused.`, priority: "success" } })); }
        else if (action === "resume-agent") { setActorState(target, "idle", "Resumed"); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${target.person.name} resumed.`, priority: "success" } })); }
        else if (action === "wave") { const prior = target.bubble; setActorState(target, target.state, EMOTES.wave); window.setTimeout(() => setActorState(target, target.state, prior), 1800); }
      });
      return;
    }
    const objectRoot = pickWorldObject(event, view.renderer.domElement, view.camera, view.scene);
    const objectId = objectRoot?.userData.office3WorldObjectId;
    const worldObject = typeof objectId === "string" ? world.objects.find(item => item.id === objectId) : undefined;
    if (worldObject) {
      const interaction = interactionForPrefab(worldObject.prefab);
      openObjectContextMenu(host, { id: worldObject.id, prefab: worldObject.prefab, pos: worldObject.pos, interactable: Boolean(interaction) }, menuX, menuY, action => {
        bus.emit("ctx.action", { id: worldObject.id, action });
        if (action === "use") {
          const self = founder();
          if (!self || !interaction) return;
          const found = { target: worldObject, interaction };
          if (Math.hypot(self.tile[0] - worldObject.pos[0], self.tile[1] - worldObject.pos[1]) > 2) { self.root.userData.office3PendingInteraction = worldObject.id; self.root.userData.office3PendingInteractionUntil = performance.now() + 15000; walkToAllowed(self, worldObject.pos); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Walking to the object…", priority: "info" } })); return; }
          useInteraction(self, found);
        }
        else if (action === "inspect") {
          cameraRig.focusPoint(worldObject.pos[0] + .5, worldObject.pos[1] + .5);
          window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${worldObject.prefab} at tile ${worldObject.pos[0] + 1}, ${worldObject.pos[1] + 1}.`, priority: "success" } }));
        }
        else if (action === "open-in-builder") window.dispatchEvent(new CustomEvent("office3:edit-object", { detail: worldObject.id }));
      });
      return;
    }
    const bounds = view.renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), view.camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!hit) return;
    const tile: [number, number] = [Math.floor(hit.x), Math.floor(hit.z)];
    if (tile[0] < 0 || tile[1] < 0 || tile[0] >= world.size.w || tile[1] >= world.size.h) return;
    const room = world.rooms.find(candidate => tile[0] >= candidate.rect[0] && tile[0] <= candidate.rect[2] && tile[1] >= candidate.rect[1] && tile[1] <= candidate.rect[3]);
    if (room) {
      openRoomContextMenu(host, room, menuX, menuY, action => {
        bus.emit("ctx.action", { id: room.id, action });
        const center: [number, number] = [Math.floor((room.rect[0] + room.rect[2]) / 2), Math.floor((room.rect[1] + room.rect[3]) / 2)];
        if (action === "focus") cameraRig.focusPoint(center[0] + .5, center[1] + .5);
        else if (action === "start-meeting") {
          const self = founder();
          if (self) walkToAllowed(self, center);
          speakerRing.position.set(center[0] + .5, .04, center[1] + .5);
          speakerRing.visible = true;
          window.setTimeout(() => { speakerRing.visible = false; }, 5000);
          bus.emit("meeting.start", { room: room.id });
          window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Meeting marker started in ${room.label}.`, priority: "success" } }));
        }
        else if (action === "end-meeting") {
          bus.emit("meeting.end", { room: room.id });
          speakerRing.visible = false;
          window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Meeting ended.", priority: "success" } }));
        }
        else if (action === "meet-me") {
          const candidates = [...actors.values()].filter(actor => actor.person.kind !== "human");
          const invitees = candidates.filter(actor => !["dnd", "focus", "paused", "busy"].includes(actor.state) && !actor.path.length);
          for (const unavailable of candidates.filter(actor => !invitees.includes(actor))) { const prior = unavailable.bubble; setActorState(unavailable, unavailable.state, unavailable.state === "paused" ? "Paused — cannot join" : "Busy — cannot join"); window.setTimeout(() => { if (unavailable.bubble.includes("cannot join")) setActorState(unavailable, unavailable.state, prior); }, 1800); bus.emit("meeting.decline", { room: room.id, slug: unavailable.person.slug }); }
          for (const invitee of invitees) { invitationPulses.set(invitee.person.slug, performance.now() + 900); setActorState(invitee, invitee.state, `Meet in ${room.label}`); bus.emit("meeting.invite", { room: room.id, slug: invitee.person.slug }); window.setTimeout(() => { invitee.ring.scale.setScalar(selected.has(invitee.person.slug) ? 1.35 : 1); if (["dnd", "focus", "paused", "busy"].includes(invitee.state) || invitee.path.length) return; if (routeActor(invitee, center, `Meeting: ${room.label}`)) bus.emit("meeting.accept", { room: room.id, slug: invitee.person.slug }); else bus.emit("meeting.decline", { room: room.id, slug: invitee.person.slug }); }, 900); }
          window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: invitees.length ? `Meeting invite sent to ${invitees.length} agent${invitees.length === 1 ? "" : "s"}.` : "No available agents to invite.", priority: invitees.length ? "success" : "warning" } }));
        }
      });
      return;
    }
    openFloorContextMenu(host, tile, menuX, menuY, action => {
      bus.emit("ctx.action", { id: `tile:${tile.join(",")}`, action });
      if (action === "walk-here") { const self = founder(); if (self) { clearPendingInteraction(self); walkToAllowed(self, tile); } }
      else if (action === "ping") { interactionFx.spawn("ping", tile[0] + .5, tile[1] + .5); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Location pinged: ${tile[0] + 1}, ${tile[1] + 1}.`, priority: "success" } })); }
    });
  };
  view.renderer.domElement.addEventListener("click", onClick);
  view.renderer.domElement.addEventListener("contextmenu", onContextMenu);
  view.renderer.domElement.addEventListener("mousemove", onPointerMove);
  view.renderer.domElement.addEventListener("mouseleave", onPointerLeave);
  view.renderer.domElement.addEventListener("mousedown", onPointerDown);
  view.renderer.domElement.addEventListener("mouseup", onPointerUp);
  let longPressTimer: number | null = null;
  const clearLongPress = () => { if (longPressTimer !== null) { window.clearTimeout(longPressTimer); longPressTimer = null; } };
  const onTouchStart = (event: TouchEvent) => { if (event.touches.length !== 1) return; const touch = event.touches[0]; clearLongPress(); longPressTimer = window.setTimeout(() => { longPressTimer = null; view.renderer.domElement.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: touch.clientX, clientY: touch.clientY })); }, 550); };
  const onTouchMove = () => clearLongPress();
  view.renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
  view.renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: true });
  view.renderer.domElement.addEventListener("touchend", clearLongPress, { passive: true });
  view.renderer.domElement.addEventListener("touchcancel", clearLongPress, { passive: true });
  window.addEventListener("keydown", onKey);
  const onEmote = (event: Event) => { const emote = (event as CustomEvent<unknown>).detail; const actor = founder(); if (actor && typeof emote === "string" && Object.hasOwn(EMOTES, emote)) triggerEmote(actor, emote as Emote); };
  window.addEventListener("office3:emote", onEmote);
  window.addEventListener("office3:clear-selection", clearSelectionEvent);
  const names: string[] = await fetch("/office3/characters/index.json").then((response) => response.json());
  const sync = (people: Person[]) => {
    const self = people.find(person => person.kind === "human");
    if (self) startNetwork(self.slug);
    const wanted = new Set(people.map((person) => person.slug));
    for (const [slug, actor] of actors) if (!wanted.has(slug)) { removeActor(view.scene, actor); actors.delete(slug); }
    refreshDeskPlants();
    const seats = planSeats(people, model.spots);
    for (const person of people) if (!actors.has(person.slug)) void addActor(view.scene, actors, prefabs, names, person, seats.get(person.slug)!).then(() => { const actor = actors.get(person.slug); if (!actor) return; if (pausedAgents.has(person.slug)) { actor.path.length = 0; setActorState(actor, "paused", "Paused by founder"); } if (person.kind === "human") { const status = localStorage.getItem("office3.founder-status"); if (status === "focus") setActorState(actor, "focus", "Focus mode"); else if (status === "dnd") setActorState(actor, "dnd", "Do not disturb"); } refreshDeskPlants(); });
  };
  const stats: Office3Stats = { fps: 0, calls: 0, triangles: 0, people: 0, loadedMs: 0, p95Ms: 0, heapMb: null };
  let quality: QualityTier = "high";
  let automaticQuality = true;
  { const forced = hashParams().get("quality"); if (forced === "low" || forced === "medium" || forced === "high") { quality = forced; automaticQuality = false; view.setQuality(quality); } } // benchmark/profiling override
  const clock = new THREE.Clock();
  let active = true, frame = 0, sampleElapsed = 0, sampleFrames = 0, labelElapsed = 0, wanderElapsed = 0, conversationElapsed = 0, agentLifeElapsed = 0, scheduleElapsed = 0, speakerElapsed = 0, incidentElapsed = 0, networkElapsed = 0, speakerIndex = 0, qualityChangedAt = performance.now(), activeSchedule: ScheduleAction = null, incidentOpen = false;
  const conversationGreetings = new Map<string, number>();
  let labelMode: "all" | "near" | "hover" | "off" = "all", labelScale = 1, reducedMotion = false, photoMode = false, interactionKey = "e", cameraCycleKey = "t", meetingFraming: "auto" | "speaker" | "wide" = "auto", lastFounderFootstep = "";
  const farActorUpdatedAt = new Map<string, number>();
  const animationFrustum = new THREE.Frustum(), animationProjection = new THREE.Matrix4();
  let taskElapsed = 0;
  const frameMs: number[] = [];
  const wandering = hashParams().get("wander") === "1";
  let lastFrameAt = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (!active) return;
    { const t = performance.now(); if (shouldSkipFrame(t, lastFrameAt)) return; lastFrameAt = t; }  // Performance Settings: max_fps
    const seconds = Math.min(clock.getDelta(), 0.1);
    frameMs.push(seconds * 1000);
    view.camera.updateMatrixWorld();
    animationProjection.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse);
    animationFrustum.setFromProjectionMatrix(animationProjection);
    if ((networkElapsed += seconds) >= .2) { networkElapsed = 0; const self = networkIdentity && actors.get(networkIdentity); if (self) network?.move(self.root.position.x, self.root.position.z, self.root.rotation.y, self.current ?? "idle"); }
    if (network && networkIdentity) for (const actor of actors.values()) { if (actor.person.slug === networkIdentity) continue; const position = network.interpolated(actor.person.slug); if (!position) continue; actor.root.position.set(position.x, actor.root.position.y, position.z); actor.proxy.position.set(position.x, .66, position.z); actor.ring.position.set(position.x, .03, position.z); actor.label.position.set(position.x, 2.45, position.z); actor.tile = [Math.floor(position.x), Math.floor(position.z)]; actor.root.rotation.y = position.facing; play(actor, position.anim === "walk" ? "walk" : "idle"); }
    for (const actor of actors.values()) { const distance = actor.root.position.distanceTo(view.camera.position), far = distance > 45, visible = animationFrustum.containsPoint(actor.root.position), lod = actors.size <= 40 ? "full" : far ? "proxy" : distance > 24 ? "reduced" : "full"; /* few agents: always draw real people (animation is still throttled at distance) */ setActorLod(actor, lod); const throttled = far || !visible; const interval = throttled ? 1 / (!visible ? 10 : qualitySettings(quality).farAnimationHz) : 0; const now = performance.now(), previous = farActorUpdatedAt.get(actor.person.slug) ?? now; if (interval && now - previous < interval * 1000) continue; const actorSeconds = throttled ? Math.max(seconds, (now - previous) / 1000) : seconds; farActorUpdatedAt.set(actor.person.slug, now); actor.mixer.update(actorSeconds); if (actor.state === "paused") continue; updateNavigation(actor, actorSeconds, bus); completePendingInteraction(actor, now); if (actor.root.userData.office3ReturningCall && !actor.path.length) { delete actor.root.userData.office3ReturningCall; setActorState(actor, "idle", ""); } const interaction = actor.root.userData.office3Interaction as import("./core/interactions").InteractionId | undefined; if (reducedMotion) resetProceduralMotion(actor); else if (interaction && !actor.root.userData.office3InteractionClip) applyInteractionMotion(actor, interaction, now / 1000); else if (!interaction && !applyEmoteMotion(actor, actor.bubble, now / 1000)) applyIdleMotion(actor, now / 1000); }
    const followedActor = cameraFollowSlug ? actors.get(cameraFollowSlug) : undefined;
    if (cameraFollowSlug && !followedActor) cameraFollowSlug = null;
    if (followedActor) cameraRig.followPoint(followedActor.root.position.x, followedActor.root.position.z, seconds);
    actorProxyActors.clear(); let proxyCount = 0;
    for (const actor of actors.values()) { if (actor.lod === "full" || proxyCount >= actorProxyInstances.instanceMatrix.count) continue; proxyPosition.set(actor.root.position.x, .66, actor.root.position.z); proxyMatrix.compose(proxyPosition, proxyRotation.copy(actor.root.quaternion), proxyScale); actorProxyInstances.setMatrixAt(proxyCount, proxyMatrix); actorProxyInstances.setColorAt(proxyCount, new THREE.Color((actor.ring.material as THREE.MeshBasicMaterial).color)); actorProxyActors.set(proxyCount++, actor); }
    actorProxyInstances.count = proxyCount;
    actorProxyInstances.instanceMatrix.needsUpdate = true;
    if (actorProxyInstances.instanceColor) actorProxyInstances.instanceColor.needsUpdate = true;
    for (const [slug, expiresAt] of invitationPulses) { const actor = actors.get(slug); if (!actor || performance.now() >= expiresAt) { invitationPulses.delete(slug); if (actor) actor.ring.scale.setScalar(selected.has(slug) ? 1.35 : 1); continue; } const base = selected.has(slug) ? 1.35 : 1; actor.ring.scale.setScalar(base + .3 + Math.sin(performance.now() / 90) * .14); }
    const founderActor = founder(); if (founderActor) { const key = founderActor.tile.join(","); if (lastFounderFootstep && key !== lastFounderFootstep) audio.footstep(floorMaterialAt(founderActor.tile)); lastFounderFootstep = key; if (founderActor.state === "idle" && performance.now() - founderLastActiveAt >= 300000) setActorState(founderActor, "away", "Away"); }
    for (let index = follows.length - 1; index >= 0; index--) { const follow = follows[index], leader = actors.get(follow.leader), follower = actors.get(follow.follower); if (!leader || !follower || ["dnd", "focus", "paused", "busy"].includes(leader.state)) { follows.splice(index, 1); bus.emit("follow.stop", { slug: follow.follower }); continue; } if (!follower.path.length) walkTo(follower, [leader.tile[0], leader.tile[1] + 1], model); }
    for (const [slug, call] of calls) { const target = actors.get(slug), self = founder(); if (!target || !self) { calls.delete(slug); continue; } const next = resolveCallOver(call, performance.now(), Math.hypot(target.tile[0] - self.tile[0], target.tile[1] - self.tile[1])); calls.set(slug, next); if (next.status === "arrived") { const report = target.task ? `On: ${target.task.length > 14 ? `${target.task.slice(0, 14)}…` : target.task}` : "Anything else?"; setActorState(target, "waiting_human", report); bus.emit("call.arrive", { slug }); calls.delete(slug); } else if (next.status === "timed-out") { delete target.root.userData.office3CallOrigin; target.root.userData.office3ReturningCall = true; walkToAllowed(target, call.origin); setActorState(target, "idle", "Returning to desk"); bus.emit("call.done", { slug }); calls.delete(slug); } }
    if ((agentLifeElapsed += seconds) >= 3) { agentLifeElapsed = 0; void fetchAgentThreads().then(threads => { const now = performance.now(); for (const [thread, meeting] of activeAgentMeetings) if (threads.find(entry => entry.id === thread)?.kind === "conclusion") meeting.expiresAt = now; const activeThreads = new Set(activeAgentMeetings.keys()); const meetings = planAgentMeetings(threads, [...actors.values()].filter(actor => actor.person.kind !== "human").map(actor => ({ slug: actor.person.slug, tile: actor.tile, busy: actor.path.length > 0 || actor.state === "paused" })), activeThreads); const queued = queuedAgentThreads(threads, activeThreads); window.dispatchEvent(new CustomEvent("office3:agent-thread-queue", { detail: { count: queued.length, threads: queued.map(thread => thread.id) } })); for (const meeting of meetings) { const from = actors.get(meeting.from), to = actors.get(meeting.to); if (!from || !to || activeAgentMeetings.has(meeting.thread)) continue; activeAgentMeetings.set(meeting.thread, { from: meeting.from, to: meeting.to, expiresAt: now + 8000, text: meeting.text, fromBubble: from.bubble, toBubble: to.bubble }); walkTo(from, meeting.point, model); walkTo(to, meeting.point, model); setActorState(from, from.state, meeting.text); setActorState(to, to.state, "…"); void fetchAgentThreadMessages(meeting.thread).then(messages => { const activeMeeting = activeAgentMeetings.get(meeting.thread); if (!activeMeeting || !messages.length) return; const ask = [...messages].reverse().find(message => message.from_slug === meeting.from)?.text ?? messages[0]?.text; const reply = [...messages].reverse().find(message => message.from_slug === meeting.to)?.text ?? messages[1]?.text; const latestFrom = actors.get(meeting.from), latestTo = actors.get(meeting.to); if (latestFrom && ask) { activeMeeting.text = ask.slice(0, 40); setActorState(latestFrom, latestFrom.state, activeMeeting.text); } if (latestTo && reply) { activeMeeting.toText = reply.slice(0, 40); setActorState(latestTo, latestTo.state, activeMeeting.toText); } }).catch(() => undefined); } }).catch(() => undefined); }
    if ((taskElapsed += seconds) >= 5) { taskElapsed = 0; void fetch("/api/hive/tasks").then(response => response.ok ? response.json() : {}).then((board: Record<string, { title?: string; assignee?: string }[]>) => { const tasks = Object.entries(board).flatMap(([status, entries]) => entries.map(task => ({ ...task, status }))); for (const actor of actors.values()) { const assigned = tasks.filter(item => item.assignee === actor.person.slug || item.assignee === actor.person.name); const task = assigned.find(item => item.status === "doing") ?? assigned[0]; setActorTask(actor, task?.title ?? ""); if (actor.person.kind !== "human") { const completed = assigned.filter(item => item.status === "done").length, failures = assigned.filter(item => item.status === "blocked").length; const mood = moodFor(completed, failures, assigned.length), rank = rankFor(completed); setActorMood(actor, ({ focused: "◉", happy: "☺", strained: "!", tired: "…" })[mood], rankColor(rank)); } } }).catch(() => undefined); }
    if ((scheduleElapsed += seconds) >= 5) { scheduleElapsed = 0; const simulated = hashParams().get("now")?.match(/^(\d{1,2}):(\d{2})$/); const now = new Date(), hour = simulated ? Number(simulated[1]) : now.getHours(), minute = simulated ? Number(simulated[2]) : now.getMinutes(), next = scheduledAction(hour, minute); if (next !== activeSchedule) { if (activeSchedule === "standup") { bus.emit("meeting.end", { room: "meeting" }); speakerRing.visible = false; } activeSchedule = next; applySchedule(actors, model, next); if (next === "standup") { bus.emit("meeting.start", { room: "meeting" }); if (meetingFraming === "wide") { const room = world.rooms.find(item => item.id === "meeting"); if (room) cameraRig.focusPoint((room.rect[0] + room.rect[2] + 1) / 2, (room.rect[1] + room.rect[3] + 1) / 2); } } } }
    if (activeSchedule === "standup" && (speakerElapsed += seconds) >= 3) { speakerElapsed = 0; const attendees = [...actors.values()].filter(actor => actor.person.kind !== "human" && actor.place === "meeting"); const speakers = attendees.filter(actor => !actor.path.length); const speaker = (speakers.length ? speakers : attendees)[speakerIndex++ % Math.max(1, speakers.length || attendees.length)]; if (speaker) { if (meetingFraming !== "wide") cameraRig.focusPoint(speaker.root.position.x, speaker.root.position.z); speakerRing.position.set(speaker.root.position.x, .04, speaker.root.position.z); speakerRing.visible = true; setActorState(speaker, speaker.state, "Speaking"); window.setTimeout(() => { if (speaker.bubble === "Speaking") setActorState(speaker, speaker.state, ""); }, 1800); bus.emit("meeting.speaker", { slug: speaker.person.slug }); } }
    if ((incidentElapsed += seconds) >= 15) { incidentElapsed = 0; void fetch("/api/alerts/").then(response => response.ok ? response.json() : { open: [] }).then((alerts: { open?: { id?: number; title?: string }[] }) => { const activeIncident = Boolean(alerts.open?.length), alert = alerts.open?.[0]; activeAlertId = typeof alert?.id === "number" ? alert.id : null; lighting.setIncident(activeIncident); incidentBanner.style.display = activeIncident ? "block" : "none"; incidentBanner.textContent = activeIncident ? `Incident: ${alert?.title ?? "Attention required"} · Acknowledge` : ""; if (activeIncident !== incidentOpen) { incidentOpen = activeIncident; window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: activeIncident ? `Incident response started: ${alert?.title ?? "attention required"}.` : "Incident resolved. Responders are returning to their desks.", priority: activeIncident ? "warning" : "success" } })); } applyIncident(actors, model, activeIncident); }).catch(() => undefined); }
    const cursorNow = performance.now(); for (const [id, cursor] of editorCursors) if (cursorNow - cursor.seenAt > 5000) { cursor.marker.removeFromParent(); cursor.marker.geometry.dispose(); (cursor.marker.material as THREE.Material).dispose(); editorCursors.delete(id); } updateMeetingLines(cursorNow); interactionFx.update(cursorNow);
    if ((labelElapsed += seconds) >= .2) { labelElapsed = 0; layoutActorLabels(actors.values(), view.camera, view.renderer.domElement.clientWidth, view.renderer.domElement.clientHeight, photoMode ? "off" : labelMode, labelScale, hovered?.person.slug ?? null); for (const actor of actors.values()) if (actor.lod === "proxy") { actor.label.visible = false; actor.leader.visible = false; } }
    updateInteractionHint();
    if ((conversationElapsed += seconds) >= .25) { conversationElapsed = 0; const roomFor = (tile: readonly [number, number]) => world.rooms.find(room => tile[0] >= room.rect[0] && tile[0] <= room.rect[2] && tile[1] >= room.rect[1] && tile[1] <= room.rect[3]); const isPrivateGroup = (group: readonly string[]) => { const rooms = group.map(slug => actors.get(slug)).filter((actor): actor is OfficeActor => Boolean(actor)).map(actor => roomFor(actor.tile)); return rooms.length === group.length && rooms.every(room => room?.id === rooms[0]?.id) && rooms[0]?.kind === "private"; }; const update = conversations.update([...actors.values()].map(item => ({ id: item.person.slug, tile: item.tile, walking: item.path.length > 0, silent: Boolean(roomFor(item.tile)?.rules.silent), dnd: item.state === "dnd", focus: item.state === "focus" }))); for (const group of update.groups) if (isPrivateGroup(group)) conversations.lockGroup(group); const lockedKeys = new Set([...update.lockedGroups, ...update.groups.filter(group => conversations.isGroupLocked(group))].map(group => [...group].sort().join(":"))); updateConversationHalos(update.groups, lockedKeys); for (const slug of update.joined) { bus.emit("conv.join", { slug }); const group = update.groups.find(item => item.includes(slug)); const newcomer = actors.get(slug), partner = group?.map(id => actors.get(id)).find((actor): actor is OfficeActor => Boolean(actor && actor.person.slug !== slug)); if (!newcomer || !partner) continue; const key = [newcomer.person.slug, partner.person.slug].sort().join(":"), greetingNow = performance.now(); const greetedAt = conversationGreetings.get(key) ?? 0; if (greetingNow - greetedAt < 600000) continue; conversationGreetings.set(key, greetingNow); if (!newcomer.path.length && newcomer.spot?.type !== "seat") newcomer.root.rotation.y = Math.atan2(partner.root.position.x - newcomer.root.position.x, partner.root.position.z - newcomer.root.position.z); if (!partner.path.length && partner.spot?.type !== "seat") partner.root.rotation.y = Math.atan2(newcomer.root.position.x - partner.root.position.x, newcomer.root.position.z - partner.root.position.z); const newcomerBubble = newcomer.bubble, partnerBubble = partner.bubble; setActorState(newcomer, newcomer.state, EMOTES.wave); setActorState(partner, partner.state, "Hello!"); window.setTimeout(() => { if (newcomer.bubble === EMOTES.wave) setActorState(newcomer, newcomer.state, newcomerBubble); if (partner.bubble === "Hello!") setActorState(partner, partner.state, partnerBubble); }, 2500); } for (const slug of update.left) bus.emit("conv.leave", { slug }); const self = founder(); const group = self && update.groups.find(item => item.includes(self.person.slug)); if (group) { activeConversationGroup = group; activeConversationLocked = conversations.isGroupLocked(group); activeConversationPrivate = isPrivateGroup(group); const waiting = group.some(slug => ["thinking", "waiting_tool"].includes(actors.get(slug)?.state ?? "")); conversationLabel.textContent = `${activeConversationLocked ? "🔒 " : ""}Talk to ${group.length - 1} nearby${waiting ? " · …" : ""}`; conversationLock.textContent = activeConversationLocked ? "Unlock" : "Lock"; conversationChip.style.display = "flex"; const members = group.map(slug => actors.get(slug)?.person).filter(Boolean); window.dispatchEvent(new CustomEvent("office3:conversation-group", { detail: { members, privateRoom: activeConversationPrivate } })); } else { activeConversationGroup = []; activeConversationLocked = false; activeConversationPrivate = false; conversationChip.style.display = "none"; } }
    if (photoMode) conversationChip.style.display = "none";
    activeCallActor = [...actors.values()].find(actor => actor.state === "waiting_human" && Array.isArray(actor.root.userData.office3CallOrigin)) ?? null;
    if (activeCallActor && !photoMode) { callLabel.textContent = `${activeCallActor.person.name}: ${activeCallActor.bubble || "Anything else?"}`; callChip.style.display = "flex"; } else callChip.style.display = "none";
    if (selectedWorldObjectId && worldObjectSelection.visible) { const root = (view.scene.userData.office3WorldObjects as Map<string, THREE.Object3D> | undefined)?.get(selectedWorldObjectId); if (root) worldObjectSelection.box.setFromObject(root); else { selectedWorldObjectId = null; worldObjectSelection.visible = false; } }
    if (wandering && (wanderElapsed += seconds) > 1) { wanderElapsed = 0; wanderActors(actors, model); }
    lighting.update(); for (const opened of updateDoors(view.scene, [...actors.values()].map(actor => [actor.tile[0], actor.tile[1]] as [number, number]), seconds)) audio.door(opened); cameraRig.tick(seconds, reducedMotion); view.controls.update(); wallOcclusion.setTarget(view.controls.target); wallOcclusion.update(view.camera); view.renderer.render(view.scene, view.camera);
    if (benchmark) { const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize; benchmark.sample({ frameMs: seconds * 1000, calls: view.renderer.info.render.calls, triangles: view.renderer.info.render.triangles, people: actors.size, heapMb: heap === undefined ? null : Math.round(heap / 1048576 * 10) / 10 }); if (!benchmarkPublished && performance.now() - startedAt >= 10000) { benchmarkPublished = true; const report = { ...benchmark.result(), screenshot: view.renderer.domElement.toDataURL("image/png") }; window.__office3Benchmark = report; window.dispatchEvent(new CustomEvent("office3:benchmark-complete", { detail: report })); } }
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
    actors: () => [...actors.values()].map((actor) => ({ slug: actor.person.slug, kind: actor.person.kind, x: actor.root.position.x, z: actor.root.position.z, anim: actor.current, place: actor.place, state: actor.state, look: actor.appearance.look, tint: actor.appearance.tints.top })),
    camera: () => ({ x: view.camera.position.x, y: view.camera.position.y, z: view.camera.position.z, tx: view.controls.target.x, ty: view.controls.target.y, tz: view.controls.target.z }),
    quality: () => quality, bus: { count: (name) => bus.count(name) },
  };
  const ready = Promise.all(jobs).then(() => { stats.loadedMs = Math.round(performance.now() - startedAt); });
  return {
    ready, sync, rooms: () => world.rooms.map(room => ({ id: room.id, label: room.label, kind: room.kind })), applyObjectTransform: (id, patch) => { const object = world.objects.find(item => item.id === id); if (!object) return; Object.assign(object, patch); applyWorldObjectTransform(view.scene, id, object); }, focusPerson: (slug) => { const actor = actors.get(slug); if (actor) { cameraRig.focusPoint(actor.root.position.x, actor.root.position.z); } }, focusRoom: (id) => { const room = world.rooms.find(item => item.id === id); if (room) cameraRig.focusPoint((room.rect[0] + room.rect[2] + 1) / 2, (room.rect[1] + room.rect[3] + 1) / 2); }, focusPoint: (x, z) => cameraRig.focusPoint(x, z), setFounderAppearance: (appearance) => { const actor = founder(); if (actor) { applyAppearance(actor, appearance); localStorage.setItem("office3.appearance", JSON.stringify(appearance)); } }, setFounderCustomModel: async (url) => { const actor = founder(); if (!actor) throw Error("Founder actor is not ready."); await applyCustomModel(actor, prefabs, url); }, resolveAttention: (slug, approved) => resolveAttention(actors, model, slug, approved), applyLive: (live) => applyLiveStates(actors, model, live, bus), stats: () => ({ ...stats }),
    setActive: (next) => { active = next; if (next) clock.getDelta(); },
    setViewSettings: (settings) => { wallOcclusion.setMode(settings.walls as "auto" | "cutaway" | "full"); lighting.setMode(settings.lighting as import("./core/dayclock").LightingMode); audio.setEnabled(settings.sound); audio.setVolume(settings.soundVolume); audio.setCategoryVolumes(settings.interactionVolume, settings.doorVolume); audio.setNoticePreferences(settings.notifications, settings.doNotDisturb); labelMode = settings.privacyMode ? "off" : settings.labels as typeof labelMode; labelScale = settings.labelScale; reducedMotion = settings.reducedMotion; interactionKey = settings.interactionKey; cameraCycleKey = settings.cameraCycleKey ?? "t"; meetingFraming = settings.meetingFraming ?? "auto"; automaticQuality = settings.quality === "auto"; if (!automaticQuality) { quality = settings.quality as QualityTier; qualityChangedAt = performance.now(); view.setQuality(quality); } },
    setTheme: (id) => { const theme = themeById(id); world.theme = theme.id; applyTheme(view.scene, theme); lighting.setMode(theme.light); localStorage.setItem("office3.theme", theme.id); },
    setPhotoMode: (enabled) => { photoMode = enabled; cameraRig.setPhotoMode(enabled); if (enabled) { interactionHint.style.display = "none"; conversationChip.style.display = "none"; callChip.style.display = "none"; for (const actor of actors.values()) { actor.label.visible = false; actor.leader.visible = false; } } },
    capturePng: (transparent = false) => { const background = view.scene.background, alpha = view.renderer.getClearAlpha(); if (transparent) { view.scene.background = null; view.renderer.setClearAlpha(0); } view.renderer.render(view.scene, view.camera); const image = view.renderer.domElement.toDataURL("image/png"); if (transparent) { view.scene.background = background; view.renderer.setClearAlpha(alpha); view.renderer.render(view.scene, view.camera); } return image; },
    setZoneOverlay: (visible) => zoneOverlay.setVisible(visible),
    setEditMode: (enabled) => { editMode = enabled; builderOverlay.setEnabled(enabled); if (enabled) bus.emit("edit.enter", {}); else bus.emit("edit.exit", {}); },
    setBuilderPrefab: (id) => { builderPrefab = id; },
    applyRoomRules: (roomId, rules) => { const room = world.rooms.find(item => item.id === roomId); if (!room) return; room.rules = { ...room.rules, ...rules }; zoneOverlay.refresh(world); bus.emit("world.change", { rev: 0 }); },
    applyRoomRect: (roomId, rect) => { const room = world.rooms.find(item => item.id === roomId); if (!room) return; room.rect = rect; zoneOverlay.refresh(world); bus.emit("world.change", { rev: 0 }); },
    setFounderSpawn: (position) => { world.spawn = { founder: position, default: position }; const actor = founder(); if (actor) placeActor(actor, position); bus.emit("world.change", { rev: 0 }); },
    insertRoomTemplate: insertTemplate, autoFurnishRoom: (roomId) => { const room = world.rooms.find(item => item.id === roomId); if (room) insertTemplate(roomId, templateForRoomKind(room.kind)); },
    saveBuilderDraft: persistBuilderDraft,
    destroy: () => { cancelAnimationFrame(frame); clearLongPress(); network?.disconnect(); observer.disconnect(); view.controls.removeEventListener("start", stopCameraFollowOnManualControl); window.removeEventListener("pointerdown", markFounderActive, true); window.removeEventListener("keydown", onKey); window.removeEventListener("office3:emote", onEmote); window.removeEventListener("office3:clear-selection", clearSelectionEvent); window.removeEventListener("office3:birthday", onBirthday); window.removeEventListener("office3:person-session-changed", onPersonSessionChanged); window.removeEventListener("office3:toast", onToastAudio); view.renderer.domElement.removeEventListener("click", onClick); view.renderer.domElement.removeEventListener("contextmenu", onContextMenu); view.renderer.domElement.removeEventListener("mousemove", onPointerMove); view.renderer.domElement.removeEventListener("mouseleave", onPointerLeave); view.renderer.domElement.removeEventListener("mousedown", onPointerDown); view.renderer.domElement.removeEventListener("mouseup", onPointerUp); view.renderer.domElement.removeEventListener("touchstart", onTouchStart); view.renderer.domElement.removeEventListener("touchmove", onTouchMove); view.renderer.domElement.removeEventListener("touchend", clearLongPress); view.renderer.domElement.removeEventListener("touchcancel", clearLongPress); selectionBox.remove(); interactionHint.remove(); conversationChip.remove(); callChip.remove(); interactionFx.dispose(); audio.dispose(); incidentBanner.remove(); speakerRing.removeFromParent(); speakerRing.geometry.dispose(); (speakerRing.material as THREE.Material).dispose(); deskPlantPots.removeFromParent(); deskPlantLeaves.removeFromParent(); deskPlantPots.geometry.dispose(); deskPlantLeaves.geometry.dispose(); (deskPlantPots.material as THREE.Material).dispose(); (deskPlantLeaves.material as THREE.Material).dispose(); worldObjectSelection.removeFromParent(); worldObjectSelection.geometry.dispose(); (worldObjectSelection.material as THREE.Material).dispose(); for (const line of meetingLines.values()) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); } for (const halo of conversationHalos.values()) { halo.geometry.dispose(); (halo.material as THREE.Material).dispose(); } for (const cursor of editorCursors.values()) { cursor.marker.removeFromParent(); cursor.marker.geometry.dispose(); (cursor.marker.material as THREE.Material).dispose(); } meetingLineGroup.removeFromParent(); for (const actor of actors.values()) removeActor(view.scene, actor); actors.clear(); cameraRig.dispose(); builderOverlay.dispose(); zoneOverlay.dispose(); view.dispose(); window.__officeFps = undefined; window.__officePeople = undefined; window.__office3Stats = undefined; window.__office3Benchmark = undefined; },
  };
}
