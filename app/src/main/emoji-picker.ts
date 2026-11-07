// Reactions as Grok Bot gives them (owner, 2026-11-06): a quick bar of five, whose last slot opens every emoji in one
// card: a search field, one scrolling grid in Unicode's sections, and a footer naming the emoji under the pointer.
// Choosing one closes the card; one Esc leaves it.

import { emojiSections, searchEmoji, type Emoji, type EmojiSection } from "./emoji-data";
import { t } from "./i18n";
import { closeMenu, esc, ico, openPopover } from "./ui";

/** The quick reactions, in Grok Bot's order. */
export const QUICK_REACTIONS = ["👍", "😂", "👎", "❤️", "🎉"] as const;
/** The value of the slot that opens every emoji. */
export const MORE_EMOJI = "+";
/** How many cells a row of the grid holds. */
const COLUMNS = 8;

/** The quick reactions and the slot for every emoji, as buttons that carry `attr` with the emoji (or `MORE_EMOJI`). */
export function quickReactionsHTML(chosen: readonly string[], attr: string): string {
  return QUICK_REACTIONS.map((emoji) =>
    `<button type="button" class="btn sm reaction" tabindex="-1" ${attr}="${esc(emoji)}" aria-pressed="${chosen.includes(emoji)}" aria-label="${esc(t("chat.reactionToggle", { p0: emoji }))}">${esc(emoji)}</button>`,
  ).join("") +
    `<button type="button" class="btn sm reaction reaction-more" tabindex="-1" ${attr}="${MORE_EMOJI}" aria-haspopup="dialog" aria-label="${esc(t("chat.emojiMore"))}" data-tooltip="${esc(t("chat.emojiMore"))}">${ico("smilePlus")}</button>`;
}

/** The pill under a message's react button: the quick reactions, then every emoji. */
export function openReactionBar(anchor: HTMLElement, chosen: readonly string[], onPick: (emoji: string) => void): void {
  const el = openPopover(anchor, quickReactionsHTML(chosen, "data-quick"), { className: "menu reaction-bar", role: "menu", label: t("chat.react") });
  // Every emoji may be wanted next: their names load now, so the grid needs no wait when + is pressed.
  void emojiSections().catch(() => {});
  el.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-quick]");
    if (!button) return;
    const emoji = button.dataset.quick ?? "";
    if (emoji === MORE_EMOJI) return openEmojiPicker(anchor, chosen, onPick);
    closeMenu();
    anchor.focus({ preventScroll: true });
    onPick(emoji);
  });
  el.querySelector<HTMLElement>("button")?.focus();
}

/** A choice of the grid; the emoji the message already has reads as selected. */
const cellHTML = (emoji: Emoji, chosen: readonly string[]): string =>
  `<button type="button" role="option" class="emoji-cell" tabindex="-1" data-emoji="${esc(emoji.char)}" data-name="${esc(emoji.name)}" aria-label="${esc(emoji.name)}" aria-selected="${chosen.includes(emoji.char)}">${esc(emoji.char)}</button>`;

/** The grid: every section under its small label, or what the search found with no labels. */
export function emojiGridHTML(sections: readonly EmojiSection[], query: string, chosen: readonly string[]): string {
  if (query.trim()) {
    const found = searchEmoji(sections, query);
    return found.length ? `<div class="emoji-cells" role="group">${found.map((emoji) => cellHTML(emoji, chosen)).join("")}</div>`
      : `<p class="emoji-none">${esc(t("chat.emojiNone"))}</p>`;
  }
  return sections.map((section) => `<section class="emoji-sec" role="group" aria-label="${esc(section.name)}"><h4 aria-hidden="true">${esc(section.name)}</h4>${blocksHTML(section.emoji, chosen)}</section>`).join("");
}

/** Rows a block of the grid holds: a block out of sight is neither laid out nor painted (agent.css .emoji-block). */
const BLOCK_ROWS = 4;

/** A section's cells in blocks of a few rows, each its own grid, so only the blocks in sight cost anything. */
function blocksHTML(emoji: readonly Emoji[], chosen: readonly string[]): string {
  const size = BLOCK_ROWS * COLUMNS, blocks: string[] = [];
  for (let at = 0; at < emoji.length; at += size) blocks.push(`<div class="emoji-cells emoji-block">${emoji.slice(at, at + size).map((each) => cellHTML(each, chosen)).join("")}</div>`);
  return blocks.join("");
}

