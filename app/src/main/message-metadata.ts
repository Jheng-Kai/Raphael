import { openReactionBar, quickReactionsHTML } from "./emoji-picker";
import { t } from "./i18n";
import { esc, ico, iconButton } from "./ui";

export const reactionControlHTML = (): string => iconButton("smile", t("chat.react"), ' data-act="react-message" aria-haspopup="menu"').replace(" title=", " data-tooltip=");
/** The reactions a message has, any emoji, each a chip that takes it back. */
export function reactionRowHTML(reactions: readonly string[] = []): string {
  return reactions.length ? `<div class="message-reactions" aria-label="${esc(t("chat.reactions"))}">${reactions.map(emoji => `<button type="button" class="btn sm reaction" data-reaction="${esc(emoji)}" aria-pressed="true" aria-label="${esc(t("chat.reactionToggle", { p0: emoji }))}">${esc(emoji)}</button>`).join("")}</div>` : "";
}
/** The quick reactions above a message menu, then the slot for every emoji: each toggles, and the ones already given read as pressed. */
export function menuReactionsHTML(reactions: readonly string[]): string {
  return `<div class="menu-reactions" role="group" aria-label="${esc(t("chat.react"))}">${quickReactionsHTML(reactions, "data-lead")}</div>`;
}
export const memoActionHTML =(playing = false): string => iconButton(playing ? "pause" : "play", t(playing ? "chat.memoPause" : "chat.memoPlay"), ` data-act="memo-play" aria-pressed="${playing}"`).replace(" title=", " data-tooltip=");
export const memoTranscriptHTML = (text: string): string => `<details class="memo-transcript"><summary>${esc(t("chat.memoTranscript"))}</summary><p>${esc(text)}</p></details>`;

/** Keep the owner's expanded transcript when playback or reactions redraw a line. */
export function carryMessageMetadata(before: Element, after: HTMLElement): void {
  const transcripts = [...after.querySelectorAll<HTMLDetailsElement>(".memo-transcript")];
  before.querySelectorAll<HTMLDetailsElement>(".memo-transcript").forEach((details, index) => {
    if (details.open) transcripts[index]?.setAttribute("open", "");
  });
}

export interface MessageMetadataSource {
  reactions: readonly string[];
  react(emoji: string, active: boolean): Promise<unknown>;
  memo?(action: "play" | "pause"): Promise<{ ok: boolean; kind?: string }>;
}
/** Metadata actions have no access to permission, question or draft resolution. */
export function mountMessageMetadata(host: HTMLElement, source: (control: HTMLElement) => MessageMetadataSource | null, refresh: () => void, fail: (error: unknown) => void): () => void {
  let alive = true;
  const onClick = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLElement>('[data-act="react-message"], [data-reaction], [data-act="memo-play"]');
    if (!button || !host.contains(button) || (button as HTMLButtonElement).disabled) return;
    const message = source(button);
    if (!message) return;
    const react = (emoji: string): void => {
      void message.react(emoji, !message.reactions.includes(emoji)).then(() => { if (alive) refresh(); }).catch(fail);
    };
    if (button.dataset.reaction) react(button.dataset.reaction);
    else if (button.dataset.act === "react-message") openReactionBar(button, message.reactions, react);
    else if (message.memo) {
      const playing = button.getAttribute("aria-pressed") === "true";
      (button as HTMLButtonElement).disabled = true;
      void message.memo(playing ? "pause" : "play").then(result => {
        if (!alive || !button.isConnected) return;
        if (!result.ok) throw new Error(t("chat.memoUnavailable"));
        button.setAttribute("aria-pressed", String(!playing));
        button.dataset.tooltip = t(playing ? "chat.memoPlay" : "chat.memoPause");
        button.setAttribute("aria-label", button.dataset.tooltip);
        button.innerHTML = ico(playing ? "play" : "pause");
      }).catch(fail).finally(() => { if (button.isConnected) (button as HTMLButtonElement).disabled = false; });
    }
  };
  host.addEventListener("click", onClick);
  return () => { alive = false; host.removeEventListener("click", onClick); };
}
