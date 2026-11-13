import { openReactionBar, quickReactionsHTML } from "./emoji-picker";
import { t } from "./i18n";
import { esc, iconButton } from "./ui";

export const reactionControlHTML = (): string => iconButton("smile", t("chat.react"), ' data-act="react-message" aria-haspopup="menu"').replace(" title=", " data-tooltip=");
/** The reactions a message has, any emoji, each a chip that takes it back. */
export function reactionRowHTML(reactions: readonly string[] = []): string {
  return reactions.length ? `<div class="message-reactions" aria-label="${esc(t("chat.reactions"))}">${reactions.map(emoji => `<button type="button" class="btn sm reaction" data-reaction="${esc(emoji)}" aria-pressed="true" aria-label="${esc(t("chat.reactionToggle", { p0: emoji }))}">${esc(emoji)}</button>`).join("")}</div>` : "";
}
const FIRST_BUBBLE = /<div class="(?:ans|bubble)(?=[\s"])[^"]*"[^>]*>/;
/**
 * A message's reactions stand on its first bubble's top corner (the right one, the left of the owner's), so they belong
 * to the bubble itself: drawn inside it, they follow it whatever sits under it (cards, a sign-in button, a failure row).
 * A message with no bubble (only a card) keeps them as the last part, which the CSS puts on the first part's corner.
 */
export function withReactions(html: string, reactions: readonly string[] | undefined): string {
  const row = reactionRowHTML(reactions);
  const bubble = row ? FIRST_BUBBLE.exec(html) : null;
  return !row ? html : bubble ? html.slice(0, bubble.index + bubble[0].length) + row + html.slice(bubble.index + bubble[0].length) : html + row;
}
/** The quick reactions above a message menu, then the slot for every emoji: each toggles, and the ones already given read as pressed. */
export function menuReactionsHTML(reactions: readonly string[]): string {
  return `<div class="menu-reactions" role="group" aria-label="${esc(t("chat.react"))}">${quickReactionsHTML(reactions, "data-lead")}</div>`;
}

export interface MessageMetadataSource {
  reactions: readonly string[];
  react(emoji: string, active: boolean): Promise<unknown>;
}
/** Metadata actions have no access to permission, question or draft resolution. */
export function mountMessageMetadata(host: HTMLElement, source: (control: HTMLElement) => MessageMetadataSource | null, refresh: () => void, fail: (error: unknown) => void): () => void {
  let alive = true;
  const onClick = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLElement>('[data-act="react-message"], [data-reaction]');
    if (!button || !host.contains(button) || (button as HTMLButtonElement).disabled) return;
    const message = source(button);
    if (!message) return;
    const react = (emoji: string): void => {
      void message.react(emoji, !message.reactions.includes(emoji)).then(() => { if (alive) refresh(); }).catch(fail);
    };
    if (button.dataset.reaction) react(button.dataset.reaction);
    else if (button.dataset.act === "react-message") openReactionBar(button, message.reactions, react);
  };
  host.addEventListener("click", onClick);
  return () => { alive = false; host.removeEventListener("click", onClick); };
}
