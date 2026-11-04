import type { AgentThread } from "../core/agentMeetings";

interface CommsThread { thread: string; from_slug: string; to_slug: string; kind: string; preview: string; }
export interface AgentThreadMessage { id: number; from_slug: string; to_slug: string; kind: string; text: string; }

export const fetchAgentThreads = async (baseUrl = ""): Promise<AgentThread[]> => {
  const response = await fetch(`${baseUrl}/api/v1/comms/threads`);
  if (!response.ok) return [];
  const payload = await response.json() as { threads?: CommsThread[] };
  return (payload.threads ?? []).map(thread => ({ id: thread.thread, from: thread.from_slug, to: thread.to_slug, kind: thread.kind, text: thread.preview }));
};

/** Bounded transcript hydration for the handful of currently visible agent meetings. */
export const fetchAgentThreadMessages = async (thread: string, baseUrl = ""): Promise<AgentThreadMessage[]> => {
  const response = await fetch(`${baseUrl}/api/v1/comms/thread?id=${encodeURIComponent(thread)}`);
  if (!response.ok) return [];
  const payload = await response.json() as { messages?: AgentThreadMessage[] };
  return (payload.messages ?? []).slice(-2);
};
