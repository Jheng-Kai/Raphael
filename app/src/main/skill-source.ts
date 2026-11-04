// Present installed skill provenance without exposing transport or cache internals.
import { formatDate } from "./format";
import { t } from "./i18n";
import type { MemberSkill } from "./types";

export function skillSourceLabel(source: string, plugin?: string, version?: string): string {
  if (source === "learned") return t("skills.learned");
  if (source === "owner") return t("skills.owner");
  if (source === "imported") return t("skills.imported");
  if (source.startsWith("plugin:")) return `${plugin || source.slice(7)}${version ? ` · ${version}` : ""}`;
  const path = source.replace(/^(?:local|github):/, "").replace(/\\/g, "/");
  const cached = path.match(/\/\.(?:claude|codex)\/plugins\/cache\/[^/]+\/([^/]+)\/([^/]+)(?:\/|$)/i);
  if (cached) return `${plugin || cached[1]} · ${cached[2]}`;
  return path.replace(/^.*(?=\/\.(?:claude|codex|agents)\/(?:skills|plugins)(?:\/|$))/i, "~");
}

/** One origin line is shared by library rows, member resources and skill dialogs. */
export function skillOriginLabel(skill: Pick<MemberSkill, "source" | "plugin" | "plugin_version" | "provenance" | "learned_at" | "shared">): string {
  const learned = skill.provenance === "learned" || skill.source === "learned";
  const origin = learned ? (skill.learned_at ? t("skills.learnedAt", { p0: formatDate(skill.learned_at) }) : t("skills.learned"))
    : t(skill.provenance === "owner" || skill.source === "owner" ? "skills.owner" : "skills.imported");
  const source = !learned && !["owner", "imported"].includes(skill.source) ? skillSourceLabel(skill.source, skill.plugin, skill.plugin_version) : "";
  return [skill.shared ? t("skills.shared") : "", source, origin].filter(Boolean).join(" · ");
}
