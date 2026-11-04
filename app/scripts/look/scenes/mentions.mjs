import { scene, click, type, wait, room, check, key, ime } from "./steps.mjs";

// The fixture's connected apps (Notion among them) sit next to its members: what an @ can address in a private chat.
const apps = {};
const field = ".composer .cmp-input";
// As the owner writes it: an @ opens the menu, and a row completes it with the name and a space.
const pick = name => [wait("#app-popover[data-team-mentions]"), click(`#app-popover [data-value="${name}"]`)];
const words = [type(field, "請用 @"), ...pick("Notion"), type(field, "請用 @Notion 整理這份報告，再問 @"), ...pick("小森")];
const chipped = [type(field, "@"), ...pick("Notion")];
const discovery = {
  mentionMany: true,
  commands: [{ id: 61, member_id: 0, name: "review", description: "整理研究重點", template: "Review {input}" }],
  skills: [
    { id: 71, member_id: 0, name: "outline", slash_name: "outline", description: "整理文章架構", enabled: true, source: "https://github.com/example/notes/blob/main/SKILL.md" },
    { id: 72, member_id: 0, name: "review", slash_name: "field-notes:review", description: "核對資料來源", enabled: true, source: "plugin:Field Notes", plugin: "Field Notes" },
    { id: 73, member_id: 0, name: "review", slash_name: "desk-notes:review", description: "核對會議摘要", enabled: true, source: "plugin:Desk Notes", plugin: "Desk Notes" },
  ],
};
const before = check("completion-before");

export default [
  scene("completion-mentions", "Mention headings and five recent services from thirty-two connections", [before, type(field, "@"), wait("#app-popover"), check("completion-mentions")], discovery),
  scene("completion-filtered", "Alias search ranks services and caps visible results", [before, type(field, "@notes"), wait("#app-popover"), check("completion-filtered")], discovery),
  scene("completion-expanded", "Show all opens services in place with bounded pages", [before, type(field, "@"), wait("#app-popover .menu-action"), click("#app-popover .menu-action"), check("completion-expanded")], discovery),
  scene("completion-expanded-last", "Every service is reachable, including sign-in and key states", [before, type(field, "@"), wait("#app-popover .menu-action"), click("#app-popover .menu-action"), ...Array.from({ length: 3 }, () => click('#app-popover button[data-action]:last-child')), check("completion-expanded-last")], discovery),
  scene("completion-group", "Group mentions limit members while retaining connected services", [room(1), before, type("#room-message", "@"), wait("#app-popover"), check("completion-group")], discovery),
  scene("completion-slash", "Member commands and skills use the same grouped menu", [before, type(field, "/"), wait(".slash-menu"), check("completion-slash")], discovery),
  scene("completion-plugin", "Plugin skill keeps its quiet source and description", [before, type(field, "/field"), wait(".slash-menu"), check("completion-plugin")], discovery),
  scene("completion-clash", "Clashing names stay separate through selection", [before, type(field, "/review"), wait(".slash-menu"), check("completion-clash"), key("ArrowDown"), key("Tab"), check("completion-picked")], discovery),
  // The double @ of a Chinese input method: composing the @ typed it twice (a menu that took the focus ended the composition).
  scene("mention-ime-open", "The mention menu is drawn while the @ is still being composed, and the field keeps the focus",
    [ime(field, [{ compose: "@" }]), wait("#app-popover[data-team-mentions]"), check("mention-ime-open")], apps),
  scene("mention-ime-at", "An input method that composes the @ types it once, and the mention menu opens on the finished text",
    [ime(field, [{ compose: "@" }, { commit: "@" }]), wait("#app-popover[data-team-mentions]"), check("mention-ime-at")], apps),
  scene("mention-ime-filter", "A Bopomofo syllable after the @ narrows the menu once it is committed, with no character typed twice",
    [ime(field, [{ compose: "@" }, { commit: "@" }, { compose: "ㄒㄧㄠˇ" }, { commit: "小" }]), wait("#app-popover[data-team-mentions]"), check("mention-ime-filter")], apps),
  scene("mention-ime-compose", "Words being composed after a chip are drawn underlined beside it, and the chip stays", [...chipped, ime(field, [{ compose: "ㄅ" }]), check("mention-ime-compose")], apps),
  scene("mention-ime-commit", "Words committed after a chip stand once beside it", [...chipped, ime(field, [{ compose: "ㄅ" }, { commit: "吧" }]), check("mention-ime-commit")], apps),
  scene("mention-chip-composer", "An @ completed from the menu is a chip with its mark and name, apart from the words around it", [...words, check("mention-chip-composer")], apps),
  scene("mention-chip-sent", "The sent bubble shows the same chips, and the core receives the words unchanged", [...words, key("Enter"), wait(".owner-message .bubble .mention-chip"), check("mention-chip-sent")], { ...apps, stopPending: true }),
  scene("mention-chip-delete", "Backspace after a chip deletes all of it at once", [type(field, "請問 @小森"), key("Backspace"), check("mention-chip-delete")], apps),
  scene("mention-chip-arrow", "The arrow keys cross a chip in one step and Shift takes it into the selection whole",
    [type(field, "a @小森 b"), key("ArrowLeft"), key("ArrowLeft"), key("ArrowLeft"), check("mention-chip-arrow-before"), { action: "key", key: "ArrowRight", shift: true }, check("mention-chip-arrow-selected")], apps),
  scene("mention-chip-room", "A room's composer draws its members and the apps as chips, and a group it does not offer stays plain words", [room(1), type("#room-message", "@Notion 請 @小晴 看一下，@專案工作 也是"), check("mention-chip-room")], apps),
];
