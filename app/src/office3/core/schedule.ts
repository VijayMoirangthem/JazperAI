export type ScheduleAction = "standup" | "lunch" | "desks" | null;
export interface SchedulePerson { state: string; kind: "human" | "agent"; }
export const scheduledAction = (hour: number, minute: number): ScheduleAction => {
  const clock = hour * 60 + minute;
  if (clock >= 570 && clock < 600) return "standup";
  if (clock >= 720 && clock < 780) return "lunch";
  if (clock >= 1080 && clock < 1110) return "desks";
  return null;
};
export const mayScheduleMove = (person: SchedulePerson): boolean => person.kind === "agent" && person.state !== "waiting_human" && person.state !== "escalated";
