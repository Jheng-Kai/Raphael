import { t } from "./i18n";
import * as api from "./api";
import type { MessageKey } from "./i18n/zh-TW";
import type { PageArgument, PageId } from "./types";
import { btn, esc } from "./ui";
import { IS_MAC } from "../shared/platform";
import "./missing.css";

export interface Missing {
  resource: string;
  requirement: string;
  state: "missing" | "broken" | "unknown" | "off";
  repair: string | null;
}

const repairs = new Set(["models", "connections", "store", "search", "read", "vision", "pdf", "computer", "dictation"]);
type MissingKey = Extract<MessageKey, `missing.${string}`> | "conn.emptyInstalled";
const messages: Record<string, MissingKey> = {
  "hidden": "missing.hidden",
  "routines": "missing.routines",
  "startup": "missing.startup",
  "learned": "missing.learned",
  "models": "missing.models",
  "retired": "missing.retired",
  "sameVision": "missing.sameVision",
  "modelFormat": "missing.modelFormat",
  "noModels": "missing.noModels",
  "mail": "missing.mail",
  "slack": "missing.slack",
  "attachment": "missing.attachment",
  "allowance": "missing.allowance",
  "conversation": "missing.conversation",
  "encrypted": "missing.encrypted",
  "bad_pdf": "missing.bad_pdf",
  "no_text": "missing.no_text",
  "urlRead": "missing.urlRead",
  "unknown": "missing.unknown",
  "microphone": "missing.microphone",
  "accessibility": "missing.accessibility",
  "docker": "missing.docker",
  "member_computer": "missing.memberComputer",
  "image_generation": "missing.imageGeneration",
  "video_generation": "missing.videoGeneration",
  "audio_transcriber": "missing.audio_transcriber",
  "audio_ffmpeg": "missing.audio_ffmpeg",
  "audio_decode": "missing.audio_decode",
  "cli": "missing.cli",
  "chatgpt_scope": "missing.chatgpt_scope",
  "chatgpt_plan_unavailable": "missing.chatgpt_plan_unavailable",
  emptyApps: "conn.emptyInstalled",
};

export function missingText(value: Missing): string {
  if (value.requirement === "google_client") return t("card.notConfigured");
  if (value.requirement === "composio_key") return t("card.needsComposioKey");
  const repairMessages: Record<string, MissingKey> = {search: "missing.search", read: "missing.read", vision: "missing.vision", pdf: "missing.pdf"};
  const key = value.state === "unknown" ? "missing.unknown" : value.state === "off" ? "missing.off" : messages[value.requirement] ??
    (value.requirement === "provider" ? (value.resource === "chatgpt" ? "missing.chatgptAuth" : value.state === "broken" ? "missing.providerAuth" : "missing.provider") : value.requirement === "installation" ? "missing.installation" :
    value.requirement === "url" && value.resource === "searxng" ? "missing.url" : repairMessages[value.repair ?? ""] ?? "missing.unknown");
  return t(key);
}

/** `action` is the note's own button where no repair page exists (a retry). */
/** The macOS privacy pane each of its permissions is allowed in (commands.rs OPENABLE_LINKS). */
const SYSTEM_PANES: Record<string, string> = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
};
/** Panes of macOS alone: Windows' microphone note keeps the words it has, with no button. */
const MAC_ONLY_PANES = new Set(["microphone"]);

export function missingHTML(value: Missing, text = missingText(value), action = ""): string {
  const pane = MAC_ONLY_PANES.has(value.requirement) && !IS_MAC ? undefined : SYSTEM_PANES[value.requirement];
  const repair = repairButton(value) || (pane ? btn(esc(t("missing.open")), "sm", ` data-missing-pane="${esc(pane)}"`) : "");
  return `<div class="missing-note" role="status"><span>${esc(text)}</span>` + (repair || action) + `</div>`;
}

/**
 * Under a reply that already says what is missing, only its repair: the sentence would say it twice (R-UI-02). A note
 * with no repair page keeps its sentence, the one thing it has to show.
 */
export function missingRepairHTML(value: Missing): string {
  const repair = repairButton(value);
  return repair ? `<div class="missing-note is-repair" role="status">${repair}</div>` : missingHTML(value);
}

function repairButton(value: Missing): string {
  const repair = value.repair && repairs.has(value.repair) ? value.repair : null;
  if (!repair) return "";
  const resource = value.requirement === "image_generation" ? "image" : value.requirement === "video_generation" ? "video" : value.resource;
  return btn(esc(t("missing.open")), "sm", ` data-missing-repair="${esc(repair)}" data-missing-resource="${esc(resource)}"`);
}

export function noticeHTML(requirement: string, repair: string | null = null, resource = repair ?? "app"): string {
  return missingHTML({resource, requirement, state: "missing", repair});
}

/** Navigation is installed once on the real entry and follows elements redrawn by every consumer. */
export function bindMissing(root: Document | HTMLElement, go: (page: PageId, arg?: PageArgument) => void): () => void {
  const click = (event: Event): void => {
    const pane = (event.target as Element).closest<HTMLButtonElement>("[data-missing-pane]");
    // Accessibility is repaired, not only opened: a rebuilt or updated app finds its old switch showing on while it no longer
    // counts, so the shell clears that entry, macOS asks again and the pane opens (commands.rs `repair_accessibility`).
    if (pane?.dataset.missingPane === SYSTEM_PANES.accessibility) { void api.repairAccessibility().catch(() => api.openLink(SYSTEM_PANES.accessibility)).catch(() => {}); return; }
    if (pane && Object.values(SYSTEM_PANES).includes(pane.dataset.missingPane ?? "")) { void api.openLink(pane.dataset.missingPane!); return; }
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-missing-repair]");
    if (!button || button.disabled || !repairs.has(button.dataset.missingRepair ?? "")) return;
    button.closest(".toast")?.remove();
    button.closest(".model-chooser")?.querySelector<HTMLButtonElement>('[data-dlg="close"]')?.click();
    go("settings", `repair:${button.dataset.missingRepair}:${button.dataset.missingResource ?? "app"}`);
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
}
