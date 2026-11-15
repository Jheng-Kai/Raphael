import { onLocaleChange, t } from "./i18n";
import { iconButton } from "./ui";

/**
 * The conversation's header stands over the top of its thread (members.css), so a wheel turned over it would stop at the header. It
 * moves what the thread, or the page or report open in its place, would have moved: the header takes no room from the thread and no
 * wheel from it either.
 */
export function passWheelUnder(head: HTMLElement, stage: HTMLElement): void {
  head.addEventListener("wheel", event => {
    if (event.ctrlKey || !event.deltaY) return;
    const under = stage.classList.contains("is-page") ? stage.querySelector<HTMLElement>(".rp-scroll, .pgv-page") : stage.querySelector<HTMLElement>(":scope > .ra-scroll");
    if (!under || under.scrollHeight <= under.clientHeight) return;
    event.preventDefault();
    // What listens for the owner's wheel on the thread hears this one too (message-rich.ts lets go of the bottom on a wheel up).
    under.dispatchEvent(new WheelEvent("wheel", { deltaY: event.deltaY, deltaMode: event.deltaMode }));
    under.scrollTop += event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? under.clientHeight : 1);
  }, { passive: false });
}

/** One scroll affordance for chief, member and room timelines. */
export function mountConversationScroll(scroller: HTMLElement): void {
  const stage = scroller.parentElement!;
  stage.insertAdjacentHTML("beforeend", iconButton("down", t("chat.latest"), ' hidden', "conversation-latest"));
  const button = stage.lastElementChild as HTMLButtonElement;
  scroller.tabIndex = 0;
  let nearBottom = true;
  const observed = typeof IntersectionObserver === 'function';
  const sync = (): void => {
    if (!observed) nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80;
    button.hidden = scroller.hidden || (!Number(scroller.dataset.windowLater) && nearBottom);
    if (observed) scroller.dispatchEvent(new CustomEvent("conversation-near-bottom", { detail: nearBottom && !Number(scroller.dataset.windowLater) }));
  };
  const position = (): void => {
    button.style.bottom = `${Math.max(12, stage.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 12)}px`;
  };
  if (observed) {
    const end = document.createElement('span');
    end.className = 'conversation-end'; end.setAttribute('aria-hidden', 'true');
    end.style.cssText = 'display:block;height:1px;pointer-events:none';
    scroller.append(end);
    new IntersectionObserver(entries => {
      nearBottom = entries[0]?.isIntersecting ?? true; sync();
    }, { root: scroller, rootMargin: '0px 0px 80px 0px' }).observe(end);
  }
  button.addEventListener("click", () => {
    scroller.dispatchEvent(new CustomEvent("conversation-latest"));
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
  let queued = false;
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };
  if (!observed) scroller.addEventListener("scroll", schedule, { passive: true });
  // Visibility and window range are the only attributes relevant to this affordance.
  // Rich content/animated descendants cannot request a container-height measurement.
  new MutationObserver(schedule).observe(scroller, { attributes: true, attributeFilter: ["hidden", "data-window-later"] });
  if (typeof ResizeObserver === "function") {
    const resize = new ResizeObserver(position);
    resize.observe(scroller); resize.observe(stage);
  }
  position();
  onLocaleChange(() => { button.setAttribute("aria-label", t("chat.latest")); button.title = t("chat.latest"); });
  sync();
}
