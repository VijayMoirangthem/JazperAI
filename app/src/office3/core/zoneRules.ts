export type ZoneRole = "founder" | "admin" | "member" | "intern" | "guest";
export interface ZoneRules { silent?: boolean; capacity?: number; roles?: ZoneRole[]; locked?: boolean; tooltip?: string; ambience?: string }
export type ZoneEffect = "allow" | "block" | "silent" | "tooltip" | "ambience";
export const evaluateZoneEntry = (rules: ZoneRules, role: ZoneRole, occupancy: number): ZoneEffect[] => { if (rules.locked || (rules.roles && !rules.roles.includes(role)) || (rules.capacity !== undefined && occupancy >= rules.capacity)) return ["block"]; const effects: ZoneEffect[] = ["allow"]; if (rules.silent) effects.push("silent"); if (rules.tooltip) effects.push("tooltip"); if (rules.ambience) effects.push("ambience"); return effects };
