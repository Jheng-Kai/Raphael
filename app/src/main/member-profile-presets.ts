import { t } from "./i18n";
import type { NewMember } from "./types";

export const PROFILE_PRESETS = ["custom", "assistant", "email", "research", "coding", "community", "operations"] as const;
export type ProfilePreset = typeof PROFILE_PRESETS[number];
const PRESET_KEYS = {
  custom: { label: "members.profile.custom" },
  assistant: { label: "members.profile.assistant", blurb: "members.profile.assistantBlurb", personality: "members.profile.assistantPersonality", instructions: "members.profile.assistantInstructions" },
  email: { label: "members.profile.email", blurb: "members.profile.emailBlurb", personality: "members.profile.emailPersonality", instructions: "members.profile.emailInstructions" },
  research: { label: "members.profile.research", blurb: "members.profile.researchBlurb", personality: "members.profile.researchPersonality", instructions: "members.profile.researchInstructions" },
  coding: { label: "members.profile.coding", blurb: "members.profile.codingBlurb", personality: "members.profile.codingPersonality", instructions: "members.profile.codingInstructions" },
  community: { label: "members.profile.community", blurb: "members.profile.communityBlurb", personality: "members.profile.communityPersonality", instructions: "members.profile.communityInstructions" },
  operations: { label: "members.profile.operations", blurb: "members.profile.operationsBlurb", personality: "members.profile.operationsPersonality", instructions: "members.profile.operationsInstructions" },
} as const;
/** The slime each start comes with; it can still be changed. */
const PRESET_SLIMES: Record<Exclude<ProfilePreset, "custom">, string> = {
  assistant: "slime:color:sky", email: "slime:color:coral", research: "slime:color:teal", coding: "slime:color:ocean",
  community: "slime:color:orchid", operations: "slime:color:tangerine",
};
export const presetSlime = (preset: ProfilePreset): string => (preset === "custom" ? "" : PRESET_SLIMES[preset]);
export const presetChoices = () => PROFILE_PRESETS.map(value => ({ value, label: t(PRESET_KEYS[value].label) }));

export function memberPreset(preset: ProfilePreset): Partial<NewMember> {
  if (preset === "custom") return {};
  const keys = PRESET_KEYS[preset];
  return { role: t(keys.label), blurb: t(keys.blurb), personality: t(keys.personality), instructions: t(keys.instructions) };
}

export const presetCommand = (preset: ProfilePreset): { name: string; description: string; template: string } | null => {
  if (preset === "custom") return null;
  const selected = memberPreset(preset);
  return { name: preset, description: selected.blurb ?? "", template: `${selected.instructions}\n\n{input}` };
};

export function randomMemberName(gender: "female" | "male", taken: readonly string[]): string {
  const list = t(gender === "female" ? "members.profile.femaleNames" : "members.profile.maleNames").split("|");
  const available = list.filter(name => !taken.some(other => other.toLocaleLowerCase() === name.toLocaleLowerCase()));
  const candidates = available.length ? available : list;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
