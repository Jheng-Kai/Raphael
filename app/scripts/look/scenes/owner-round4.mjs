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
  ]}));
}
export const noNaming = scene("no-naming", "An empty unconfigured Raphael thread has no naming setup",
  [check("no-naming")], {unconfiguredRaphael:true});
