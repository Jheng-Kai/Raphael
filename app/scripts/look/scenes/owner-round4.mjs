import { check, scene } from "./steps.mjs";

// Extend ordinary feature scenes so each future main-page run retains these regressions.
const checks = {
  home: "home-redesign", "home-empty": "home-redesign", "home-many": "home-redesign",
  "dictation-overview": "dictation-layout", chat: "thread-measure",
  "member-text": "thread-measure", "room-text": "thread-measure",
  "raphael-details": "details-pointer-focus",
  "plugins-installed": "settings-alignment", "plugins-store": "settings-alignment",
};
export function withOwnerRound4(scenes) {
  return scenes.map(original => ({...original, steps: [
    ...original.steps.flatMap(step => original.name === "details" && step.action === "icon-interactions"
      ? [check("details-pointer-focus"), step] : [step]),
    ...(checks[original.name] ? [check(checks[original.name])] : []),
    ...(["home", "home-empty", "home-many"].includes(original.name) ? [check("home-lead-width")] : []),
    ...(["home", "automations-calendar", "dictation-overview", "chat"].includes(original.name) ? [check("sidebar-shell")] : []),
    ...(original.name === "onboarding-abilities" ? [check("onboarding-abilities-hero")] : []),
    ...(original.name === "raphael-details" ? [check("details-quick-once")] : []),
    ...(original.name === "connector-reconnected" ? [check("conversation-scroll-edge")] : []),
    ...(["quick-cleared", "conversation-delete-main", "member-delete"].includes(original.name) ? [check("toast-clearance")] : []),
    ...(original.name === "member-conversation-sections" ? [check("details-alignment")] : []),
    ...(["details", "raphael-details", "details-routines", "details-memory"].includes(original.name) ? [check("details-sheet")] : []),
    ...(["profile", "dictation", "messaging", "appearance", "skins", "models", "usage"].includes(original.name) ? [check("settings-concise")] : []),
    ...(original.name === "models" ? [check("models-responsive")] : []),
    ...(original.name === "dictation-overview" ? [check("compact-action")] : []),
    ...(["chat", "details", "details-closed", "member-text", "raphael-details"].includes(original.name) ? [check("conversation-header"), check("details-alignment")] : []),
  ]}));
}
export const noNaming = scene("no-naming", "An empty unconfigured Raphael thread has no naming setup",
  [check("no-naming")], {unconfiguredRaphael:true});
