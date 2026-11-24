// The app's own slash commands (R-SLASH-APP-01): the app runs them at once, with no message sent and no model asked, so
// they work while a model's allowance is spent. A member's command or skill of the same name gives way to the app's.

import type { MessageKey } from "./i18n/zh-TW";
import type { PageArgument } from "./types";

/** Each command, and what the menu says it does. */
export const APP_COMMANDS = { usage: "slash.usage" } as const satisfies Record<string, MessageKey>;
export type AppCommand = keyof typeof APP_COMMANDS;

/** The prefix of an app command's value in the slash menu, so it is never taken for a member's command of the same name. */
export const APP_COMMAND_VALUE = "app:";

/** The app command a draft is, typed whole on its own (`/usage`, any case, spaces around it): null for anything else. */
export function appCommandOf(text: string): AppCommand | null {
  const word = /^\s*\/([a-z]+)\s*$/iu.exec(text)?.[1]?.toLowerCase();
  return word !== undefined && Object.prototype.hasOwnProperty.call(APP_COMMANDS, word) ? word as AppCommand : null;
}

/** Runs `command` through the app's navigation: /usage opens Settings › 用量. */
export function runAppCommand(command: AppCommand, go: (page: "settings", argument: PageArgument) => void): void {
  if (command === "usage") go("settings", "usage");
}
