import { scene, member, room, wait, key, click, check, paste, typing } from "./steps.mjs";

// The rich field: the words the owner writes are shown as they will read, and what is sent is Markdown. Every typing step goes
// through the real keyboard (driver.mjs `typing`), since what a field turns typed words into never happens to a value written into it.
const field = ".composer .cmp-input";
const SHIFT = "{Shift+Enter}";

// The reply the owner copied out of the app (a heading and five numbered items), as the app draws it, with the plain words a copy carries.
const ITEMS = ["先把這週的重點整理成一頁", "確認每個角色手上的工作", "把需要決定的事列出來", "約好下週一的討論時間", "會後把結論寄給大家"];
export const COPIED_REPLY = {
  html: `<div class="ans"><div class="message-text"><h1>拉斐爾分開了</h1><ol>${ITEMS.map(item => `<li>${item}</li>`).join("")}</ol></div></div>`,
  text: `拉斐爾分開了\n${ITEMS.join("\n")}`,
};
const example = [member(1), paste(field, COPIED_REPLY), wait(`${field} h1`), wait(`${field} ol > li:nth-child(5)`)];

// Each block once, typed with its shortcut: `# `, `- `, `1. `, `[] `, `> `, `>> `, three backticks, `$$ `, `---`, and the marks around words.
const lists = [
  typing(field, "# 本週計畫", SHIFT, "- 整理資料", SHIFT, "寫成摘要", SHIFT, SHIFT, "1. 先看報告", SHIFT, "再問問題", SHIFT, "最後下結論", SHIFT, SHIFT, "[] 寄出摘要", SHIFT, "更新行事曆"),
  wait(`${field} li.cmp-task`),
];
const quoteToggle = [
  typing(field, "> 一句引用的話", SHIFT, SHIFT, ">> 點開看細節", SHIFT, "收起來的內容", SHIFT, SHIFT, "接著寫一般的字"),
  wait(`${field} .cmp-toggle`), wait(`${field} blockquote`),
];
const codeMath = [
  typing(field, "```js ", "const a = 1;", SHIFT, SHIFT, "$$ ", "E = mc^2", SHIFT, SHIFT, "---", "結尾"),
  wait(`${field} pre`), wait(`${field} .cmp-math-shown .katex`), wait(`${field} hr`),
];
const marks = [typing(field, "這是**粗體**、*斜體*、`程式碼`、~~刪除線~~，公式 $x^2$ 和連結 https://example.com/docs")];
const SENT_ALL = [typing(field, "# 標題", SHIFT, "- 一", SHIFT, "二", SHIFT, SHIFT, "> 引用", SHIFT, SHIFT, "公式 $a^2+b^2=c^2$ 與 **粗體**"), key("Enter"),
  wait(".tn.is-pending .owner-message .bubble h1"), wait(".tn.is-pending .owner-message .bubble .katex")];

// The owner's sent messages as the thread draws them again from its history, once each turn is over: numbered lists short and
// long, after words, holding bullets, past 9, tasks, and a bubble that starts with a quote or is only code.
const sentTurn = (question, index) => ({ id: 700 + index, session_id: `owner-sent-${index}`, member_id: 1, conversation_id: 11, created_at_ms: 1792807154000 + index * 60000,
  question, route: "answer", source: "app", prefix: "", text: "好的。", detail: null, status: "done", cost_usd: 0, model: "openai/gpt-6-sol",
  messages: [{ seq: 1, kind: "reply", text: "好的。", at_ms: 1792807154000 + index * 60000 + 5000 }], steps: [], attachments: [] });
export const SENT_LISTS = [
  "1. 好\n2. 先留著\n3. 可以 直接刪掉就好",
  "要改的有：\n\n1. 我們 APP 裡面的按鈕顏色\n2. Notion 裡面的內容\n\n兩個專案都要改",
  "1. 先把這週所有會議的紀錄整理成一份摘要，標出每個人負責的部分和截止日期\n2. 確認每個角色手上的工作有沒有重疊，有的話先跟對方約時間談\n3. 把需要決定的事列出來",
  "1. 準備資料\n   - 報告\n   - 數據\n2. 開會\n3. 寄出結論",
];
export const SENT_BLOCKS = [
  "8. 八\n9. 九\n10. 十\n11. 十一",
  "- [ ] 寄出摘要\n- [x] 更新行事曆\n- 一般項目",
  "> 先引用上一句\n\n然後接著說",
  "```\nnpm run look\n```",
];
const sentThread = (questions, from) => ({ turns: questions.map((question, index) => sentTurn(question, from + index)) });

