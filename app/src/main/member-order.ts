// Where members and folders stand in the sidebar, and the list the core will answer once the owner has moved one (R-SIDE-03).
//
// A row dropped on the sidebar is shown where it was dropped at once and saved after: the window works out here what the core
// will write (the same numbering as members/store.py `_move`), draws that, and sends one request. Pure, so the numbering can be
// tested against the core's own without a browser.

import type { Member, MemberGroup, MembersList } from "./types";

const byPlace = (a: { position: number; id: number }, b: { position: number; id: number }): number => a.position - b.position || a.id - b.id;
const byId = (a: { id: number }, b: { id: number }): number => a.id - b.id;

/** The list as the core gives it: Raphael first, then the others, pinned ones before the rest, each by place. */
const asListed = (members: readonly Member[]): Member[] => [
  ...members.filter(member => member.id === 0),
  ...members.filter(member => member.id !== 0).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || byPlace(a, b)),
];

/** A move that is made: the list that will be drawn and the place to send (the core's `position`). */
export interface Moved { list: MembersList; position: number }

/**
 * Member `id` goes into folder `groupId` (null: 未分組) before member `beforeId`, or last in that folder when there is none.
 * `position` is a place among every member but Raphael, as the core counts it, and the core numbers all of them again from 0, as
 * this does. Null when the member would stand where it stands, or when there is no such member or folder.
 */
export function movedMember(list: MembersList, id: number, groupId: number | null, beforeId?: number): Moved | null {
  const moving = list.members.find(member => member.id === id && id !== 0);
  if (!moving) return null;
  const known = new Set(list.groups.map(group => group.id));
  // A member of a folder the list does not have stands in 未分組, as the column draws it.
  const folderOf = (member: Member): number | null => (member.group_id !== null && known.has(member.group_id) ? member.group_id : null);
  if (groupId !== null && !known.has(groupId)) return null;
  const all = list.members.filter(member => member.id !== 0).sort(byPlace);
  const others = all.filter(member => member.id !== id);
  const last = others.reduce((found, member, index) => (folderOf(member) === groupId ? index : found), -1);
  let at = beforeId === undefined ? -1 : others.findIndex(member => member.id === beforeId);
  if (at < 0) at = last < 0 ? others.length : last + 1;
  const order = [...others.slice(0, at), moving, ...others.slice(at)];
  if (folderOf(moving) === groupId && order.map(member => member.id).join() === all.map(member => member.id).join()) return null;
  const place = new Map(order.map((member, index) => [member.id, index]));
  const members = list.members.map(member => (member.id === 0 ? member : { ...member, position: place.get(member.id)!, ...(member.id === id ? { group_id: groupId } : {}) }));
  return { list: { ...list, members: asListed(members) }, position: at };
}

/** Folder `id` goes before folder `beforeId`, or last for null. Null when it would stand where it stands. */
export function movedGroup(list: MembersList, id: number, beforeId: number | null): Moved | null {
  const ordered = [...list.groups].sort(byPlace);
  const moving = ordered.find(group => group.id === id);
  if (!moving) return null;
  const others = ordered.filter(group => group.id !== id);
  const found = beforeId === null ? -1 : others.findIndex(group => group.id === beforeId);
  const at = found < 0 ? others.length : found;
  const order = [...others.slice(0, at), moving, ...others.slice(at)];
  if (order.map(group => group.id).join() === ordered.map(group => group.id).join()) return null;
  const groups: MemberGroup[] = order.map((group, index) => ({ ...group, position: index }));
  return { list: { ...list, groups }, position: at };
}

/**
 * What the list says besides where members and folders stand: their places, their folders, the order of the roster the prompts read
 * and its revision are left out. Two lists that agree here differ only in how the sidebar is ordered, so the column alone is drawn
 * again for the one that follows the other (the panel, the settings page and the conversation draw nothing from it).
 */
export function withoutPlaces(list: MembersList): string {
  const members = [...list.members].sort(byId).map(({ position: _position, group_id: _group, ...rest }) => rest);
  const groups = [...list.groups].sort(byId).map(({ position: _position, ...rest }) => rest);
  const { members: _members, groups: _groups, team_context: context, ...rest } = list;
  const team = context && (({ revision: _revision, members: roster, ...fields }) => ({ ...fields, members: [...roster].sort(byId) }))(context);
  return JSON.stringify([members, groups, team, rest]);
}
