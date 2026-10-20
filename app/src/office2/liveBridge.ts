import { useLiveAgents, type LiveAgent } from "@/stores/liveAgentsStore";

/** Feeds live agent states into the scene, coalesced to at most one call per animation frame. Returns the unsubscribe. */
export function bindLive(target: { applyLive(a: Record<string, LiveAgent>): void }): () => void {
  let queued = false;
  const flush = () => { queued = false; target.applyLive(useLiveAgents.getState().agents); };
  const unsub = useLiveAgents.subscribe(() => { if (!queued) { queued = true; requestAnimationFrame(flush); } });
  flush();
  return unsub;
}
