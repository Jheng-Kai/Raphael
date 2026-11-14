import { onLocaleChange, t } from "./i18n";
import { describeError } from "./format";
import { esc, ico, iconButton } from "./ui";

export function mountConversationFind(o: { button: HTMLElement; bar: HTMLElement; thread: HTMLElement; scroll: HTMLElement; load(current: () => boolean): Promise<void>; changed?(open: boolean): void;
  records?(): { key: string; texts: string[] }[] | undefined; reveal?(key: string): void; revealWork?(id: number): void;
}) {
  let opened = false, query = "", index = -1, epoch = 0, complete = false, positioned = false;
  let marks: HTMLElement[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  let results: { key: string; occurrence: number }[] | undefined, resultIndex = -1, mounting = false;
  let painted: {query: string; text: string | null; marks: HTMLElement[]} | undefined;
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
    painted = undefined;
    for (const mark of o.thread.querySelectorAll('mark[data-find-match]')) mark.replaceWith(...mark.childNodes);
    o.thread.normalize(); marks = [];
  }
  function position(scroll = false): void {
    if (results) {
      const target = results[resultIndex];
      // A turn that owner messages joined is drawn in several lines (`turn:<id>:after:<message>`, conversation.ts threadItems).
      const matching = target ? marks.filter(mark => mark.closest<HTMLElement>("[data-key]")?.dataset.key?.replace(/:after:\d+$/, "") === target.key) : [];
      index = matching.length ? marks.indexOf(matching[Math.min(target!.occurrence, matching.length - 1)]!) : -1;
    }
    marks.forEach((mark, at) => { mark.classList.toggle("is-current", at === index); if (at === index) mark.setAttribute("aria-current", "true"); else mark.removeAttribute("aria-current"); });
    const total = results?.length ?? marks.length, current = results ? resultIndex : index;
    count.textContent = !query ? "" : total ? `${current + 1}/${total}` : t("chat.findEmpty");
    for (const button of o.bar.querySelectorAll<HTMLButtonElement>('[data-find="next"], [data-find="previous"]')) button.disabled = !complete || !total;
    if (scroll && marks[index]) {
      const mark = marks[index], message = mark.closest<HTMLElement>('.chat-message, .timeline-event, .event-group');
      const work = mark.closest<HTMLElement>('.work-body');
      if (work?.hidden) {
        const section = work.closest<HTMLElement>('[data-thinking-turn]')!;
        o.revealWork?.(Number(section.dataset.thinkingTurn));
        work.hidden = false; section.classList.add('is-open');
      }
      for (let group = mark.closest('details'); group; group = group.parentElement?.closest('details') ?? null) {
        if (!group.open && !group.querySelector(':scope > summary')?.contains(mark)) group.open = true;
      }
      // A collapsed owner preview must reveal the exact occurrence being visited.
      message?.classList.add("is-search-expanded");
      mark.scrollIntoView?.({ block: "center", inline: "nearest" });
    }
  }
  function refresh(newest = false): void {
    if (mounting) return;
    if (opened && complete && painted?.query === query && painted.text === o.thread.textContent && painted.marks.every(mark => o.thread.contains(mark))) return;
    clear();
    if (!opened || !query || !complete) { if (!query) position(); return; }
    const words = query.toLocaleLowerCase();
    const walker = document.createTreeWalker(o.thread, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text, parent = node.parentElement;
      const hidden = parent?.closest('[hidden]');
      const event = parent?.closest('.event-line');
      if (parent?.closest('.message-text, .message-code code, .message-table td, .message-table th, .event-line') && (!parent.closest('button, .work-section') || event) && (!hidden || !o.thread.contains(hidden) || event && hidden.classList.contains('work-body'))) nodes.push(node);
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
    painted = {query, text: o.thread.textContent, marks: [...marks]};
  }
  async function search(): Promise<void> {
    const mine = ++epoch;
    query = input.value.trim(); complete = false; results = undefined;
    clear();
    if (!query) { complete = true; positioned = false; position(); return; }
    count.textContent = t("settings.loading");
    try {
      await o.load(() => opened && mine === epoch);
      if (!opened || mine !== epoch) return;
      const records = o.records?.();
      if (records) {
        const needle = query.toLocaleLowerCase();
        results = records.flatMap(record => {
          let occurrence = 0;
          return record.texts.flatMap(text => {
            const matches = [], words = text.toLocaleLowerCase();
            for (let at = words.indexOf(needle); at >= 0; at = words.indexOf(needle, at + needle.length)) matches.push({ key: record.key, occurrence: occurrence++ });
            return matches;
          });
        });
        resultIndex = results.length - 1;
        revealResult();
      }
      complete = true; refresh(!positioned); if (marks.length) positioned = true;
    } catch (error) {
      if (!opened || mine !== epoch) return;
      count.textContent = describeError(error);
    }
  }
  function open(): void { opened = true; o.changed?.(true); o.bar.hidden = false; o.button.setAttribute('aria-expanded', 'true'); input.focus({preventScroll:true}); }
  function close(focus = true): void {
    const viewport = o.scroll.getBoundingClientRect();
    const anchor = marks[index]?.closest<HTMLElement>('.chat-message, .timeline-event, .event-group') ?? [...o.thread.querySelectorAll<HTMLElement>('.chat-message, .message-text')].find(el => {
      const box = el.getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom;
    });
    const top = anchor?.getBoundingClientRect().top;
    epoch++; clearTimeout(timer); opened = false; positioned = false; query = ""; input.value = ""; results = undefined; clear();
    o.changed?.(false);
    o.bar.hidden = true; o.button.setAttribute('aria-expanded', 'false');
    if (anchor?.isConnected && top !== undefined) o.scroll.scrollTop += anchor.getBoundingClientRect().top - top;
    if (focus) o.button.focus({preventScroll:true});
  }
  function revealResult(): void {
    const target = results?.[resultIndex];
    if (!target) return;
    mounting = true;
    try { o.reveal?.(target.key); } finally { mounting = false; }
  }
  function move(delta: number): void {
    if (!complete) return;
    if (results?.length) {
      resultIndex = (resultIndex + delta + results.length) % results.length;
      revealResult(); refresh(); position(true);
    } else if (marks.length) { index = (index + delta + marks.length) % marks.length; position(true); }
  }
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
