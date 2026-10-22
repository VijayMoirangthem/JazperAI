export type OfficeRole = "founder" | "admin" | "employee" | "intern" | "guest";
export type OfficePermission = "world.edit" | "agent.manage" | "people.manage" | "moderate" | "chat" | "appearance.edit";
const matrix: Record<OfficeRole, readonly OfficePermission[]> = {
  founder: ["world.edit", "agent.manage", "people.manage", "moderate", "chat", "appearance.edit"],
  admin: ["world.edit", "agent.manage", "people.manage", "moderate", "chat", "appearance.edit"],
  employee: ["chat", "appearance.edit"], intern: ["chat", "appearance.edit"], guest: ["chat", "appearance.edit"],
};
export const hasPermission = (role: OfficeRole, permission: OfficePermission): boolean => matrix[role].includes(permission);
export const rolePermissions = (role: OfficeRole): readonly OfficePermission[] => matrix[role];
export const canManagePerson = (actor: OfficeRole, target: OfficeRole): boolean => (actor === "founder" || actor === "admin") && target !== "founder";
