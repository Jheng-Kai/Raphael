import { scene, member, room, wait, check, click, type } from "./steps.mjs";

const privateOpen = [member(1), wait('.tn[data-id="9149"]')];
const roomOpen = [room(1), wait('.tn[data-room-message="9149"]')];
export default [
  scene("thread-window-open", "A 150-turn conversation opens only the newest 25 turns", [...privateOpen, check("thread-window-open")], {threadWindow:"private"}),
  scene("thread-window-earlier", "The top sentinel adds exactly 20 turns without moving the reading anchor", [...privateOpen, {action:"thread-window-earlier"}, check("thread-window-earlier")], {threadWindow:"private"}),
  scene("thread-window-find", "Finding an old unmounted reply mounts its surrounding window first", [...privateOpen, click('.mb-chat:not([hidden]) [data-act="search"]'), type('.ra-find-input', '視窗搜尋標記'), wait('mark.is-current'), check("thread-window-find")], {threadWindow:"private"}),
  scene("thread-window-quote", "A quote jump mounts its old source before scrolling", [...privateOpen, click('.tn[data-id="9149"] [data-act="jump-quote"]'), wait('.tn[data-id="9005"]'), check("thread-window-quote")], {threadWindow:"private"}),
  scene("room-window-open", "Group conversations share the newest 25-turn window", [...roomOpen, check("thread-window-open")], {threadWindow:"room"}),
  scene("room-window-earlier", "Group conversations share the anchored 20-turn prepend", [...roomOpen, {action:"thread-window-earlier"}, check("thread-window-earlier")], {threadWindow:"room"}),
  scene("room-window-find", "A group search mounts an old result before scrolling", [...roomOpen, click('[data-room-search]'), type('.au-room-pane .ra-find-input', '視窗搜尋標記'), wait('mark.is-current'), check("thread-window-find")], {threadWindow:"room"}),
  scene("thread-window-composio-find", "An old result is found by its public localized summary instead of transport fields", [...privateOpen, click('.mb-chat:not([hidden]) [data-act="search"]'), type('.ra-find-input', '已完成'), wait('mark.is-current'), check("thread-window-find")], {threadWindow:"private",windowComposio:true}),
  scene("room-window-composio-find", "Group search uses the same public projection for an unmounted result", [...roomOpen, click('[data-room-search]'), type('.au-room-pane .ra-find-input', '已完成'), wait('mark.is-current'), check("thread-window-find")], {threadWindow:"room",windowComposio:true}),
  scene("room-window-quote", "A group reply reference mounts its old source before scrolling", [...roomOpen, click('[data-room-message="9149"] [data-room-act="jump-reply"]'), wait('[data-room-message="9005"]'), check("thread-window-quote")], {threadWindow:"room"}),
];
