export type ModerationRole = "founder" | "admin" | "employee" | "intern" | "guest";
export const MAX_CHAT_LENGTH = 1000;
export const canViewRoom = (role: ModerationRole, allowedRoles?: readonly ModerationRole[]): boolean => !allowedRoles?.length || allowedRoles.includes(role);
export const validChatMessage = (text: string): boolean => text.trim().length > 0 && text.length <= MAX_CHAT_LENGTH;
export const withinRateLimit = (timestamps: readonly number[], now: number, limit = 30, windowMs = 1000): boolean => timestamps.filter(timestamp => now - timestamp < windowMs).length < limit;
export const canModerate = (role: ModerationRole): boolean => role === "founder" || role === "admin";
