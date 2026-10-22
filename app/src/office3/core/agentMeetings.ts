export interface AgentPosition { slug: string; tile: readonly [number, number]; busy?: boolean; }
export interface AgentThread { id: string; from: string; to: string; text: string; kind: string; }
export interface AgentMeeting { thread: string; from: string; to: string; point: [number, number]; text: string; }

/** Pick stable midpoint meeting locations while limiting concurrent agent conversations. */
export const planAgentMeetings = (threads: readonly AgentThread[], actors: readonly AgentPosition[], active: number, limit = 4): AgentMeeting[] => {
  if (active >= limit) return [];
  const bySlug = new Map(actors.map(actor => [actor.slug, actor]));
  return threads.filter(thread => ["ask", "reply", "message"].includes(thread.kind)).slice(0, limit - active).flatMap(thread => {
    const from = bySlug.get(thread.from), to = bySlug.get(thread.to);
    if (!from || !to || from.busy || to.busy) return [];
    return [{ thread: thread.id, from: thread.from, to: thread.to, point: [Math.round((from.tile[0] + to.tile[0]) / 2), Math.round((from.tile[1] + to.tile[1]) / 2)] as [number, number], text: thread.text.slice(0, 40) }];
  });
};
