import { check, scene } from "./steps.mjs";

// Extend ordinary feature scenes so each future main-page run retains these regressions.
const checks = {
  home: "home-redesign", "home-empty": "home-redesign", "home-many": "home-redesign",
  "dictation-overview": "dictation-layout", chat: "thread-measure",
  "member-text": "thread-measure", "room-text": "thread-measure",
  "raphael-details": "details-pointer-focus",
  "plugins-installed": "settings-alignment", "plugins-store": "settings-alignment",
  skins: "settings-alignment", team: "team-alignment", onboarding: "welcome-alignment",
};
export function withOwnerRound4(scenes) {
  return scenes.map(original => ({...original, steps: [
    ...original.steps.flatMap(step => original.name === "details" && step.action === "icon-interactions"
      ? [check("details-pointer-focus"), step] : [step]),
    ...(checks[original.name] ? [check(checks[original.name])] : []),
    ...(original.name === "team" ? [check("team-readable")] : []),
    ...(["team", "team-fit", "team-crisp-100", "team-crisp-150", "team-panned", "team-rearranged", "team-zoom", "primary-team-board"].includes(original.name) ? [check("team-card-lines")] : []),
    ...(["home", "home-empty", "home-many"].includes(original.name) ? [check("home-lead-width")] : []),
    ...(["home", "team", "automations-calendar", "dictation-overview", "chat"].includes(original.name) ? [check("sidebar-count-alignment")] : []),
    ...(original.name === "onboarding-abilities" ? [check("onboarding-abilities-hero")] : []),
    ...(original.name === "raphael-details" ? [check("details-quick-once")] : []),
    ...(original.name === "connector-reconnected" ? [check("conversation-scroll-edge")] : []),
    ...(["quick-cleared", "conversation-delete-main", "member-delete", "composer-learn"].includes(original.name) ? [check("toast-clearance")] : []),
    ...(original.name === "member-conversation-sections" ? [check("details-alignment")] : []),
    ...(original.name === "team-fit" ? [check("team-column-edges")] : []),
    ...(["team", "team-fit", "team-crisp-100", "team-crisp-150", "primary-team-board"].includes(original.name) ? [check("team-model-readable"), check("team-content-size")] : []),
    ...(["details", "raphael-details", "details-routines", "details-memory"].includes(original.name) ? [check("details-sheet")] : []),
    ...(["profile", "dictation", "data", "messaging", "appearance", "skins", "models", "usage"].includes(original.name) ? [check("settings-concise")] : []),
    ...(original.name === "models" ? [check("models-responsive")] : []),
    ...(["usage", "dictation-overview"].includes(original.name) ? [check("compact-action")] : []),
    ...(["chat", "details", "details-closed", "member-text", "raphael-details"].includes(original.name) ? [check("conversation-header"), check("details-alignment")] : []),
  ]}));
}
export const noNaming = scene("no-naming", "An empty unconfigured Raphael thread has no naming setup",
  [check("no-naming")], {unconfiguredRaphael:true});
