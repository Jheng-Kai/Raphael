// The first member (id 0, the core's "first Bot"): the slime the owner names and dresses in the first-run guide, their
// chief of staff from then on. Its name and its slime are the owner's, as every member's are; "Raphael" is the app's
// own name and the voice's, never this member's unless the owner kept it. `membersList` (api.ts) remembers both from
// every roster the core sends, so a place that knows only the id (a card, a reminder, a line between members) still
// names and draws it as the roster does.

import { t } from "./i18n";

/** Its face until the owner dresses it: the very first one, the cute blue slime. */
export const FIRST_SLIME = "slime:blue-plain";

let name = "";
let avatar = "";

export function rememberFirstBot(list: { members: readonly { id: number; name?: string; avatar?: string | null }[] }): void {
  const first = list.members.find((member) => member.id === 0);
  if (!first) return;
  name = first.name ?? "";
  avatar = first.avatar ?? "";
}

/** What it is called: the name of the last roster, its built-in name before a roster is read. */
export const firstBotName = (): string => name || t("agent.title");

/** Its slime: the one `given` (a row of the roster), else the last roster's, else the first blue slime. */
export const firstBotSlime = (given?: string | null): string =>
  given?.startsWith("slime:") ? given : avatar.startsWith("slime:") ? avatar : FIRST_SLIME;
