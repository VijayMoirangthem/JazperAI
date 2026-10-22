export type AgentMood = "focused" | "happy" | "strained" | "tired";
export type AgentRank = "probation" | "active" | "senior";
export const moodFor = (successes: number, failures: number, workload: number): AgentMood => failures > successes ? "strained" : workload > 8 ? "tired" : successes >= 3 ? "happy" : "focused";
export const rankFor = (completed: number): AgentRank => completed >= 100 ? "senior" : completed >= 10 ? "active" : "probation";
export const rankColor = (rank: AgentRank): string => ({ probation: "#94a3b8", active: "#38bdf8", senior: "#eab308" })[rank];
