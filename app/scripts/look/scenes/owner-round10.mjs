import { scene, wait, check, click, hover, member, room, page, settings, stableClick } from "./steps.mjs";
const position = value => ({ action: "conversation-position", position: value });
const connections = settings("connections");
export default [
  ...["chief", "member", "room"].flatMap(kind => ["up", "bottom"].map(value => scene(
    `conversation-${kind}-${value}`, `${kind} conversation keeps wheel/keyboard scrolling and a contextual latest action`,
    [...(kind === "member" ? [member(1)] : kind === "room" ? [room(1)] : []), wait('.ra-scroll .tn'), ...(kind === "chief" ? [click('.owner-message [data-act="expand-message"]')] : []), position(value), check(`conversation-${value}`)],
    kind === "member" ? { longReply: true } : kind === "room" ? { longRoomMessages: true } : { longOwner: true },
  ))),
  scene("reply-split-bubbles", "Authored reply messages preserve lists and code in separate bubbles", [member(1), wait('.tn[data-id="2"] .ra .chat-message'), check("reply-split"), check("reply-full")], { splitReplies: true }),
  {
    ...scene("overlay-learned-pill", "One passive learned-word pill has a localized Undo for its complete batch", [hover('#learned-pill'), check("learned-pill")], {
      learnedNotices: [{ words: ["Composio", "HiKari"], token: "synthetic-batch", language: "zh-TW" }],
    }),
    entry: "learned.html", ready: "#learned-pill:not([hidden])",
  },
  scene("stable-connections-switch", "The connection switch stays above search in both states", [
    ...connections, stableClick('[data-conn="tab"][data-id="store"]'), wait('.cs-card'),
    stableClick('[data-conn="store-group"][data-id="productivity"]'), stableClick('[data-conn="store-group"][data-id=""]'),
    stableClick('[data-conn="tab"][data-id="installed"]'),
    click('[data-conn="open"][data-id="composio:notion"]'), click('[data-conn="tool-list"]'),
    stableClick('[data-conn="kind"][data-kind="write"]'), stableClick('[data-conn="kind"][data-kind="write"]'),
    stableClick('[data-conn="kind"][data-kind="read"]'), stableClick('[data-conn="kind"][data-kind="read"]'),
  ]),
  scene("stable-dictionary-controls", "Dictation navigation and dictionary filters stay under the pointer", [
    page("dictation"), stableClick('[data-dictation-tab="history"]'),
    stableClick('[data-filter="cleaned"]'), stableClick('[data-filter="raw"]'), stableClick('[data-filter="all"]'), stableClick('[data-dictation-tab="dictionary"]'),
    stableClick('[data-dictation-tab="overview"]'), stableClick('[data-dictation-tab="dictionary"]'),
    stableClick('[data-filter="auto"]'), stableClick('[data-filter="manual"]'), stableClick('[data-filter="all"]'),
  ]),
  scene("stable-settings-controls", "Existing Settings panes and Models tabs remain fixed", [
    ...settings("models"), stableClick('[data-models-tab="usage"]'), stableClick('[data-models-tab="models"]'),
    stableClick('.modal-scrim [data-pane="general"]'), stableClick('.modal-scrim [data-pane="dictation"]'),
  ]),
];
