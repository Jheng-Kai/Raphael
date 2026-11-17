// Which apps a member may use: one rule for the member's settings (工具) and the composer's + menu (應用程式), so that the two
// switches are one setting. A member's `tools` is null while every app that is on is allowed (and later ones join it), else the
// list of what it may use.
import type { Member } from "./types";

export interface ToolChoices { tools: string[]; connections: { id: string; name: string; enabled: boolean; logo?: string }[] }

/** The apps the owner connected and left on: what a member's switches choose among. */
export const connectedApps = (choices: ToolChoices): ToolChoices["connections"] => choices.connections.filter(connection => connection.enabled);

/** Whether the member may use the app `id` (every app, while its list is null). */
export const toolOn = (tools: Member["tools"], id: string): boolean => tools === null || tools.includes(id);

/**
 * The member's `tools` after the switch of app `id` is pressed: the list with it added or taken out, and null again when that
 * is every app on, the core's own default, which apps connected later join too.
 */
export function toolsAfterToggle(tools: Member["tools"], choices: ToolChoices, id: string): string[] | null {
  const everything = [...choices.tools, ...connectedApps(choices).map(connection => connection.id)];
  const base = tools ?? everything;
  const next = toolOn(tools, id) ? base.filter(item => item !== id) : [...new Set([...base, id])];
  return everything.every(item => next.includes(item)) && next.every(item => everything.includes(item)) ? null : next;
}
