let typing = false;
let listening = false;

/** The dictation pages keep their tooltips; everywhere else a tip that only repeats is left out. */
const KEEPS_ECHOES = ".page-dictation, .page-dict";
const words = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Whether `tip` only repeats what `element` already shows.
 * The rendered text counts, so a name hidden in the folded sidebar still gets its tip; an icon has no text to repeat.
 */
export function echoesItsText(element: HTMLElement, tip: string): boolean {
  const said = words(tip);
  if (!said || element.closest(KEEPS_ECHOES)) return false;
  const shown = words(element.innerText ?? element.textContent ?? "");
  return shown.length > 0 && shown.includes(said);
}

/**
 * The browser's own tooltip (`title`) waits for a long hover and then repeats the same words: under the pointer, a title
 * that only repeats the element's text is taken away before it can show.
 */
export function dropEchoTitles(root: Document | HTMLElement = document): void {
  root.addEventListener("pointerover", event => {
    const element = (event.target as Element | null)?.closest?.<HTMLElement>("[title]");
    const title = element?.getAttribute("title");
    if (element && title && echoesItsText(element, title)) element.removeAttribute("title");
  }, true);
}

/** One app tooltip shared by the message actions and composer controls. */
export function messageTooltip(host: HTMLElement): () => void {
  if (!listening) {
    listening = true;
    // A composer key does not bubble through its sibling sidebar. Hide visible tips once,
    // and ignore pointer retargeting caused by animation until the pointer really moves.
    document.addEventListener("keydown", event => {
      if (typing || !(event.target instanceof Element) || !event.target.closest('input, textarea, [contenteditable="true"]')) return;
      typing = true;
      document.querySelectorAll('.message-tooltip:not([hidden])').forEach(tip => tip.dispatchEvent(new Event("tooltip-typing")));
    }, true);
    document.addEventListener("pointermove", event => {
      if (event.movementX || event.movementY) typing = false;
    }, true);
  }
  const tip = document.createElement("div");
  tip.className = "message-tooltip";
  tip.id = `message-tip-${crypto.randomUUID()}`;
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  host.append(tip);
  let target: HTMLElement | null = null;
  const wordsFor = (): string => {
    if (!target) return "";
    const row = document.documentElement.hasAttribute("data-sidebar-collapsed") ? target.closest<HTMLElement>(".mb-row") : null;
    const name = row?.querySelector("b")?.textContent ?? "";
    const action = row?.querySelector<HTMLElement>("[data-presence-member]")?.dataset.tooltip ?? target.dataset.tooltip ?? "";
    return row && name ? [name, action === name ? "" : action].filter(Boolean).join("\n") : action;
  };
  const observer = new MutationObserver(() => {
    if (!target) return;
    const words = wordsFor();
    if (!words || !target.isConnected || echoesItsText(target, words)) { hide(); return; }
    if (tip.textContent !== words) { tip.textContent = words; place(); }
  });
  const place = (): void => {
    if (!target) return;
    const box = target.getBoundingClientRect(), size = tip.getBoundingClientRect();
    const chrome = document.querySelector(".window-chrome")?.getBoundingClientRect().bottom ?? 32;
    const above = box.top - size.height - 6;
    const below = target.closest(".mb-head") || above < chrome + 8;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - size.width - 8, box.left + (box.width - size.width) / 2))}px`;
    tip.style.top = `${Math.max(chrome + 8, Math.min(window.innerHeight - size.height - 8, below ? box.bottom + 6 : above))}px`;
  };
  const hide = (): void => {
    if (!target && tip.hidden) return;
    observer.disconnect();
    target?.removeAttribute("aria-describedby");
    target = null;
    tip.hidden = true;
  };
  const show = (event: Event): void => {
    if (event.type === "focusin") typing = false;
    else if (typing) return;
    const button = (event.target as Element).closest<HTMLElement>("[data-tooltip]");
    if (button === target) return;
    hide();
    if (!button || !button.dataset.tooltip || !host.contains(button) || button.dataset.cancelArmed === "true") return;
    const said = (() => { target = button; const value = wordsFor(); target = null; return value; })();
    if (echoesItsText(button, said)) return;
    target = button;
    tip.textContent = said;
    tip.hidden = false;
    button.setAttribute("aria-describedby", tip.id);
    place();
    observer.observe(button.closest(".mb-row") ?? button, {subtree: true, attributes: true, attributeFilter: ["data-tooltip"]});
  };
  host.addEventListener("pointerover", show);
  host.addEventListener("pointermove", event => {
    if (event.movementX || event.movementY) show(event);
  });
  tip.addEventListener("tooltip-typing", hide);
  host.addEventListener("focusin", show);
  host.addEventListener("pointerout", event => {
    if (target?.contains(event.relatedTarget as Node | null)) return;
    hide();
  });
  host.addEventListener("focusout", hide);
  host.addEventListener("scroll", hide, true);
  host.addEventListener("keydown", hide);
  return hide;
}
