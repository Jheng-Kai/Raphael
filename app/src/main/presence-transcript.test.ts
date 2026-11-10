// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { slimeFaceHTML, slimeSVG, followSlimeRoster } from "./slime";
import { emptyTimelineState, pendingTurnHTML, turnHTML } from "./timeline";
import { threadItems, turnMatches, highlightHTML } from "./conversation";
import { messagePlainText } from "./message-content";
import { mountConversationFind } from "./conversation-find";
import { memberRowHTML } from "./member-column";
import { messageTooltip } from "./message-tooltip";
import { faceHTML, RAPHAEL_ID } from "./members";
import { patchThread } from "./thread-diff";

test("a changing slime mount timestamp does not rebuild the same live turn", () => {
  const thread = document.createElement("ol"), drawn = new WeakMap<Element,string>();
  const line = (time: number) => ({key:"sample", html:`<li><svg class="slime" data-slime-mounted="${time}"></svg><span>Working</span></li>`});
  expect(patchThread(thread, [line(10)], drawn)).toBe(true);
  const node = thread.firstElementChild;
  expect(patchThread(thread, [line(20.5)], drawn)).toBe(false);
  expect(thread.firstElementChild).toBe(node);
});
import type { AgentTurn, Member } from "./types";

const time = Date.UTC(2026, 10, 2, 9);
const turn = (more: Partial<AgentTurn> = {}): AgentTurn => ({ id: 51, created_at_ms: time, question: "A sample request", text: "A sample reply", prefix: "", route: "answer", source: "app", session_id: "sample", status: "done", detail: null, steps: [], task: null, ...more });
const look = { face: () => '<i class="sample-face"></i>' };
const dom = (html: string) => { const root = document.createElement("div"); root.innerHTML = html; return root; };
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test.each(["routine", "calendar", "meeting", "skill_learned"])("%s receipts expose words to find, highlight and copy", type => {
  const text = JSON.stringify({type, action: "created", id: 987654321, room_id: 876543219, name: "Sample orchard", text: "已建立 · Sample orchard"});
  const sample = turn({question: "", text: "", messages: [{seq: 1, kind: "event", text, at_ms: time}]});
  for (const query of [type, "created", "987654321", "876543219"]) expect(turnMatches(sample, query)).toBe(false);
  expect(turnMatches(sample, "orchard")).toBe(true);
  expect(messagePlainText(text)).toBe("已建立 · Sample orchard");
  expect(messagePlainText(text, true)).toBe("已建立 · Sample orchard");
  expect(highlightHTML(text, "orchard")).toBe("已建立 · Sample <mark>orchard</mark>");
  const rendered = dom(turnHTML(sample, emptyTimelineState(), false, look));
  expect(rendered.textContent).toContain("Sample orchard");
  expect(rendered.textContent).not.toContain('987654321');
  expect(rendered.textContent).not.toContain('"type"');
});

test("conversation find visits the visible title in an event button", async () => {
  document.body.innerHTML = '<button id="find"></button><aside></aside><main></main>';
  const thread = document.querySelector('main')!;
  thread.innerHTML = turnHTML(turn({messages: [{seq: 1, kind: "event", text: JSON.stringify({type: "routine", action: "created", id: 987654321, name: "Sample orchard"}), at_ms: time}]}), emptyTimelineState(), false, look);
  const find = mountConversationFind({button: document.querySelector('#find')!, bar: document.querySelector('aside')!, thread, scroll: thread, load: async () => {}});
  find.open();
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value = 'orchard'; input.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(thread.querySelector('.event-line mark')?.textContent).toBe('orchard'));
  const observer = new MutationObserver(() => {});
  observer.observe(thread, {subtree: true, childList: true, attributes: true, characterData: true});
  find.refresh();
  expect(observer.takeRecords()).toHaveLength(0);
  observer.disconnect();
  input.value = '987654321'; input.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(document.querySelector('.ra-find-count')?.textContent).not.toContain('/'));
  await vi.waitFor(() => expect(thread.querySelector('mark')).toBeNull());
  find.close();
});

test("ordinary JSON requested by the owner remains copyable", () => {
  expect(messagePlainText('{"sample": 1}')).toBe('{"sample": 1}');
});

test("finding a receipt inside a closed group reveals the selected line", async () => {
  document.body.innerHTML = '<button id="find"></button><aside></aside><main></main>';
  const thread = document.querySelector('main')!;
  thread.innerHTML = turnHTML(turn({messages: [1, 2].map(seq => ({seq, kind: "event", text: JSON.stringify({type: "routine", action: "created", id: seq, name: "Sample orchard"}), at_ms: time}))}), emptyTimelineState(), false, look);
  const group = thread.querySelector<HTMLDetailsElement>('[data-event-group]')!;
  const find = mountConversationFind({button: document.querySelector('#find')!, bar: document.querySelector('aside')!, thread, scroll: thread, load: async () => {}});
  find.open();
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value = 'orchard'; input.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(group.querySelector('.handoff-detail mark.is-current')).not.toBeNull());
  expect(group.open).toBe(true);
  find.close();
});

