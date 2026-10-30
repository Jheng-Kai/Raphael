import { onLocaleChange, t } from "./i18n";
import { iconButton } from "./ui";

/** One scroll affordance for chief, member and room timelines. */
export function mountConversationScroll(scroller: HTMLElement): void {
  const stage = scroller.parentElement!;
  stage.insertAdjacentHTML("beforeend", iconButton("down", t("chat.latest"), ' hidden', "conversation-latest"));
  const button = stage.lastElementChild as HTMLButtonElement;
  scroller.tabIndex = 0;
  const sync = (): void => {
    button.hidden = scroller.hidden || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80;
    button.style.bottom = `${Math.max(12, stage.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 12)}px`;
  };
  button.addEventListener("click", () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
  scroller.addEventListener("scroll", sync, { passive: true });
  new MutationObserver(sync).observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  if (typeof ResizeObserver === "function") {
    const resize = new ResizeObserver(sync);
    resize.observe(scroller);
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
  }
  onLocaleChange(() => { button.setAttribute("aria-label", t("chat.latest")); button.title = t("chat.latest"); });
  sync();
}
