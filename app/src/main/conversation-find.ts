import { onLocaleChange, t } from "./i18n";
import { describeError } from "./format";
import { esc, ico, iconButton } from "./ui";

export function mountConversationFind(o: { button: HTMLElement; bar: HTMLElement; thread: HTMLElement; scroll: HTMLElement; load(current: () => boolean): Promise<void>; changed?(open: boolean): void }) {
  let opened = false, query = "", index = -1, epoch = 0, complete = false, positioned = false;
  let marks: HTMLElement[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  o.bar.className = "ra-find";
  o.bar.hidden = true;
  o.bar.innerHTML = `<span class="ra-find-ic">${ico("search")}</span><input type="search" class="ra-find-input" maxlength="200" autocomplete="off" spellcheck="false" aria-label="${esc(t("agent.search"))}" placeholder="${esc(t("agent.search"))}">` +
    `<span class="ra-find-count num" role="status" aria-live="polite"></span>` +
    iconButton("up", t("chat.findPrevious"), ' data-find="previous"', "ra-tool") +
    iconButton("down", t("chat.findNext"), ' data-find="next"', "ra-tool") +
    iconButton("x", t("agent.searchClose"), ' data-find="close"', "ra-tool");
  const input = o.bar.querySelector<HTMLInputElement>("input")!, count = o.bar.querySelector<HTMLElement>(".ra-find-count")!;
  onLocaleChange(() => {
    o.button.title = t("agent.search"); o.button.setAttribute("aria-label", t("agent.search"));
    input.placeholder = t("agent.search"); input.setAttribute("aria-label", t("agent.search"));
    for (const [action, label] of [["previous", t("chat.findPrevious")], ["next", t("chat.findNext")], ["close", t("agent.searchClose")]]) {
      const button = o.bar.querySelector<HTMLElement>(`[data-find="${action}"]`)!;
      button.title = label!; button.setAttribute("aria-label", label!);
    }
    if (complete) position();
  });
  function clear(): void {
    for (const mark of o.thread.querySelectorAll('mark[data-find-match]')) mark.replaceWith(...mark.childNodes);
    o.thread.normalize(); marks = [];
  }
  function position(scroll = false): void {
    marks.forEach((mark, at) => { mark.classList.toggle("is-current", at === index); if (at === index) mark.setAttribute("aria-current", "true"); else mark.removeAttribute("aria-current"); });
    count.textContent = !query ? "" : marks.length ? `${index + 1}/${marks.length}` : t("chat.findEmpty");
    for (const button of o.bar.querySelectorAll<HTMLButtonElement>('[data-find="next"], [data-find="previous"]')) button.disabled = !complete || !marks.length;
    if (scroll && marks[index]) {
      const mark = marks[index], message = mark.closest<HTMLElement>('.chat-message');
      // A collapsed owner preview must reveal the exact occurrence being visited.
      message?.classList.add("is-search-expanded");
      mark.scrollIntoView?.({ block: "center", inline: "nearest" });
    }
  }
  function refresh(newest = false): void {
    clear();
    if (!opened || !query || !complete) { if (!query) position(); return; }
    const words = query.toLocaleLowerCase();
    const walker = document.createTreeWalker(o.thread, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text, parent = node.parentElement;
      const hidden = parent?.closest('[hidden]');
      if (parent?.closest('.message-text, .message-code code, .message-table td, .message-table th') && !parent.closest('button, .work-section') && (!hidden || !o.thread.contains(hidden))) nodes.push(node);
    }
    for (const node of nodes) {
      const text = node.data, lower = text.toLocaleLowerCase(), fragment = document.createDocumentFragment();
      let start = 0, at = lower.indexOf(words);
      if (at < 0) continue;
      while (at >= 0) {
        fragment.append(text.slice(start, at));
        const mark = document.createElement('mark'); mark.dataset.findMatch = String(marks.length); mark.textContent = text.slice(at, at + query.length);
        marks.push(mark); fragment.append(mark); start = at + query.length; at = lower.indexOf(words, start);
      }
      fragment.append(text.slice(start)); node.replaceWith(fragment);
    }
    index = newest ? marks.length - 1 : Math.min(Math.max(index, 0), marks.length - 1);
    position(newest);
  }
  async function search(): Promise<void> {
    const mine = ++epoch;
    query = input.value.trim(); complete = false;
    clear();
    if (!query) { complete = true; positioned = false; position(); return; }
    count.textContent = t("settings.loading");
    try {
      await o.load(() => opened && mine === epoch);
      if (!opened || mine !== epoch) return;
      complete = true; refresh(!positioned); if (marks.length) positioned = true;
    } catch (error) {
      if (!opened || mine !== epoch) return;
      count.textContent = describeError(error);
    }
  }
  function open(): void { opened = true; o.changed?.(true); o.bar.hidden = false; o.button.setAttribute('aria-expanded', 'true'); input.focus({preventScroll:true}); }
  function close(focus = true): void {
    const viewport = o.scroll.getBoundingClientRect();
    const anchor = marks[index]?.closest<HTMLElement>('.chat-message') ?? [...o.thread.querySelectorAll<HTMLElement>('.chat-message, .message-text')].find(el => {
      const box = el.getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom;
    });
    const top = anchor?.getBoundingClientRect().top;
    epoch++; clearTimeout(timer); opened = false; positioned = false; query = ""; input.value = ""; clear();
    o.changed?.(false);
    o.bar.hidden = true; o.button.setAttribute('aria-expanded', 'false');
    if (anchor?.isConnected && top !== undefined) o.scroll.scrollTop += anchor.getBoundingClientRect().top - top;
    if (focus) o.button.focus({preventScroll:true});
  }
  function move(delta: number): void { if (complete && marks.length) { index = (index + delta + marks.length) % marks.length; position(true); } }
  o.button.addEventListener('click', () => opened ? close() : open());
  o.bar.addEventListener('click', event => {
    const action = (event.target as Element).closest<HTMLElement>('[data-find]')?.dataset.find;
    if (action === 'close') close(); else if (action) move(action === 'previous' ? -1 : 1);
  });
  input.addEventListener('input', () => { epoch++; complete = false; clearTimeout(timer); count.textContent = input.value.trim() ? t("settings.loading") : ""; positionButtons(); timer = setTimeout(() => void search(), 200); });
  function positionButtons(): void { for (const button of o.bar.querySelectorAll<HTMLButtonElement>('[data-find="next"], [data-find="previous"]')) button.disabled = true; }
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
  });
  return { open, close, refresh: () => refresh(), isOpen: () => opened };
}