/** Every emoji in one card beside `anchor`; `onPick` gets the one chosen. */
export function openEmojiPicker(anchor: HTMLElement, chosen: readonly string[], onPick: (emoji: string) => void): void {
  const el = openPopover(
    anchor,
    `<label class="emoji-find">${ico("search")}<input type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t("chat.emojiSearch"))}" aria-label="${esc(t("chat.emojiSearch"))}"></label>` +
      `<div class="emoji-grid" role="listbox" aria-label="${esc(t("chat.react"))}"><p class="emoji-none" role="status">${esc(t("common.loading"))}</p></div>` +
      `<div class="emoji-foot" aria-hidden="true"><span class="emoji-foot-char"></span><span class="emoji-foot-name"></span></div>`,
    // From the button's left edge, above it when there is room: beside the message, as Grok's, never over the sidebar.
    { className: "menu emoji-picker", role: "dialog", label: t("chat.react"), placement: "start", onKey: (event) => move(event) },
  );
  const input = el.querySelector<HTMLInputElement>("input")!;
  const grid = el.querySelector<HTMLElement>(".emoji-grid")!;
  const footChar = el.querySelector<HTMLElement>(".emoji-foot-char")!;
  const footName = el.querySelector<HTMLElement>(".emoji-foot-name")!;
  let sections: EmojiSection[] = [];
  const cells = (): HTMLButtonElement[] => [...grid.querySelectorAll<HTMLButtonElement>(".emoji-cell")];
  const name = (cell: HTMLElement | null | undefined): void => {
    footChar.textContent = cell?.dataset.emoji ?? "";
    footName.textContent = cell?.dataset.name ?? "";
  };
  // Opening drew all the sections at once: one 1.15 s long task (measured, emoji-picker-speed). The first section is
  // drawn now and the rest a few at a frame, each kept from layout and paint until it scrolls near (agent.css).
  let pass = 0;
  const draw = (): void => {
    const mine = ++pass;
    if (input.value.trim()) { grid.innerHTML = emojiGridHTML(sections, input.value, chosen); grid.scrollTop = 0; name(cells()[0]); return; }
    grid.innerHTML = emojiGridHTML(sections.slice(0, 1), "", chosen);
    grid.scrollTop = 0;
    name(cells()[0]);
    let next = 1;
    const more = (): void => {
      if (mine !== pass || !el.isConnected || next >= sections.length) return;
      grid.insertAdjacentHTML("beforeend", emojiGridHTML(sections.slice(next, next + 2), "", chosen));
      next += 2;
      requestAnimationFrame(more);
    };
    requestAnimationFrame(more);
  };
  const pick = (cell: HTMLElement): void => {
    closeMenu();
    anchor.focus({ preventScroll: true });
    onPick(cell.dataset.emoji ?? "");
  };
  /** The arrow keys walk the grid by cell and by row; from the field, Down enters it and Enter takes the first. */
  function move(event: KeyboardEvent): boolean {
    const list = cells();
    if (event.target === input) {
      if (event.key === "ArrowDown" && list.length) { list[0].focus(); return true; }
      if (event.key === "Enter" && list.length) { pick(list[0]); return true; }
      return false;
    }
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return false;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
    if (step === undefined) return false;
    const next = at + step;
    if (next < 0) input.focus();
    else list[Math.min(next, list.length - 1)].focus();
    return true;
  }
  grid.addEventListener("click", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>(".emoji-cell");
    if (cell) pick(cell);
  });
  grid.addEventListener("pointerover", (event) => name((event.target as Element).closest<HTMLElement>(".emoji-cell") ?? undefined));
  grid.addEventListener("focusin", (event) => name((event.target as Element).closest<HTMLElement>(".emoji-cell") ?? undefined));
  input.addEventListener("input", draw);
  input.focus();
  void emojiSections().then((loaded) => {
    if (!el.isConnected) return;
    sections = loaded;
    draw();
  }).catch(() => {
    if (el.isConnected) grid.innerHTML = `<p class="emoji-none" role="alert">${esc(t("chat.emojiFailed"))}</p>`;
  });
}
