// A card that waits for the owner and has been scrolled out of sight floats. A small pill at the top of the conversation
// names it; a press opens the card itself over the thread, where its fields and buttons work as they do in place (it stays
// in the thread and only stands fixed, its place kept by a spacer); the back arrow scrolls to where it was born. Back in sight,
// or answered, the pill goes away.

import { t } from "./i18n";
import { releaseRichScroll } from "./message-rich";
import { bindNavLayer } from "./nav-layers";
import { cardFloatInk, memberColor } from "./owner-bubble";
import { ico } from "./ui";

/** A card waits for the owner: its own status pill says so, or it is an owner question still asked. */
export const waitingCard = (card: HTMLElement): boolean =>
  card.dataset.cardState === "asked" || card.querySelector(".card-head .card-status.is-waiting")?.closest(".conversation-card") === card;

const FLASH_MS = 1200;
const CLOSE = ":scope > .card-head .card-close";
const CARD_IDS = ["ownerQuestion", "connector", "secretCard", "permissionCard", "computerCard", "desktopWork", "mailCard", "mailOffer", "mcpProposal", "pairingCard"] as const;

function cardKey(card: HTMLElement): string | undefined {
  const kind = CARD_IDS.find(key => card.dataset[key]);
  if (kind) return `${kind}:${card.dataset[kind]}`;
  const closeId = card.querySelector<HTMLElement>(CLOSE)?.dataset.cardClose;
  if (closeId) return `close:${closeId}`;
  // Cards without their own ID can still keep their identity across redraws of the same thread line.
  const line = card.closest<HTMLElement>("[data-key]");
  if (line) return `line:${line.dataset.key}:${Array.from(line.querySelectorAll(".conversation-card")).indexOf(card)}`;
}