export default [
  // What the owner pasted: the heading and the five numbered items stay a heading and a numbered list.
  scene("composer-rich-example", "A reply copied out of the app and pasted into the composer keeps its heading, its numbers and its indent", [...example, check("composer-rich-example")]),
  scene("composer-rich-example-sent", "That pasted reply is sent as Markdown, and the owner's own bubble draws the same heading and numbered list", [...example, key("Enter"), wait(".tn.is-pending .owner-message .bubble h1"), check("composer-rich-example-sent")], { stopPending: true }),
  scene("composer-rich-example-room", "A group's composer keeps the pasted reply's structure the same way", [room(1), paste("#room-message", COPIED_REPLY), wait("#room-message h1"), wait("#room-message ol > li:nth-child(5)"), check("composer-rich-example-room")]),
  scene("composer-rich-list", "Shift+Enter in a numbered list starts the next number: 1, 2, then 3", [member(1), typing(field, "1. 買牛奶", SHIFT, "買雞蛋", SHIFT, "買麵包"), wait(`${field} ol > li:nth-child(3)`), check("composer-rich-list")]),
  scene("composer-rich-list-leave", "Shift+Enter on an empty item leaves the list, and Backspace turns an item back into a paragraph", [member(1), typing(field, "- 甲", SHIFT, "乙", SHIFT, SHIFT, "丙"), wait(`${field} ul + p`), check("composer-rich-list-leave")]),
  scene("composer-rich-lists", "A heading, bullets, a numbered list and a task list, typed with their shortcuts", [member(1), ...lists, check("composer-rich-lists")]),
  scene("composer-rich-quote-toggle", "A quote and a toggle with its arrow, typed with their shortcuts", [member(1), ...quoteToggle, check("composer-rich-quote-toggle")]),
  scene("composer-rich-toggle-closed", "The toggle's arrow closes what is under it and opens it again", [member(1), ...quoteToggle, click(`${field} .cmp-toggle-arrow`), wait(`${field} .cmp-toggle[data-open="false"]`), check("composer-rich-toggle-closed")]),
  scene("composer-rich-code-math", "A code block, a display equation drawn under its LaTeX and a divider, typed with their shortcuts", [member(1), ...codeMath, check("composer-rich-code-math")]),
  scene("composer-rich-marks", "Bold, italic, code, strike, an equation and a link are drawn as they are typed", [member(1), ...marks, wait(`${field} .katex`), check("composer-rich-marks")]),
  scene("composer-rich-sent", "A message of headings, lists, a quote and an equation goes out as Markdown and the bubble draws every part", [member(1), ...SENT_ALL, check("composer-rich-sent")], { stopPending: true }),
  scene("composer-rich-bubble-lists", "Sent numbered lists, drawn again once their turns are over: short items, after words, wrapping items and bullets inside an item, each on the bubble's own padding",
    [member(1), wait('.tn[data-id="703"] .owner-message .bubble ol ul'), check("composer-rich-bubble-lists")], sentThread(SENT_LISTS, 0)),
  scene("composer-rich-bubble-blocks", "Sent numbers past 9, tasks in the bubble's colours, and bubbles that start with a quote or hold only code, on the bubble's own padding",
    [member(1), wait('.tn[data-id="707"] .owner-message .bubble .owner-code'), check("composer-rich-bubble-blocks")], sentThread(SENT_BLOCKS, 4)),
  scene("composer-rich-room", "A group's composer takes the same typing shortcuts", [room(1), typing("#room-message", "## 會議", SHIFT, "1. 開場", SHIFT, "討論", SHIFT, SHIFT, "> 結論先寫下來"), wait("#room-message blockquote"), check("composer-rich-room")]),
  scene("composer-rich-docs", "A Google Docs copy with nested lists and a Word copy with numbered paragraphs keep their lists", [member(1),
    paste(field, { html: '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><ul><li><p>水果</p></li><ul><li><p>蘋果</p></li><li><p>香蕉</p></li></ul><li><p>蔬菜 <strong>新鮮</strong></p></li></ul></b>', text: "水果\n蘋果\n香蕉\n蔬菜 新鮮" }),
    wait(`${field} ul ul li`), check("composer-rich-docs")]),
];

