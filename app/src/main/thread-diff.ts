export interface ThreadLine { key: string; html: string; turnId?: number }

const MOVING_FACE = '<span class="slime-surface" data-slime-drawing=';
const FACE_TAG = /<\/?span\b[^>]*>/g;

/**
 * A moving face is not part of its line's content: what it does follows the member's activity by itself (slime.ts
 * `setSlimeState` hands every live face over), so its state, strips and clock, which change with every step a member
 * takes, are left out. Its drawing and member stay: another slime or another member is another line. Without this a step
 * from thinking to working made the line unequal to what is on screen and the whole turn was replaced, its words and
 * cards with it (owner, 2026-11-11: 「它有時候更新字幕…就會閃現，就會亂跳一通，可能文字會突然看不到」).
 */
function withoutMovingFaces(html: string): string {
  let out = "", from = 0, at: number;
  while ((at = html.indexOf(MOVING_FACE, from)) >= 0) {
    FACE_TAG.lastIndex = at;
    let depth = 0, end = -1, tag: RegExpExecArray | null;
    while ((tag = FACE_TAG.exec(html))) {
      depth += tag[0][1] === "/" ? -1 : 1;
      if (depth === 0) { end = FACE_TAG.lastIndex; break; }
    }
    if (end < 0) break;
    out += html.slice(from, at) + `<!--face:${/data-slime-reuse="([^"]+)"/.exec(html.slice(at, at + 400))?.[1] ?? ""}-->`;
    from = end;
  }
  return from ? out + html.slice(from) : html;
}

/**
 * What a line is, for telling whether the one on screen is still it. Face animation timing is sampled on mount, outside
 * the line's content identity, and so is what a face does and says about its member's work: its state and strips (above)
 * and the hover words `setSlimeState` keeps current on every face.
 */
export const threadLineIdentity = (html: string): string => withoutMovingFaces(html)
  .replace(/--slime-(?:delay|since):-?[\d.]+ms;?| data-slime-mounted="[\d.]+"/g, "")
  .replace(/(data-presence-member="\d+") data-tooltip="[^"]*"/g, "$1");

const eventKey = (node: HTMLElement): string => node.dataset.eventGroup !== undefined ? `events:${node.dataset.eventGroup}` : node.dataset.timelineEvent !== undefined ? `event:${node.dataset.timelineEvent}` : node.dataset.handoffGroup !== undefined ? `group:${node.dataset.handoffGroup}` :
  node.dataset.handoff !== undefined ? `task:${node.dataset.handoff}` : `exchange:${node.dataset.exchange}`;
const outerEvents = (node: ParentNode): HTMLDetailsElement[] => [...node.querySelectorAll<HTMLDetailsElement>(".handoff-event, .timeline-event")]
  .filter(event => !event.parentElement?.closest(".handoff-event, .timeline-event"));

function handoffSkeleton(html: string): string {
  const template = document.createElement("template"); template.innerHTML = html;
  for (const event of outerEvents(template.content)) event.replaceWith(document.createComment(eventKey(event)));
  return template.innerHTML;
}

const LIVE_TOOLTIP = /(class="live-presence"[^>]*?) data-tooltip="[^"]*"/g;
const LIVE_LABEL = /(<span class="live-action">)[^<]*/g;

/** A line without its live words. It runs on every draw of a working turn, so it reads the text and never parses it. */
let lastSkeleton = ["", ""];
function liveSkeleton(html: string): string {
  if (html !== lastSkeleton[0]) lastSkeleton = [html, html.replace(LIVE_TOOLTIP, "$1").replace(LIVE_LABEL, "$1")];
  return lastSkeleton[1];
}

function liveWords(html: string): string[] {
  const template = document.createElement("template");
  template.innerHTML = [...html.matchAll(LIVE_LABEL)].map(([label]) => `${label}</span>`).join("");
  return [...template.content.children].map(label => label.textContent ?? "");
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
} = {}): boolean {
  const before = new Map([...thread.children].map(node => [(node as HTMLElement).dataset.key ?? "", node]));
  const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-act][data-focus]")?.dataset.focus;
  const keep = new Set<Element>();
  let at = 0;
  let changed = false;
  for (const line of wanted) {
    // A newly inserted face samples the current phase; an existing face keeps its running clock.
    const identity = threadLineIdentity(line.html);
    let node = before.get(line.key);
    if (!node || drawn.get(node) !== identity) {
      changed = true;
      const previous = node && drawn.get(node);
      if (node && previous && identity.includes('class="live-action"') && liveSkeleton(previous) === liveSkeleton(identity)) {
        const words = liveWords(identity);
        node.querySelectorAll<HTMLElement>(".live-action").forEach((label, index) => {
          const text = words[index] ?? "";
          const presence = label.closest<HTMLElement>(".live-presence")!;
          if (label.textContent !== text) label.textContent = text;
          if (presence.dataset.tooltip !== text) presence.dataset.tooltip = text;
        });
        drawn.set(node, identity);
        keep.add(node);
        const here = thread.children[at++];
        if (here !== node) { thread.insertBefore(node, here ?? null); changed = true; }
        continue;
      }
      const template = document.createElement("template"); template.innerHTML = line.html;
      const made = template.content.firstElementChild as HTMLElement;
      made.dataset.key = line.key;
      for (const control of made.querySelectorAll<HTMLElement>("[data-act]")) control.dataset.focus = `${control.dataset.act}:${control.dataset.task ?? line.key}:${control.closest<HTMLElement>("[data-message]")?.dataset.message ?? ""}:${control.dataset.url ?? ""}`;
      drawn.set(made, identity);
      if (!node && options.arrives?.(line)) made.classList.add("is-new");
      if (node) {
        if (previous && /class="(?:[^"]*\bhandoff-event\b|conversation-event-line timeline-event)/.test(previous) && handoffSkeleton(previous) === handoffSkeleton(identity)) {
          const old = new Map(outerEvents(node).map(event => [eventKey(event), event]));
          for (const event of outerEvents(made)) updateEvent(old.get(eventKey(event))!, event);
          drawn.set(node, identity);
          keep.add(node);
          const here = thread.children[at++];
          if (here !== node) { thread.insertBefore(node, here ?? null); changed = true; }
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
    if (here !== node) { thread.insertBefore(node, here ?? null); changed = true; }
  }
  for (const node of [...thread.children]) if (!keep.has(node)) { node.remove(); changed = true; }
  if (focusKey) {
    const target = thread.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }
  return changed;
}
