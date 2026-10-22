export type TargetKind = "actor" | "object" | "room" | "floor";
export type OfficeRole = "founder" | "admin" | "member";
export interface ActionContext { target: TargetKind; role: OfficeRole; state?: string; editMode?: boolean; isSelf?: boolean; isAgent?: boolean; }
export interface ContextAction { id: string; label: string; icon?: string; targets: TargetKind[]; when?: (context: ActionContext) => boolean; permission?: (context: ActionContext) => boolean; }
const allowed = (target: TargetKind) => (context: ActionContext) => context.target === target;
export const CONTEXT_ACTIONS: readonly ContextAction[] = [
  { id: "view-card", label: "View card", targets: ["actor"], when: context => !context.isSelf },
  { id: "message", label: "Message", targets: ["actor"], when: context => !context.isSelf },
  { id: "follow", label: "Follow", targets: ["actor"], when: context => !context.isSelf },
  { id: "call-over", label: "Call over", targets: ["actor"], when: context => Boolean(context.isAgent && !context.isSelf) },
  { id: "go-to", label: "Go to", targets: ["actor"], when: context => !context.isSelf },
  { id: "wave", label: "Wave", targets: ["actor"] },
  { id: "edit-appearance", label: "Edit appearance", targets: ["actor"], when: context => Boolean(context.isSelf || context.isAgent && (context.role === "founder" || context.role === "admin")) },
  { id: "pause-agent", label: "Pause agent", targets: ["actor"], when: context => Boolean(context.isAgent && context.state !== "paused" && (context.role === "founder" || context.role === "admin")) },
  { id: "resume-agent", label: "Resume agent", targets: ["actor"], when: context => Boolean(context.isAgent && context.state === "paused" && (context.role === "founder" || context.role === "admin")) },
  { id: "focus", label: "Focus camera", targets: ["room"] },
  { id: "start-meeting", label: "Start meeting here", targets: ["room"] },
  { id: "walk-here", label: "Walk here", targets: ["floor"] },
  { id: "ping", label: "Ping location", targets: ["floor"] },
  { id: "inspect", label: "Inspect", targets: ["object"] },
  { id: "move", label: "Move", targets: ["object"], when: context => Boolean(context.editMode) },
  { id: "rotate", label: "Rotate 90°", targets: ["object"], when: context => Boolean(context.editMode) },
  { id: "duplicate", label: "Duplicate", targets: ["object"], when: context => Boolean(context.editMode) },
  { id: "delete", label: "Delete", targets: ["object"], when: context => Boolean(context.editMode && (context.role === "founder" || context.role === "admin")) },
];
export const actionsFor = (context: ActionContext): ContextAction[] => CONTEXT_ACTIONS.filter(action => action.targets.includes(context.target) && (!action.when || action.when(context)) && (!action.permission || action.permission(context)));
export const actionIdsFor = (context: ActionContext): string[] => actionsFor(context).map(action => action.id);
