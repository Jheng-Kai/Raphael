import { check, click, key, member, page, scene, settings, wait, waitGone } from "./steps.mjs";

const details = [{ action: "open-details" }, wait('.mb-det:not([hidden])')];
const open = id => [...details, click(`[data-conversation-open="${id}"]`)];
const voice = [click('.mb-det [data-det="close"]'), wait('.conversation-trigger[aria-expanded="false"]'), click('.cmp-voice')];
const language = locale => [click('[data-k="ui-language"]'), click(`#app-popover [data-value="${locale}"]`), wait(`html[lang="${locale}"]`), check(`locale-${locale}`)];
const panes = ["general", "appearance", "connections", "models", "dictation", "tools", "safety", "messaging", "about"];

export default [
  ...["en", "ja", "zh-TW"].map(locale => scene(`settings-language-${locale}`, `Switch to ${locale} in Settings and walk every page and section`, [
    ...settings("appearance"), ...language(locale === "zh-TW" ? "en" : locale),
    ...(locale === "zh-TW" ? language(locale) : []),
    ...panes.flatMap(pane => [click(`.modal-scrim [data-pane="${pane}"]`), wait(`.modal-scrim [data-pane="${pane}"][aria-current="page"]`), check(`locale-${locale}`)]),
    click('.modal-scrim [data-act="close"]'),
    ...["home", "agent", "dictation"].flatMap(name => [page(name), check(`locale-${locale}`)]),
    ...["history", "dictionary", "overview"].flatMap(tab => [page("dictation"), click(`[data-dictation-tab="${tab}"]`), check(`locale-${locale}`)]),
    page("home"), click('.ho-calendar [data-home-go="calendar"]'), wait('.au-page:not([hidden]) .au-day-col'), check(`locale-${locale}`), key("Escape"), waitGone('.au-pop-detail'),
    click('#nav [data-go="settings"]'), check(`locale-${locale}`), click('.modal-scrim [data-act="close"]'),
    ...settings("general"), check(`locale-${locale}`),
  ])),
  scene("conversation-sections", "Quick questions and named conversations have separate shared headings", [...details, check("conversation-sections")]),
  scene("member-conversation-sections", "A member has only the ordinary conversation section", [member(1), ...details, check("conversation-sections")]),
  scene("quick-clear-confirm", "Quick history uses the shared compact destructive confirmation", [...open(4), ...details, click('[data-conversation-more="4"]'), click('[data-pick="clear"]'), check("quick-clear-confirm")]),
  scene("quick-cleared", "Quick history is empty but keeps its conversation identity", [...open(4), ...details, click('[data-conversation-more="4"]'), click('[data-pick="clear"]'), click('[data-dlg="delete"]'), wait('.ra-empty:not([hidden])'), check("quick-cleared")]),
  scene("new-conversation-empty", "A new conversation contains no stale exchanges or dates", [...details, click('[data-conversation-new]'), check("conversation-empty")], { ownerEmptyRecords: true }),
  ...[0, 1].flatMap(id => [
    scene(`composer-voice-pending-${id}`, "Composer voice waits in the chosen non-default conversation", [
      member(id), ...open(id ? 12 : 2), ...voice, wait('[data-key="hearing"]'), check("composer-voice-destination"),
    ], { ownerVoice: "pending" }),
    scene(`composer-voice-answer-${id}`, "Composer voice answers in the chosen non-default conversation", [
      member(id), ...open(id ? 12 : 2), ...voice, wait('.tn[data-id="301"]'), check("composer-voice-answer"),
    ], { ownerVoice: "answer" }),
  ]),
];
