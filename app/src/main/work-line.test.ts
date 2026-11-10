// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { emptyTimelineState, pendingTurnHTML, turnHTML } from "./timeline";
import { patchThread } from "./thread-diff";
import type { AgentTurn } from "./types";

const look = {face: () => '<span class="avatar">Face</span>', activityLabel: "Thinking sample"};
const base: AgentTurn = {id: 71, created_at_ms: 1000, question: "Sample", text: "", prefix: "", route: "answer", source: "app", session_id: "sample", status: "running", detail: null, steps: [], task: null};
const action = (state: string, present = "Reading sample.md") => ({seq: 2, kind: "event" as const, at_ms: 2000, text: JSON.stringify({type: "action", id: "sample", state, present, past: "Read sample.md"})});
const dom = (html: string) => { const root = document.createElement("div"); root.innerHTML = html; return root; };

test("live source order is tool, public progress, activity, and thinking", () => {
  const progress = {seq: 1, kind: "progress" as const, text: "Checking sample", at_ms: 1000};
  for (const [messages, expected] of [[[progress, action("running")], "Reading sample.md"], [[progress, action("done")], "Checking sample"], [[], "Thinking sample"]] as const) {
    const root = dom(turnHTML({...base, messages: [...messages]}, emptyTimelineState(), false, look));
    expect(root.querySelector(".live-action")?.textContent).toBe(expected);
    expect(root.querySelector(".live-presence")?.getAttribute("data-tooltip")).toBe(expected);
  }
  expect(dom(pendingTurnHTML("Sample", "app", {face: look.face})).querySelector(".live-action")?.textContent).toBe("正在思考");
});

test("a live text change retains the thread, avatar, controls, focus and scroll", () => {
  const thread = document.createElement("ol"), drawn = new WeakMap<Element, string>();
  document.body.append(thread);
  const render = (text: string) => patchThread(thread, [{key: "71", html: turnHTML({...base, messages: [action("running", text)]}, emptyTimelineState(), false, look)}], drawn);
  render("Reading sample.md");
  const line = thread.firstElementChild, face = thread.querySelector(".avatar"), controls = thread.querySelector(".message-actions");
  thread.scrollTop = 150;
  const observer = new MutationObserver(() => {}); observer.observe(thread, {subtree: true, attributes: true, childList: true, characterData: true});
  render("Editing sample.md");
  expect(thread.querySelector(".live-action")?.textContent).toBe("Editing sample.md");
  expect(thread.firstElementChild).toBe(line);
  expect(thread.querySelector(".avatar")).toBe(face);
  expect(thread.querySelector(".message-actions")).toBe(controls);
  expect(thread.scrollTop).toBe(150);
  expect(observer.takeRecords().every(record => (record.target as Element).closest?.(".live-presence"))).toBe(true);
  render(`Reading "a&b" <sample>.md`);
  expect(thread.firstElementChild).toBe(line);
  expect(thread.querySelector(".live-action")?.textContent).toBe(`Reading "a&b" <sample>.md`);
  expect(thread.querySelector(".live-presence")?.getAttribute("data-tooltip")).toBe(`Reading "a&b" <sample>.md`);
  observer.disconnect(); thread.remove();
});

test("new progress changes only the live text while work stays folded", () => {
  const thread = document.createElement("ol"), drawn = new WeakMap<Element, string>();
  const messages = [{seq:1,kind:"progress" as const,text:"Checking samples",at_ms:1000}];
  const render = () => patchThread(thread, [{key:"71",html:turnHTML({...base,messages,model:"sample/model"},emptyTimelineState(),false,look)}],drawn);
  render(); const line = thread.firstElementChild, face = thread.querySelector('.avatar');
  messages.push({seq:2,kind:"progress",text:"Comparing samples",at_ms:2000}); render();
  expect(thread.firstElementChild).toBe(line);
  expect(thread.querySelector('.avatar')).toBe(face);
  expect(thread.querySelector('.live-action')?.textContent).toBe("Comparing samples");
  expect(thread.querySelector('.work-body')).toBeNull();
});

test("completed actions are plain sentences and an icon opens them", () => {
  const state = emptyTimelineState(); state.thinkingOpen.set(71, true);
  const root = dom(turnHTML({...base, text: "Sample reply", status: "done", messages: [action("done")], model: "sample/model"}, state, false, look));
  expect(root.querySelector(".work-body")?.textContent).toContain("Read sample.md");
  expect(root.querySelector(".message-work")).toBeNull();
  expect(root.querySelector(".step-mark, .step-ms")).toBeNull();
  expect(root.querySelector(".conversation-event-line")).toBeNull();
});

test("tool actions and public narration escape markup and retain the whole hover", () => {
  const root = dom(turnHTML({...base,messages:[action("running",'Reading <img src=x>.md')]},emptyTimelineState(),false,look));
  expect(root.querySelector('.live-action')?.textContent).toBe('Reading <img src=x>.md');
  expect(root.querySelector('.live-action img')).toBeNull();
  expect(root.querySelector('.live-presence')?.getAttribute('data-tooltip')).toBe('Reading <img src=x>.md');
});

test("an owner card takes over the action line", () => {
  const root = dom(turnHTML({...base,messages:[action("running")]},emptyTimelineState(),false,{...look,waitingForOwner:()=>true}));
  expect(root.querySelector('.live-action')).toBeNull();
});
