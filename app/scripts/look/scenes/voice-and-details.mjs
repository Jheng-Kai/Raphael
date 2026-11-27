import { accountMenu, check, click, hold, key, member, page, scene, settings, wait, waitGone } from "./steps.mjs";

const details = [{ action: "open-details" }, wait('.mb-det:not([hidden])')];
// The voice button records a voice message while held; voice chat waits for a later release.
const voice = id => [click('.mb-det [data-det="close"]'), wait('.conversation-trigger[aria-expanded="false"]'), id ? hold('.cmp-voice') : click('.cmp-voice')];
const language = locale => [click('[data-k="ui-language"]'), click(`#app-popover [data-value="${locale}"]`), wait(`html[lang="${locale}"]`), check(`locale-${locale}`)];
// 連結應用程式 is walked from the sidebar below: it is a dialog of its own, not a tab of Settings (R-UI-111).
// The tabs as Settings lists them; appearance is a section of 一般.
const panes = ["general", "models", "tools", "dictation", "safety", "about"];

export default [
  ...["en", "ja", "zh-TW"].map(locale => scene(`settings-language-${locale}`, `Switch to ${locale} in Settings and walk every page and section`, [
    ...settings("appearance"), ...language(locale === "zh-TW" ? "en" : locale),
    ...(locale === "zh-TW" ? language(locale) : []),
    ...panes.flatMap(pane => [click(`.modal-scrim [data-pane="${pane}"]`), wait(`.modal-scrim [data-pane="${pane}"][aria-current="page"]`), check(`locale-${locale}`)]),
    click('.modal-scrim [data-act="close"]'),
    ...settings("connections"), check(`locale-${locale}`), click('.modal-scrim [data-act="close"]'),
    ...["agent", "dictation"].flatMap(name => [page(name), check(`locale-${locale}`)]),
    ...["history", "dictionary", "overview"].flatMap(tab => [page("dictation"), click(`[data-dictation-tab="${tab}"]`), check(`locale-${locale}`)]),
    page("automations"), wait('.au-page:not([hidden]) .au-day-col'), check(`locale-${locale}`), key("Escape"), waitGone('.au-pop-detail'),
    accountMenu(), check(`locale-${locale}`), key("Escape"), waitGone("#app-popover"),
    page("settings"), check(`locale-${locale}`), click('.modal-scrim [data-act="close"]'),
    ...settings("general"), check(`locale-${locale}`),
  ])),
  scene("raphael-details-no-list", "Raphael's panel lists no conversation, as a slime's does not: it has the one", [...details, check("raphael-details-no-list")]),
  scene("member-conversation-sections", "A member has one conversation and no conversation list", [member(1), ...details, check("member-no-conversations")]),
  ...[0, 1].flatMap(id => [
    scene(`composer-voice-pending-${id}`, "Composer voice waits in the member's one conversation", [
      member(id), ...details, ...voice(id), wait('[data-key="hearing"]'), check("composer-voice-destination"),
    ], { ownerVoice: "pending" }),
    scene(`composer-voice-answer-${id}`, "Composer voice answers in the member's one conversation", [
      member(id), ...details, ...voice(id), wait('.tn[data-id="301"]'), check("composer-voice-answer"),
    ], { ownerVoice: "answer" }),
  ]),
];
