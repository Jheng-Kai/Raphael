import { scene, member, room, wait, hover, click, check, type, key } from "./steps.mjs";
const reply = '.tn[data-id="8201"] .chat-message[data-reply]';
const privateOpen = [member(1), wait(reply)];
const root = '[data-room-message="8202"]';
const roomOpen = [room(1), wait(root)];
export default [
  scene('reaction-picker', 'One reaction control opens the compact five-reaction pill Grok Bot has', [...privateOpen, hover(reply), click(`${reply} [data-act="react-message"]`), check('reaction-picker')], {chatMetadata:'reaction'}),
  scene('message-hugs-bubble', 'A long reply is only as wide as its bubble and actions: the room beside it answers neither the pointer nor a right click', [...privateOpen, hover(reply), check('message-hugs-bubble'), hover('.composer')], {chatMetadata:'long'}),
  scene('reaction-row','Saved owner reactions stay underneath their own message', [...privateOpen, check('reaction-row'), check('reaction-layout-rest'), hover(reply), check('reaction-layout-hover'), hover('.composer')], {chatMetadata:'reaction'}),
  scene('reaction-not-approval', 'A laughing reaction leaves the draft and owner question pending', [...privateOpen, hover(reply), click(`${reply} [data-act="react-message"]`), click('#app-popover [data-quick="😂"]'), wait(`${reply} [data-reaction="😂"]`), check('reaction-not-approval')], {chatMetadata:'approval'}),
  scene('room-thread-open', 'A room side thread contains its root and only its own replies', [...roomOpen, hover(`${root} .chat-message`), click(`${root} [data-room-act="thread"]`), wait('.room-side-thread [data-side-message="8204"]'), check('room-thread-open'), check('reaction-layout-rest'), hover('.room-side-thread [data-side-message="8202"] .chat-message'), check('reaction-layout-hover'), hover('.room-side-thread > header')], {chatMetadata:'room'}),
  scene('room-thread-chip', 'The main room keeps one compact reply chip below the original result', [...roomOpen, check('room-thread-chip'), check('reaction-layout-rest'), hover(`${root} .chat-message`), check('reaction-layout-hover'), hover('.au-room-pane .composer')], {chatMetadata:'room'}),
  scene('slack-draft', 'An editable Slack draft shares the existing versioned owner card', [...privateOpen, wait('[data-draft-kind="slack"]'), type('[data-draft-kind="slack"] [data-mail-field="body"]','範例摘要已整理完成，請在週五前提供意見。'), key('Tab'), check('slack-draft')], {chatMetadata:'slack'}),
  scene('voice-memo', 'A reply carries Play, Pause and retains its expanded transcript', [...privateOpen, click('.memo-transcript summary'), hover(reply), click(`${reply} [data-act="memo-play"]`), wait(`${reply} [data-act="memo-play"][aria-pressed="true"]`), click(`${reply} [data-act="memo-play"]`), wait(`${reply} [data-act="memo-play"][aria-pressed="false"]`), check('voice-memo')], {chatMetadata:'voice'}),
];
