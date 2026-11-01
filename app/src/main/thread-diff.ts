export interface ThreadLine { key: string; html: string; turnId?: number }

/** Share line identity across private conversations and rooms. Hooks keep interactive card state with its owner. */
export function patchThread(thread: HTMLElement, wanted: readonly ThreadLine[], drawn: WeakMap<Element, string>, options: {
  arrives?(line: ThreadLine): boolean;
  carry?(before: Element, after: HTMLElement): () => void;
} = {}): void {
  const before = new Map([...thread.children].map(node => [(node as HTMLElement).dataset.key ?? "", node]));
  const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-act][data-focus]")?.dataset.focus;
  const keep = new Set<Element>();
  let at = 0;
  for (const line of wanted) {
    // A newly inserted face samples the current phase; an existing face keeps its running clock.
    const identity = line.html.replace(/style="[^"]*"/g, style => style.replace(/--slime-(?:delay|since):-?[\d.]+ms;?/g, ""));
    let node = before.get(line.key);
    if (!node || drawn.get(node) !== identity) {
      const template = document.createElement("template"); template.innerHTML = line.html;
      const made = template.content.firstElementChild as HTMLElement;
      made.dataset.key = line.key;
      for (const control of made.querySelectorAll<HTMLElement>("[data-act]")) control.dataset.focus = `${control.dataset.act}:${control.dataset.task ?? line.key}:${control.closest<HTMLElement>("[data-message]")?.dataset.message ?? ""}:${control.dataset.url ?? ""}`;
      drawn.set(made, identity);
      if (!node && options.arrives?.(line)) made.classList.add("is-new");
      if (node) {
        const restore = options.carry?.(node, made);
        if (!restore) { node.before(made); node.remove(); }
        else restore();
      }
      node = made;
    }
    keep.add(node);
    const here = thread.children[at++];
    if (here !== node) thread.insertBefore(node, here ?? null);
  }
  for (const node of [...thread.children]) if (!keep.has(node)) node.remove();
  if (focusKey) {
    const target = thread.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }
}
