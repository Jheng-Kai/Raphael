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

// Every format by its shortcut: Ctrl+B, I, U, Shift+S, E, Shift+H around words typed, then the bar over a selection.
const CTRL = "{Control+";
const keys = [typing(field, "重點 ", `${CTRL}b}`, "粗體", `${CTRL}b}`, " ", `${CTRL}i}`, "斜體", `${CTRL}i}`, " ", `${CTRL}u}`, "底線", `${CTRL}u}`, " ", "{Control+Shift+s}", "刪除線", "{Control+Shift+s}", " ", `${CTRL}e}`, "程式碼", `${CTRL}e}`, " ", "{Control+Shift+h}", "螢光", "{Control+Shift+h}", " 結束")];
const selected = [typing(field, "把這一句話的重點選起來", "{Shift+Home}"), wait(".cmp-fmt:not([hidden])")];
const bar = id => `.cmp-fmt [data-bar="${id}"]`;

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
  scene("composer-rich-room", "A group's composer takes the same typing shortcuts", [room(1), typing("#room-message", "## 會議", SHIFT, "1. 開場", SHIFT, "討論", SHIFT, SHIFT, "> 結論先寫下來"), wait("#room-message blockquote"), check("composer-rich-room")]),
  scene("composer-rich-keys", "Ctrl+B, I, U, Shift+S, E and Shift+H make the words typed bold, italic, underlined, struck, code and highlighted, and Ctrl+B does not fold the sidebar", [member(1), ...keys,
    wait(`${field} strong`), wait(`${field} u`), wait(`${field} mark`), check("composer-rich-keys")]),
  scene("composer-rich-bar", "Words selected in the composer have the formatting bar above them: the block's kind, six marks, an equation and the link", [member(1), ...selected, check("composer-rich-bar")]),
  scene("composer-rich-bar-pressed", "A press on the bar's bold and highlight formats the selection, keeps the selection and the caret's place, and shows what is on", [member(1), ...selected,
    click(bar("bold")), click(bar("highlight")), wait(`${bar("bold")}[aria-pressed="true"]`), check("composer-rich-bar-pressed")]),
  scene("composer-rich-bar-block", "The bar's block menu lists text, headings, lists, a quote, a toggle, code, an equation, a divider and a table, each with its keys", [member(1), ...selected,
    click(".cmp-fmt .cmp-fmt-block"), wait("#app-popover .menu-choice"), check("composer-rich-bar-block")]),
  scene("composer-rich-bar-heading", "Choosing Heading 2 turns the line into one, and the bar names it", [member(1), ...selected, click(".cmp-fmt .cmp-fmt-block"), wait("#app-popover .menu-choice"),
    click('#app-popover [data-value="h2"]'), wait(`${field} h2`), wait(".cmp-fmt .cmp-fmt-kind"), check("composer-rich-bar-heading")]),
  scene("composer-rich-link-edit", "Ctrl+K opens the link editor in the bar's place, with the address to write", [member(1), ...selected, typing(field, "{Control+k}"), wait(".cmp-fmt .cmp-fmt-address"), check("composer-rich-link-edit")]),
  scene("composer-rich-link-set", "An address typed into the link editor and Enter make the words a link, drawn in the link colour, and the bar goes back to the marks", [member(1), ...selected,
    typing(field, "{Control+k}"), wait(".cmp-fmt .cmp-fmt-address"), typing(".cmp-fmt .cmp-fmt-address", "example.com/docs", "{Enter}"), wait(`${field} a.composer-link`), check("composer-rich-link-set")]),
  scene("composer-rich-bar-code", "In a code block the bar keeps the block menu and names the language, and the marks are off", [member(1),
    typing(field, "```js ", "const a = 1;", "{Shift+Home}"), wait(".cmp-fmt:not([hidden]) .cmp-fmt-language:not([hidden])"), check("composer-rich-bar-code")]),
  scene("composer-rich-bar-table", "In a table's words the bar adds the table menu: rows and columns in, rows and columns out", [member(1),
    paste(field, { text: "| 欄位一 | 欄位二 |\n| --- | --- |\n| 甲 | 乙 |" }), wait(`${field} table`), click(`${field} tbody tr:nth-child(2) td:nth-child(1)`), typing(field, "{Shift+Home}"), wait(".cmp-fmt:not([hidden]) .cmp-fmt-table:not([hidden])"),
    click(bar("table")), wait("#app-popover .menu-choice"), check("composer-rich-bar-table")]),
  scene("composer-rich-bar-keyboard", "Alt+F10 goes to the bar: the first control shows its focus ring, the arrows move along it, Escape goes back to the words", [member(1), ...selected,
    typing(field, "{Alt+F10}"), wait(".cmp-fmt .cmp-fmt-block:focus"), typing(".cmp-fmt .cmp-fmt-block", "{ArrowRight}"), wait(`${bar("bold")}:focus`), check("composer-rich-bar-keyboard")]),
  scene("composer-rich-sent-marks", "Underline, highlight, strike and code go out as Markdown, and the owner's bubble draws each", [member(1), ...keys, key("Enter"),
    wait(".tn.is-pending .owner-message .bubble u"), wait(".tn.is-pending .owner-message .bubble mark"), check("composer-rich-sent-marks")], { stopPending: true }),
  scene("composer-rich-docs", "A Google Docs copy with nested lists and a Word copy with numbered paragraphs keep their lists", [member(1),
    paste(field, { html: '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><ul><li><p>水果</p></li><ul><li><p>蘋果</p></li><li><p>香蕉</p></li></ul><li><p>蔬菜 <strong>新鮮</strong></p></li></ul></b>', text: "水果\n蘋果\n香蕉\n蔬菜 新鮮" }),
    wait(`${field} ul ul li`), check("composer-rich-docs")]),
];