export function mountCardFloat(o: {
  stage: HTMLElement;
  scroller: HTMLElement;
  thread: HTMLElement;
  memberOfCard(card: HTMLElement): Parameters<typeof memberColor>[0];
}): { sync(): void } {
  const pill = document.createElement("div");
  pill.className = "card-float";
  pill.hidden = true;
  pill.innerHTML =
    `<button type="button" class="btn card-float-open" aria-expanded="false">` +
    `<span class="card-float-title"></span><span class="card-float-chev" aria-hidden="true">${ico("down")}</span></button>` +
    `<button type="button" class="btn card-float-back">${ico("reply")}</button>`;
  o.stage.append(pill);
  const openButton = pill.querySelector<HTMLButtonElement>(".card-float-open")!;
  const backButton = pill.querySelector<HTMLButtonElement>(".card-float-back")!;
  const title = pill.querySelector<HTMLElement>(".card-float-title")!;

  /** The newest waiting card, the spacer that keeps its place while it floats, and whether it is out of sight. */
  let card: HTMLElement | null = null;
  let place: HTMLElement | null = null;
  let away = false;
  let restoreClose: (() => void) | undefined;
  const poppedKeys = new Set<string>();
  const poppedCards = new WeakSet<HTMLElement>();
  let pop: Animation | undefined;
  const watch = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => {
        const entry = entries.find(item => item.target === (place ?? card));
        if (entry) { away = !entry.isIntersecting; draw(); }
      }, { root: o.scroller })
    : null;

  function words(): void {
    const back = t("cardFloat.back");
    if (backButton.getAttribute("aria-label") !== back) { backButton.setAttribute("aria-label", back); backButton.title = back; }
    const name = card?.querySelector(".card-title")?.textContent?.trim() ?? "";
    if (title.textContent !== name) title.textContent = name;
  }

  function tint(current: HTMLElement): void {
    const member = o.memberOfCard(current);
    const isRaphael = member.id === 0;
    const color = (isRaphael ? getComputedStyle(o.stage).getPropertyValue("--raphael-color").trim() : "") || memberColor(member);
    const { ink, maxMix } = cardFloatInk(color);
    pill.style.setProperty("--card-float-fill", isRaphael ? "var(--raphael-color)" : color);
    pill.style.setProperty("--card-float-ink", ink);
    pill.style.setProperty("--card-float-mix", `${maxMix * 100}%`);
  }

  function popOnce(current: HTMLElement): void {
    const key = cardKey(current);
    if (key ? poppedKeys.has(key) : poppedCards.has(current)) return;
    if (key) poppedKeys.add(key);
    else poppedCards.add(current);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pop = pill.animate?.([
      { transform: "translateX(-50%) scale(0.92, 0.84)" },
      { transform: "translateX(-50%) scale(1.035, 1.08)", offset: 0.55 },
      { transform: "translateX(-50%) scale(1)" },
    ], { duration: 300, easing: "ease-out" });
  }

  function finishPop(): void {
    pop?.finish();
    pop = undefined;
  }

  /** The card goes back to its place in the thread. */
  function land(): void {
    if (place) {
      restoreClose?.();
      restoreClose = undefined;
      if (card) {
        card.classList.remove("is-floating");
        for (const name of ["--float-top", "--float-left", "--float-width"]) card.style.removeProperty(name);
        watch?.observe(card);
      }
      watch?.unobserve(place);
      place.remove();
      place = null;
    }
    openButton.setAttribute("aria-expanded", "false");
  }

  /** The card stands over the thread centred under the pill, as wide as it was, kept inside the conversation. */
  function lift(): void {
    if (!card || place) return;
    finishPop();
    const box = card.getBoundingClientRect();
    const under = pill.getBoundingClientRect();
    place = document.createElement("div");
    place.className = "card-float-place";
    place.style.height = `${Math.round(box.height)}px`;
    card.before(place);
    watch?.unobserve(card);
    watch?.observe(place);
    card.style.setProperty("--float-top", `${Math.round(under.bottom + 8)}px`);
    const pane = (pill.offsetParent ?? document.documentElement).getBoundingClientRect();
    const edge = 8, centred = (under.left + under.right) / 2 - box.width / 2;
    const left = Math.max(pane.left + edge, Math.min(centred, pane.right - edge - box.width));
    card.style.setProperty("--float-left", `${Math.round(left)}px`);
    card.style.setProperty("--float-width", `${Math.round(box.width)}px`);
    card.classList.add("is-floating");
    const close = card.querySelector<HTMLElement>(CLOSE);
    if (close) {
      const attrs = ["aria-label", "title"].map(name => [name, close.getAttribute(name)] as const);
      for (const [name] of attrs) close.setAttribute(name, t("cardFloat.collapse"));
      restoreClose = () => {
        for (const [name, value] of attrs) {
          if (value === null) close.removeAttribute(name);
          else close.setAttribute(name, value);
        }
      };
    }
    openButton.setAttribute("aria-expanded", "true");
  }

  function draw(): void {
    if (card && away) {
      tint(card);
      if (pill.hidden) { pill.hidden = false; popOnce(card); }
    } else {
      if (!pill.hidden) { finishPop(); pill.hidden = true; }
      land();
    }
    words();
  }

  /** Which card waits now: the newest. A card answered, gone or replaced by a newer one lands and stops being watched. */
  function sync(): void {
    const cards = [...o.thread.querySelectorAll<HTMLElement>(".conversation-card")].filter(waitingCard);
    const next = cards[cards.length - 1] ?? null;
    if (next === card && card?.isConnected) { draw(); return; }
    land();
    if (card) watch?.unobserve(card);
    card = next;
    away = false;
    if (card) watch?.observe(card);
    draw();
  }

  o.thread.addEventListener("click", event => {
    if (!place || !(event.target instanceof Element)) return;
    const close = event.target.closest(".card-close");
    if (!close || close !== card?.querySelector(CLOSE)) return;
    event.preventDefault();
    event.stopPropagation();
    land();
    openButton.focus({ preventScroll: true });
  }, { capture: true });
  openButton.addEventListener("click", () => (place ? land() : lift()));
  backButton.addEventListener("click", () => {
    const target = card;
    land();
    if (!target) return;
    // The thread may be following its bottom: this is navigation of the owner's own, so nothing pulls it back (message-rich.ts).
    releaseRichScroll(o.scroller);
    target.scrollIntoView({ block: "center" });
    target.classList.add("is-flash");
    setTimeout(() => target.classList.remove("is-flash"), FLASH_MS);
  });
  // Escape puts a floating card back, as the window's other layers close (nav-layers.ts).
  bindNavLayer(pill, () => { land(); openButton.focus({ preventScroll: true }); }, { active: () => !!place, restore: () => () => openButton.click() });
  // A window that changes size would leave a floating card where the column was: it lands, and the pill stays.
  window.addEventListener("resize", land);

  let queued = false;
  const later = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };
  new MutationObserver(later).observe(o.thread, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-card-state", "class"] });
  new MutationObserver(() => { if (!pill.hidden) later(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  sync();
  return { sync: later };
}
