// A card that waits for the owner and has been scrolled out of sight floats. A small pill at the top of the conversation
// names it; a press opens the card itself over the thread, where its fields and buttons work as they do in place (it stays
// in the thread and only stands fixed, its place kept by a spacer); 回到原位 scrolls back to where it was born. Back in sight,
// or answered, the pill goes away.

import { t } from "./i18n";
import { releaseRichScroll } from "./message-rich";
import { bindNavLayer } from "./nav-layers";
import { ico } from "./ui";

/** A card waits for the owner: its own status pill says so, or it is an owner question still asked. */
export const waitingCard = (card: HTMLElement): boolean =>
  card.dataset.cardState === "asked" || card.querySelector(".card-head .card-status.is-waiting")?.closest(".conversation-card") === card;

const FLASH_MS = 1200;

export function mountCardFloat(o: { stage: HTMLElement; scroller: HTMLElement; thread: HTMLElement }): { sync(): void } {
  const pill = document.createElement("div");
  pill.className = "card-float";
  pill.hidden = true;
  pill.innerHTML =
    `<button type="button" class="btn card-float-open" aria-expanded="false"><span class="card-float-dot" aria-hidden="true"></span>` +
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
  const watch = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => { away = !entries[entries.length - 1]!.isIntersecting; draw(); }, { root: o.scroller })
    : null;

  function words(): void {
    const back = t("cardFloat.back");
    if (backButton.getAttribute("aria-label") !== back) { backButton.setAttribute("aria-label", back); backButton.title = back; }
    const name = card?.querySelector(".card-title")?.textContent?.trim() ?? "";
    if (title.textContent !== name) title.textContent = name;
  }

  /** The card goes back to its place in the thread. */
  function land(): void {
    if (place) {
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

  /** The card stands over the thread under the pill, where it was across and as wide as it was. */
  function lift(): void {
    if (!card || place) return;
    const box = card.getBoundingClientRect();
    const under = pill.getBoundingClientRect();
    place = document.createElement("div");
    place.className = "card-float-place";
    place.style.height = `${Math.round(box.height)}px`;
    card.before(place);
    watch?.unobserve(card);
    watch?.observe(place);
    card.style.setProperty("--float-top", `${Math.round(under.bottom + 8)}px`);
    card.style.setProperty("--float-left", `${Math.round(box.left)}px`);
    card.style.setProperty("--float-width", `${Math.round(box.width)}px`);
    card.classList.add("is-floating");
    openButton.setAttribute("aria-expanded", "true");
  }

  function draw(): void {
    const show = !!card && away;
    if (pill.hidden === show) pill.hidden = !show;
    if (!show) land();
    words();
  }

  /** Which card waits now: the newest. A card answered, gone or replaced by a newer one lands and stops being watched. */
  function sync(): void {
    const cards = [...o.thread.querySelectorAll<HTMLElement>(".conversation-card")].filter(waitingCard);
    const next = cards[cards.length - 1] ?? null;
    if (next === card && card?.isConnected) { words(); return; }
    land();
    if (card) watch?.unobserve(card);
    card = next;
    away = false;
    if (card) watch?.observe(card);
    draw();
  }

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
  bindNavLayer(pill, () => { land(); openButton.focus({ preventScroll: true }); }, { active: () => !!place });
  // A window that changes size would leave a floating card where the column was: it lands, and the pill stays.
  window.addEventListener("resize", land);

  let queued = false;
  const later = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };
  new MutationObserver(later).observe(o.thread, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-card-state", "class"] });
  sync();
  return { sync: later };
}
