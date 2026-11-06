import { check, click, hold, key, member, page, scene, settings, wait, waitGone } from "./steps.mjs";

const details = [{ action: "open-details" }, wait('.mb-det:not([hidden])')];
const open = id => [...details, click(`[data-conversation-open="${id}"]`)];
// The voice button records a voice message while held; voice chat waits for a later release (owner, 2026-11-06).
const voice = id => [click('.mb-det [data-det="close"]'), wait('.conversation-trigger[aria-expanded="false"]'), id ? hold('.cmp-voice') : click('.cmp-voice')];
const language = locale => [click('[data-k="ui-language"]'), click(`#app-popover [data-value="${locale}"]`), wait(`html[lang="${locale}"]`), check(`locale-${locale}`)];
// 連結應用程式 is walked from the sidebar below: it is a dialog of its own, not a tab of Settings (R-UI-111).
const panes = ["general", "appearance", "models", "dictation", "tools", "safety", "messaging", "about"];

export default [
  ...["en", "ja", "zh-TW"].map(locale => scene(`settings-language-${locale}`, `Switch to ${locale} in Settings and walk every page and section`, [
    ...settings("appearance"), ...language(locale === "zh-TW" ? "en" : locale),
    ...(locale === "zh-TW" ? language(locale) : []),
    ...panes.flatMap(pane => [click(`.modal-scrim [data-pane="${pane}"]`), wait(`.modal-scrim [data-pane="${pane}"][aria-current="page"]`), check(`locale-${locale}`)]),
    click('.modal-scrim [data-act="close"]'),
    ...settings("connections"), check(`locale-${locale}`), click('.modal-scrim [data-act="close"]'),
    ...["home", "agent", "dictation"].flatMap(name => [page(name), check(`locale-${locale}`)]),
    ...["history", "dictionary", "overview"].flatMap(tab => [page("dictation"), click(`[data-dictation-tab="${tab}"]`), check(`locale-${locale}`)]),
    page("home"), click('.ho-schedule header [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-day-col'), check(`locale-${locale}`), key("Escape"), waitGone('.au-pop-detail'),
    click('#nav [data-go="settings"]'), check(`locale-${locale}`), click('.modal-scrim [data-act="close"]'),
    ...settings("general"), check(`locale-${locale}`),
  ])),
  scene("conversation-sections", "Raphael's panel switches between his one conversation and his quick questions", [...details, check("conversation-sections")]),
  scene("member-conversation-sections", "A member has one conversation and no conversation list", [member(1), ...details, check("member-no-conversations")]),
  scene("quick-clear-confirm", "Quick history uses the shared compact destructive confirmation", [...open(4), ...details, click('[data-conversation-more="4"]'), click('[data-pick="clear"]'), check("quick-clear-confirm")]),
  scene("quick-cleared", "Quick history is empty but keeps its conversation identity", [...open(4), ...details, click('[data-conversation-more="4"]'), click('[data-pick="clear"]'), click('[data-dlg="delete"]'), wait('.ra-empty:not([hidden])'), check("quick-cleared")]),
  ...[0, 1].flatMap(id => [
    scene(`composer-voice-pending-${id}`, "Composer voice waits in the member's one conversation", [
      member(id), ...details, ...voice(id), wait('[data-key="hearing"]'), check("composer-voice-destination"),
    ], { ownerVoice: "pending" }),
    scene(`composer-voice-answer-${id}`, "Composer voice answers in the member's one conversation", [
      member(id), ...details, ...voice(id), wait('.tn[data-id="301"]'), check("composer-voice-answer"),
    ], { ownerVoice: "answer" }),
  ]),
];