test("thinking, blocked and working keep their own-colour slime and liquid props", () => {
  for (const state of ["thinking", "blocked", "working"] as const) {
    const root = dom(slimeSVG({ color: "teal" }, { state }));
    expect(root.querySelector(".slime-body")).not.toBeNull();
    expect(root.querySelector(".slime-drop")).toBeNull();
    expect(root.querySelector(".slime-dots, .slime-blocked, .slime-ribbons")).toBeNull();
    expect(root.querySelector(".slime")?.getAttribute("style")).toContain("--slime-color:#13B8A3");
  }
});

test("owner waiting overrides running while colleague waiting remains a separate state", () => {
  followSlimeRoster([{ id: 91, activity: "working" }]);
  expect(dom(slimeFaceHTML({ id: 91, waiting: true }, 28, "", true)).querySelector(".slime")?.getAttribute("data-state")).toBe("blocked");
  followSlimeRoster([{ id: 92, activity: "waiting" }]);
  expect(dom(slimeFaceHTML({ id: 92 }, 28, "", true)).querySelector(".slime")?.getAttribute("data-state")).toBe("waiting");
});

test("private bubbles have no faces and completed work opens from the message hover actions", () => {
  const root = dom(turnHTML(turn({ messages: [{seq: 1, kind: "progress", text: "Checking a sample", at_ms: time}], model: "sample/model", cost_usd: .001 }), emptyTimelineState(), false, look));
  expect(root.querySelector(".ra-face, .me > .owner-face, .me > .av")).toBeNull();
  expect(root.querySelector(".work-section > .work-toggle")).toBeNull();
  expect(root.querySelector('.message-actions [data-act="thinking"]')).toBeNull();
});

test("live and pending private work shows only a 28px avatar with the public progress tooltip", () => {
  const root = dom(turnHTML(turn({ status: "running", text: "", messages: [{seq: 1, kind: "progress", text: "Checking a sample", at_ms: time}] }), emptyTimelineState(), false, look));
  expect(root.querySelector(".live-presence[data-tooltip='Checking a sample']")).not.toBeNull();
  expect(root.querySelector(".think, .work-time, .work-latest, .ra-face")).toBeNull();
  expect(dom(pendingTurnHTML("Sample", "app", look, [], { time })).querySelector(".live-presence")).not.toBeNull();
});

test("time separators appear once per calendar day despite thirty-minute gaps", () => {
  const items = threadItems([turn(), turn({id: 52, created_at_ms: time + 60_000}), turn({id: 53, created_at_ms: time + 31 * 60_000})], time);
  expect(items.filter(item => item.kind === "day")).toHaveLength(1);
  expect(items.filter(item => item.kind === "day").every(item => item.key.startsWith("time:"))).toBe(true);
});

test("routine events stay inside closed work detail with their targets and grouped receipts", () => {
  const messages = [1,2].map(seq => ({ seq, kind: "event" as const, text: JSON.stringify({type: "routine", action: "created", id: seq, name: `Sample ${seq}`}), at_ms: time }));
  const html = turnHTML(turn({messages}), emptyTimelineState(), false, look), root = dom(html);
  expect(root.querySelector("[data-event-group]")).not.toBeNull();
  expect(root.querySelectorAll('[data-act="open-routine"]')).toHaveLength(2);
  expect(root.querySelector('.work-body[hidden] [data-event-group]')).not.toBeNull();
  expect(root.querySelector(".work-body .turn-event")).toBeNull();
  const thread = document.createElement("ol"), drawn = new WeakMap<Element,string>();
  const patch = (value: string) => patchThread(thread, [{key: "sample", html: value}], drawn);
  patch(html);
  const group = thread.querySelector<HTMLDetailsElement>("[data-event-group]")!; group.open = true;
  patch(turnHTML(turn({messages: [...messages, {...messages[1], seq: 3}]}), emptyTimelineState(), false, look));
  expect(thread.querySelector("[data-event-group]")).toBe(group);
  expect(group.open).toBe(true);
  const observer = new MutationObserver(() => {}); observer.observe(thread, {subtree: true, childList: true, attributes: true});
  patch(turnHTML(turn({messages: [...messages, {...messages[1], seq: 3}]}), emptyTimelineState(), false, look));
  expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
});

