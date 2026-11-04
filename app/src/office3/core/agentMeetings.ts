export interface AgentPosition { slug: string; tile: readonly [number, number]; busy?: boolean; }
export interface AgentThread { id: string; from: string; to: string; text: string; kind: string; }
export interface AgentMeeting { thread: string; from: string; to: string; point: [number, number]; text: string; }

export const AGENT_MEETING_LIMIT = 4;
export const isAgentMeetingThread = (thread: AgentThread) => ["ask", "reply", "message"].includes(thread.kind);

/** Threads that cannot begin yet because the capped meeting slots are occupied. */
export const queuedAgentThreads = (threads: readonly AgentThread[], activeThreads: ReadonlySet<string>, limit = AGENT_MEETING_LIMIT): AgentThread[] => {
  const available = Math.max(0, limit - activeThreads.size);
  return threads.filter(isAgentMeetingThread).filter(thread => !activeThreads.has(thread.id)).slice(available);
};

/** Pick stable midpoint meeting locations while limiting concurrent agent conversations. */
export const planAgentMeetings = (threads: readonly AgentThread[], actors: readonly AgentPosition[], activeThreads: ReadonlySet<string> = new Set(), limit = AGENT_MEETING_LIMIT): AgentMeeting[] => {
  if (activeThreads.size >= limit) return [];
  const bySlug = new Map(actors.map(actor => [actor.slug, actor]));
  return threads.filter(isAgentMeetingThread).filter(thread => !activeThreads.has(thread.id)).slice(0, limit - activeThreads.size).flatMap(thread => {
    const from = bySlug.get(thread.from), to = bySlug.get(thread.to);
    if (!from || !to || from.busy || to.busy) return [];
    return [{ thread: thread.id, from: thread.from, to: thread.to, point: [Math.round((from.tile[0] + to.tile[0]) / 2), Math.round((from.tile[1] + to.tile[1]) / 2)] as [number, number], text: thread.text.slice(0, 40) }];
  });
};
