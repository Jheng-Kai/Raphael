import { systemMessage, t } from "./index";
import { zhTW, type MessageKey } from "./zh-TW";

/** Localize known Rust command errors at the UI boundary without changing the Rust contract. */
const exact = [
  "backend.limit", "backend.retention", "backend.stt", "backend.workerCap", "backend.model",
  "backend.micTimeout", "backend.emptyDictation", "backend.emptyPaste", "backend.duplicateDictation",
  "backend.duplicatePaste", "backend.conflictingKeys", "backend.invalidKeys", "backend.emptyAgent",
  "backend.duplicateAgent", "backend.conflictingDictationAgent", "backend.conflictingPasteAgent",
  "backend.duplicateTidy", "backend.conflictingTidyDictation", "backend.conflictingTidyPaste", "backend.conflictingTidyAgent",
  "backend.hotkeysOff", "backend.hotkeysOffChange", "backend.memoryBody",
  "keys.004", "keys.005", "keys.006",
  "backend.agentBusy", "backend.agentEmpty", "backend.agentTooLong", "backend.agentOff", "backend.questionGone",
  "backend.attachTooMany", "backend.attachBroken",
  "backend.questionUnfocused", "backend.avatarKind", "backend.avatarSize", "backend.avatarNone",
] as const;
const detailed = [
  "backend.save", "backend.autostartEnable", "backend.autostartDisable", "backend.microphone", "backend.avatarRead", "backend.avatarSave",
] as const;

export function backendMessage(text: string): string {
  if (text === "Invalid params: duplicate group name") return t("members.groupNameTaken");
  const groupPrefix = "Invalid params: choose group: ";
  if (text.startsWith(groupPrefix)) return t("members.chooseGroup", { p0: text.slice(groupPrefix.length) });
  if (text === t("mcp.badPair") || text === zhTW["mcp.badPair"]) return t("mcp.badPair");
  // The shell writes its messages in Traditional Chinese, with the Mac's own words on a Mac (notice_words.rs).
  const said = (key: MessageKey): string[] => [zhTW[key], systemMessage(key, "zh-TW")];
  for (const key of exact) if (said(key).includes(text)) return t(key);
  for (const key of detailed) {
    for (const prefix of said(key).map(message => message.split("{p0}")[0])) {
      if (text.startsWith(prefix)) return t(key, { p0: text.slice(prefix.length) });
    }
  }
  return t("missing.unknown");
}
