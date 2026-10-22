export interface OfficeZone { id: string; room: string; silent?: boolean; focusable?: boolean; capacity?: number; lockable?: boolean; restrictedRoles?: string[]; tooltip?: string; }
export interface DeskClaim { desk: string; person: string; }
export const validZone = (zone: OfficeZone): boolean => Boolean(zone.id && zone.room && (zone.capacity === undefined || zone.capacity >= 0));
export const claimDesk = (claims: readonly DeskClaim[], desk: string, person: string): DeskClaim[] | null => {
  if (claims.some(claim => claim.desk === desk || claim.person === person)) return null;
  return [...claims, { desk, person }];
};
export const releaseDesk = (claims: readonly DeskClaim[], person: string): DeskClaim[] => claims.filter(claim => claim.person !== person);
