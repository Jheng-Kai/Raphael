export interface ThreadLine { key: string; html: string; turnId?: number }

const eventKey = (node: HTMLElement): string => node.dataset.eventGroup !== undefined ? `events:${node.dataset.eventGroup}` : node.dataset.timelineEvent !== undefined ? `event:${node.dataset.timelineEvent}` : node.dataset.handoffGroup !== undefined ? `group:${node.dataset.handoffGroup}` :
  node.dataset.handoff !== undefined ? `task:${node.dataset.handoff}` : `exchange:${node.dataset.exchange}`;
const outerEvents = (node: ParentNode): HTMLDetailsElement[] => [...node.querySelectorAll<HTMLDetailsElement>(".handoff-event, .timeline-event")]
  .filter(event => !event.parentElement?.closest(".handoff-event, .timeline-event"));

function handoffSkeleton(html: string): string {
  const template = document.createElement("template"); template.innerHTML = html;
  for (const event of outerEvents(template.content)) event.replaceWith(document.createComment(eventKey(event)));
  return template.innerHTML;
}

function updateEvent(node: HTMLDetailsElement, made: HTMLDetailsElement): void {
  for (const attr of [...made.attributes]) if (attr.name !== "open" && node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
  const summary = node.querySelector(":scope > summary")!, nextSummary = made.querySelector(":scope > summary")!;
  if (!summary || !nextSummary) {
    if (node.innerHTML !== made.innerHTML) node.innerHTML = made.innerHTML;
    return;
  }
  if (summary.innerHTML !== nextSummary.innerHTML) summary.innerHTML = nextSummary.innerHTML;
  const body = node.querySelector(":scope > .handoff-detail"), nextBody = made.querySelector(":scope > .handoff-detail");
  if (!body || !nextBody) return;
  if (!made.hasAttribute("data-handoff-group") && !made.hasAttribute("data-event-group")) {
    if (body.innerHTML !== nextBody.innerHTML) body.innerHTML = nextBody.innerHTML;
    return;
  }
  const old = new Map([...body.children].map(child => [eventKey(child as HTMLElement), child as HTMLDetailsElement]));
  const keep = new Set<Element>();
  for (const [index, next] of [...nextBody.children].entries()) {
    const child = old.get(eventKey(next as HTMLElement));
    if (child) updateEvent(child, next as HTMLDetailsElement);
    const wanted = child ?? next; keep.add(wanted);
    if (body.children[index] !== wanted) body.insertBefore(wanted, body.children[index] ?? null);
  }
  for (const child of [...body.children]) if (!keep.has(child)) child.remove();
}

function carryHandoffs(before: Element, after: HTMLElement): void {
  const old = new Map([...before.querySelectorAll<HTMLDetailsElement>(".handoff-event, .timeline-event")].map(node => [eventKey(node), node]));
  // Children first: the group then carries those same children, including their open state.
  for (const made of [...after.querySelectorAll<HTMLDetailsElement>(".handoff-event, .timeline-event")].reverse()) {
    const node = old.get(eventKey(made));
    if (!node) continue;
    updateEvent(node, made);
    made.replaceWith(node);
  }
}

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
        const previous = drawn.get(node);
        if (previous && /class="(?:handoff-event|conversation-event-line timeline-event)/.test(previous) && handoffSkeleton(previous) === handoffSkeleton(identity)) {
          const old = new Map(outerEvents(node).map(event => [eventKey(event), event]));
          for (const event of outerEvents(made)) updateEvent(old.get(eventKey(event))!, event);
          drawn.set(node, identity);
          keep.add(node);
          const here = thread.children[at++];
          if (here !== node) thread.insertBefore(node, here ?? null);
          continue;
        }
        carryHandoffs(node, made);
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
