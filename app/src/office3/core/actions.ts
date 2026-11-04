export type TargetKind = "actor" | "object" | "room" | "floor";
export type OfficeRole = "founder" | "admin" | "member";
export interface ActionContext { target: TargetKind; role: OfficeRole; state?: string; editMode?: boolean; isSelf?: boolean; isAgent?: boolean; canDismissCall?: boolean; interactable?: boolean; canLockConversation?: boolean; conversationLocked?: boolean; following?: boolean; }
export interface ContextAction { id: string; label: string; icon?: string; targets: TargetKind[]; when?: (context: ActionContext) => boolean; permission?: (context: ActionContext) => boolean; }
const allowed = (target: TargetKind) => (context: ActionContext) => context.target === target;
export const CONTEXT_ACTIONS: readonly ContextAction[] = [
  { id: "view-card", label: "View card", targets: ["actor"], when: context => !context.isSelf },
  { id: "message", label: "Message", targets: ["actor"], when: context => !context.isSelf },
  { id: "invite-conversation", label: "Invite to conversation", targets: ["actor"], when: context => !context.isSelf },
  { id: "follow", label: "Follow", targets: ["actor"], when: context => Boolean(!context.isSelf && !context.following) },
  { id: "stop-following", label: "Stop following", targets: ["actor"], when: context => Boolean(!context.isSelf && context.following) },
  { id: "call-over", label: "Call over", targets: ["actor"], when: context => Boolean(context.isAgent && !context.isSelf && !context.canDismissCall) },
  { id: "dismiss-call", label: "Dismiss to desk", targets: ["actor"], when: context => Boolean(context.isAgent && context.canDismissCall) },
  { id: "go-to", label: "Go to", targets: ["actor"], when: context => !context.isSelf },
  { id: "wave", label: "Wave", targets: ["actor"] },
  { id: "set-focus", label: "Set focus", targets: ["actor"], when: context => Boolean(context.isSelf && context.state !== "focus") },
  { id: "set-dnd", label: "Set do not disturb", targets: ["actor"], when: context => Boolean(context.isSelf && context.state !== "dnd") },
  { id: "set-available", label: "Set available", targets: ["actor"], when: context => Boolean(context.isSelf && ["focus", "dnd"].includes(context.state ?? "")) },
  { id: "return-to-desk", label: "Return to desk", targets: ["actor"], when: context => Boolean(context.isSelf) },
  { id: "lock-conversation", label: "Lock conversation", targets: ["actor"], when: context => Boolean(context.isSelf && context.canLockConversation && !context.conversationLocked) },
  { id: "unlock-conversation", label: "Unlock conversation", targets: ["actor"], when: context => Boolean(context.isSelf && context.canLockConversation && context.conversationLocked) },
  { id: "edit-appearance", label: "Edit appearance", targets: ["actor"], when: context => Boolean(context.isSelf) },
  { id: "pause-agent", label: "Pause agent", targets: ["actor"], when: context => Boolean(context.isAgent && context.state !== "paused" && (context.role === "founder" || context.role === "admin")) },
  { id: "resume-agent", label: "Resume agent", targets: ["actor"], when: context => Boolean(context.isAgent && context.state === "paused" && (context.role === "founder" || context.role === "admin")) },
  { id: "focus", label: "Focus camera", targets: ["room"] },
  { id: "start-meeting", label: "Start meeting here", targets: ["room"] },
  { id: "end-meeting", label: "End active meeting", targets: ["room"] },
  { id: "meet-me", label: "Meet me here", targets: ["room"] },
  { id: "walk-here", label: "Walk here", targets: ["floor"] },
  { id: "ping", label: "Ping location", targets: ["floor"] },
  { id: "use", label: "Use", targets: ["object"], when: context => Boolean(context.interactable) },
  { id: "inspect", label: "Inspect", targets: ["object"] },
  { id: "open-in-builder", label: "Open in Builder", targets: ["object"] },
  { id: "move", label: "Move", targets: ["object"], when: context => Boolean(context.editMode) },
  { id: "rotate", label: "Rotate 90°", targets: ["object"], when: context => Boolean(context.editMode) },
  { id: "duplicate", label: "Duplicate", targets: ["object"], when: context => Boolean(context.editMode) },
  { id: "delete", label: "Delete", targets: ["object"], when: context => Boolean(context.editMode && (context.role === "founder" || context.role === "admin")) },
];
export const actionsFor = (context: ActionContext): ContextAction[] => CONTEXT_ACTIONS.filter(action => action.targets.includes(context.target) && (!action.when || action.when(context)) && (!action.permission || action.permission(context)));
export const actionIdsFor = (context: ActionContext): string[] => actionsFor(context).map(action => action.id);
