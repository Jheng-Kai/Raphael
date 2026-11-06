import { getLocale, t } from "./i18n";
import type { AgentTurn } from "./types";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const APP_NAMES: Record<string, string> = { GMAIL: "Gmail", GOOGLECALENDAR: "Google Calendar", GOOGLESHEETS: "Google Sheets", GOOGLEDOCS: "Google Docs", GOOGLEDRIVE: "Google Drive", NOTION: "Notion", SLACK: "Slack", GITHUB: "GitHub" };
const appName = (action?: string): string => {
  const app = action?.replace(/^.*[.:]/, "").match(/^([A-Z][A-Z0-9]+)_[A-Z0-9_]+$/)?.[1];
  return !app || app === "COMPOSIO" ? t("composio.result") : APP_NAMES[app] ?? (app[0].toUpperCase() + app.slice(1).toLowerCase()).slice(0, 100);
};
const slug = (value: RecordValue): string | undefined => [value.tool_slug, value.slug, value.tool].find(item => typeof item === "string" && /^[A-Z][A-Z0-9]+_[A-Z0-9_]+$/.test(item)) as string | undefined;

function decode(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 65536 || !/[{\[]/.test(value)) return value;
  try { return JSON.parse(value); } catch { return value; }
}

function shaped(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  value = decode(value);
  if (Array.isArray(value)) return value.some(item => shaped(item, depth + 1));
  if (!record(value)) return false;
  if (slug(value) || (typeof value.successful === "boolean" && ("data" in value || "error" in value))) return true;
  const data = decode(value.data), results = value.results ?? (record(data) ? data.results : undefined);
  return Array.isArray(results) && results.some(item => shaped(item, depth + 1));
}

function summary(value: unknown, action?: string, trusted = false, depth = 0): string | null {
  value = decode(value);
  if (!trusted && !shaped(value)) return null;
  if (depth > 6) return `${appName(action)} · ${t("composio.resultUnavailable")}`;
  if (Array.isArray(value)) {
    if (!value.length) return `${appName(action)} · ${t("composio.resultDetails")}`;
    return value.slice(0, 3).map(item => summary(item, action, true, depth + 1) ?? t("composio.resultUnavailable")).join("\n") +
      (value.length > 3 ? `\n${t("composio.moreResults", { p0: value.length - 3 })}` : "");
  }
  if (!record(value)) return null;
  const named = slug(value);
  const data = decode(value.data);
  const results = value.results ?? (record(data) ? data.results : undefined);
  if (Array.isArray(results) && results.length) {
    return results.slice(0, 3).map(item => summary(item, record(item) ? slug(item) ?? action : action, true, depth + 1) ?? t("composio.resultUnavailable")).join("\n") +
      (results.length > 3 ? `\n${t("composio.moreResults", { p0: results.length - 3 })}` : "");
  }
  let failed = false, completed = false;
  const fields: string[] = [], queue: unknown[] = [value];
  for (let index = 0; index < queue.length && index < 30; index++) {
    const item = decode(queue[index]);
    if (!record(item)) continue;
    failed ||= item.successful === false || item.success === false || item.isError === true || !!item.error;
    completed ||= item.successful === true || item.success === true || item.isError === false;
    for (const key of ["summary", "message", "subject", "title", "name", "snippet"]) {
      const field = item[key];
      if (typeof field === "string" && field.trim() && !/[{}\[\]]/.test(field) && !/\b(?:api[_-]?key|access[_-]?token|password|secret)\b/i.test(field)) {
        const text = field.replace(/\s+/g, " ").slice(0, 160);
        if (!fields.includes(text)) fields.push(text);
      }
    }
    for (const key of ["response", "data", "result", "content"]) {
      const inner = decode(item[key]);
      if (record(inner)) queue.push(inner);
      else if (Array.isArray(inner)) queue.push(...inner.slice(0, 3));
    }
    if (typeof item.text === "string") queue.push(decode(item.text));
  }
  return `${appName(named ?? action)} · ${t(failed ? "composio.resultFailed" : completed ? "composio.resultDone" : "composio.resultDetails")}${fields.length ? `${t("composio.fieldSeparator")}${fields.slice(0, 3).join(" · ")}` : ""}`;
}

function fragments(text: string, action: string | undefined, trusted: boolean): string {
  let out = "", start = -1, depth = 0, quoted = false, escaped = false, copied = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start < 0) {
      if (char === "{" || char === "[") { start = index; depth = 1; quoted = escaped = false; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) {
      const source = text.slice(start, index + 1), projected = summary(source, action, trusted);
      out += text.slice(copied, start) + (projected ?? source);
      copied = index + 1; start = -1;
    }
  }
  return out + text.slice(copied);
}

/** Only the display projection changes; stored results and model tool messages retain their data. */
const projections = new Map<string, string>();
export function composioText(text: string, action?: string, mode: "member" | "tool" = "member"): string {
  if (!/[{\[]/.test(text)) return text;
  const key = `${getLocale()}\0${mode}\0${action ?? ""}\0${text}`;
  const known = projections.get(key);
  if (known !== undefined) return known;
  const made = projectText(text, action, mode);
  if (text.length <= 65536) {
    if (projections.size >= 512) projections.delete(projections.keys().next().value!);
    projections.set(key, made);
  }
  return made;
}

function projectText(text: string, action: string | undefined, mode: "member" | "tool"): string {
  const trusted = mode === "tool", unavailable = () => `${appName(action)} · ${t("composio.resultUnavailable")}`;
  const named = /"(?:tool_slug|slug|tool)"\s*:\s*"[A-Z][A-Z0-9]+_[A-Z0-9_]+"/.test(text);
  if (text.length > 65536) {
    let known = trusted;
    if (!known) {
      try { known = shaped(JSON.parse(text)); } catch { known = named; }
    }
    return known ? unavailable() : text;
  }
  const whole = summary(text, action, trusted);
  if (whole) return whole;
  const readable = fragments(text.replace(/```(?:json)?\s*\n?([\s\S]*?)```/gi, (block, source: string) => summary(source, action, trusted) ?? block), action, trusted);
  if (readable === text && /^(?:\s*[{\[]|\s*```json)/i.test(text) && (trusted || named)) return unavailable();
  return readable;
}

export function isComposioTool(server: string | null | undefined, tool: string | null | undefined): boolean {
  return /composio/i.test(server ?? "") || /^COMPOSIO_/.test(tool ?? "");
}

export function composioAction(turn: Pick<AgentTurn, "steps"> | undefined): string | undefined {
  return [...(turn?.steps ?? [])].reverse().find(step => isComposioTool(step.server, step.tool))?.tool ?? undefined;
}
