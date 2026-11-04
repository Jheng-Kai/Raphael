import { t } from "./i18n";
import type { AgentTurn, AgentStep } from "./types";

export interface WorkAction { id: string; state: string; present: string; past: string; reason?: string; outcome?: string }
export function workAction(text: string): WorkAction | null {
  try {
    const data = JSON.parse(text);
    return data?.type === "action" && typeof data.id === "string" && typeof data.present === "string" && typeof data.past === "string" ? data : null;
  } catch { return null; }
}
export function workActions(turn: AgentTurn): WorkAction[] {
  const actions = new Map<string, WorkAction>();
  for (const message of turn.messages ?? []) {
    const action = message.kind === "event" && workAction(message.text);
    if (action) actions.set(action.id, action);
  }
  return [...actions.values()];
}
export function liveAction(turn: AgentTurn): string | undefined {
  return workActions(turn).filter(action => action.state === "running").slice(-1)[0]?.present;
}

/** Old turns have no arguments: describe the action without guessing its target. */
export function pastStep(step: AgentStep): string {
  const name = (step.tool ?? "").toLowerCase(), words = name.split(/[^a-z]+/);
  if (step.kind === "model") return t("work.thought");
  if (name === "local_job") return t("work.job");
  if (name === "local_exec" || step.kind === "command" || ["exec", "command", "shell"].includes(name)) return t("work.command");
  if (step.kind === "computer" || step.server === "computer") return t("work.computer");
  if (name.includes("routine")) return t("work.routine");
  if (name.includes("calendar")) return t("work.calendar");
  if (name === "ask_member" || name === "handoff") return t("work.colleague");
  if (step.server && !["Raphael", "local"].includes(step.server)) {
    const app = /composio/i.test(step.server) ? words[0].replace(/^./, char => char.toUpperCase()) : step.server;
    const key = words.some(word => ["search", "list", "get", "fetch", "read"].includes(word)) ? "work.appView" : words.some(word => ["create", "add"].includes(word)) ? "work.appCreate" : words.some(word => ["update", "edit"].includes(word)) ? "work.appUpdate" : words.some(word => ["delete", "remove"].includes(word)) ? "work.appDelete" : words.some(word => ["send", "post", "reply"].includes(word)) ? "work.appSend" : "work.appUse";
    return t(key, {p0: app});
  }
  if (words.some(word => ["search", "grep"].includes(word))) return t("work.search");
  if (words.includes("read")) return t("work.read");
  if (words.some(word => ["edit", "patch"].includes(word))) return t("work.edit");
  if (words.includes("write")) return t("work.write");
  return t("work.tools", {p0: 1});
}
