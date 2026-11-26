// Raphael (member 0): the app's guide and keeper, who is not one of the owner's slimes. Its name is the language's own
// Raphael name and its look is the first blue slime, whatever the roster says: neither is the owner's to change, so
// nothing here is remembered from a roster. A place that knows only the id (a card, a reminder, a line between members)
// still names and draws it as the account menu does.

import { t } from "./i18n";

/** Raphael's face, always: the very first slime, the cute blue one. Never a picture. */
export const RAPHAEL_SLIME = "slime:blue-plain";

/** What it is called: the language's Raphael name. */
export const raphaelName = (): string => t("agent.title");
