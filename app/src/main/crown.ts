// Who wears the crown: the owner's primary member, marked with a crown
// It is Raphael (id 0) until another is chosen, the same rule as `primaryIdOf`
// in members.ts; `membersList` (api.ts) sets it from every roster the core sends, the only place
// the primary is read. slime.ts draws the crown on that member's slime.

let crowned = 0;

export const crownedId = (): number => crowned;

export function crownPrimary(list: { members: readonly { id: number }[]; team_context?: { primary_id?: number | null } | null }): void {
  const id = list.team_context?.primary_id;
  crowned = typeof id === "number" && list.members.some((member) => member.id === id) ? id : 0;
}