test("a routine receipt preserves the member who owns its inspection target", () => {
  const messages = [{seq: 1, kind: "event" as const, text: JSON.stringify({type: "routine", action: "created", id: 9, member_id: 4, name: "Sample routine"}), at_ms: time}];
  const root = dom(turnHTML(turn({messages}), emptyTimelineState(), false, look));
  expect(root.querySelector('[data-routine="9"]')?.getAttribute("data-routine-member")).toBe("4");
});

test("a sidebar row keeps the name and its last line, without a role pill or a time, as Grok Bot's", () => {
  const root = dom(memberRowHTML({id: 1, name: "Sample", role: "Research", last_at: time} as Member, {current: 1, previews: new Map(), fresh: new Set()}));
  expect(root.querySelector(".mb-row-t i")).toBeNull();
  expect(root.querySelector("time")).toBeNull();
});

test("an open shared hover updates its public action without pointer movement", async () => {
  const root = dom('<span data-tooltip="Checking">Face</span>'); document.body.append(root); messageTooltip(root);
  const face = root.querySelector<HTMLElement>("span")!;
  face.dispatchEvent(new Event("pointerover", {bubbles: true}));
  face.dataset.tooltip = "Waiting for a colleague";
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(root.querySelector('[role="tooltip"]')?.textContent).toBe("Waiting for a colleague");
});


test("Raphael's blue slime shares the public action hover and moves with his work", () => {
  followSlimeRoster([{id: RAPHAEL_ID, activity: "thinking", activity_label: "Checking a sample"}]);
  const root = dom(faceHTML({id: RAPHAEL_ID, name: "Raphael"}, 28, {moving: true}));
  expect(root.querySelector(`[data-presence-member="${RAPHAEL_ID}"]`)?.getAttribute("data-tooltip")).toBe("Checking a sample");
  expect(root.querySelector(".slime")?.getAttribute("data-state")).toBe("thinking");
  // Elsewhere his slime is a picture that keeps the hover (owner, 2026-11-11).
  const picture = dom(faceHTML({id: RAPHAEL_ID, name: "Raphael"}, 28));
  expect(picture.querySelector(`[data-presence-member="${RAPHAEL_ID}"]`)?.getAttribute("data-tooltip")).toBe("Checking a sample");
  expect(picture.querySelector(".slime")?.getAttribute("data-state")).toBe("idle");
});

test("a blocked task keeps its live presence until the owner acts", () => {
  const root = dom(turnHTML(turn({task: {id: 1, state: "waiting"} as AgentTurn["task"]}), emptyTimelineState(), false, look));
  expect(root.querySelector(".live-presence")).not.toBeNull();
});


test("event groups count every receipt and name each target once, up to three", () => {
  const messages = [1,1,2,3,4].map((id, index) => ({seq: index + 1, kind: "event" as const, text: JSON.stringify({type: "routine", action: "created", id, name: `Sample ${id}`}), at_ms: time}));
  const root = dom(turnHTML(turn({messages}), emptyTimelineState(), false, look));
  const summary = root.querySelector("[data-event-group] > summary")!;
  expect(summary.textContent).toContain("5");
  expect(summary.textContent?.match(/Sample 1/g)).toHaveLength(1);
  expect(summary.textContent).toContain("Sample 2");
  expect(summary.textContent).toContain("Sample 3");
  expect(summary.textContent).not.toContain("Sample 4");
  expect(root.querySelectorAll("[data-timeline-event]")).toHaveLength(5);
});


test("a public progress hover takes precedence over the generic avatar action", () => {
  const root = dom(turnHTML(turn({status: "running", text: "", messages: [{seq: 1, kind: "progress", text: "Checking the sample sources", at_ms: time}]}), emptyTimelineState(), false, {...look, liveFace: () => '<span data-presence-member="1" data-tooltip="Working">Face</span>'}));
  expect(root.querySelector(".live-presence [data-tooltip]")).toBeNull();
  expect(root.querySelector(".live-presence")?.getAttribute("data-tooltip")).toBe("Checking the sample sources");
});


test("the thread diff reports no change for identical lines and a change for insert, text, order and removal", () => {
  const thread = document.createElement("ol"), drawn = new WeakMap<Element, string>();
  const first = {key: "a", html: "<li>First</li>"}, second = {key: "b", html: "<li>Second</li>"};
  expect(patchThread(thread, [first, second], drawn)).toBe(true);
  const node = thread.firstElementChild;
  expect(patchThread(thread, [first, second], drawn)).toBe(false);
  expect(thread.firstElementChild).toBe(node);
  expect(patchThread(thread, [second, first], drawn)).toBe(true);
  expect(patchThread(thread, [{...second, html: "<li>Edited</li>"}, first], drawn)).toBe(true);
  expect(patchThread(thread, [first], drawn)).toBe(true);
  expect(patchThread(thread, [first], drawn)).toBe(false);
});
