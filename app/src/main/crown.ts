// Who wears the crown: the chief of staff, the slime the owner's team leans on, marked with a crown. It is nobody
// until there is a slime (Raphael, id 0, is never the chief); `membersList` (api.ts) sets it from every roster the core
// sends, the only place the primary is read (`team_context.primary_id`). slime.ts draws the crown on that member's slime.

let crowned: number | null = null;

export const crownedId = (): number | null => crowned;

export function crownPrimary(list: { members: readonly { id: number }[]; team_context?: { primary_id?: number | null } | null }): void {
  const id = list.team_context?.primary_id;
  crowned = typeof id === "number" && id > 0 && list.members.some((member) => member.id === id) ? id : null;
}
