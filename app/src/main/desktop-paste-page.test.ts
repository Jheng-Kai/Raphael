// @vitest-environment happy-dom
// The viewer page the core serves into the computer's screen (`BOOTSTRAP` in core/.../computer/viewer.py): while the owner
// holds control, their Ctrl+V is held back and their clipboard, read by the app, is put into the computer before the keys of the
// paste are sent; their copy key tells the app to bring the computer's copy back; files dropped on it go to the app. The page's
// own source is run here against a stand-in for noVNC's RFB.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../../../core/src/raphael_core/computer/viewer.py"), "utf-8");
const script = /BOOTSTRAP = b'''([\s\S]*?)'''/.exec(source)![1];

interface Rfb { viewOnly: boolean; sent: unknown[][]; pasted: string[]; sendKey(...args: unknown[]): void; clipboardPasteFrom(text: string): void; focus(): void; disconnect(): void }
let screen: HTMLElement, canvas: HTMLElement, posted: { type: string; id?: number; files?: File[] }[], rfb: Rfb, seenByNoVnc: KeyboardEvent[], page: { setRfb(value: Rfb): void }, listeners: [string, EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?][];
const parent = { postMessage: (data: { type: string; id?: number }) => { posted.push(data); } };

beforeEach(() => {
  vi.useFakeTimers();
  posted = []; seenByNoVnc = [];
  document.body.innerHTML = '<div id="noVNC_container"><canvas></canvas></div>';
  screen = document.getElementById('noVNC_container')!; canvas = screen.querySelector('canvas')!;
  canvas.addEventListener('keydown', event => { seenByNoVnc.push(event as KeyboardEvent); });
  rfb = { viewOnly: false, sent: [], pasted: [], sendKey(...args) { this.sent.push(args); }, clipboardPasteFrom(text) { this.pasted.push(text); }, focus() {}, disconnect() {} };
  // The page's top-level code, with the window's own listeners kept so each test leaves none behind.
  listeners = [];
  const add = window.addEventListener.bind(window);
  const track = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void => { listeners.push([type, listener, options]); add(type, listener, options); };
  page = new Function("document", "parent", "location", "fetch", "performance", "addEventListener", "setInterval", `${script}\nreturn { setRfb(value) { rfb = value; } };`)(
    document, parent, { host: "127.0.0.1:1" }, () => Promise.reject(new Error("offline")), performance, track, () => 0) as typeof page;
  page.setRfb(rfb);
  posted.length = 0;
});
afterEach(() => { for (const [type, listener, options] of listeners) window.removeEventListener(type, listener, options); vi.useRealTimers(); });

const key = (code: string, name: string, over: KeyboardEventInit = {}, type = "keydown"): KeyboardEvent => {
  const event = new KeyboardEvent(type, { code, key: name, bubbles: true, cancelable: true, ...over });
  canvas.dispatchEvent(event);
  return event;
};
const answer = (id: number | undefined, text: unknown, from: unknown = parent): void => {
  window.dispatchEvent(new MessageEvent("message", { source: from as MessageEventSource, data: { type: "raphael-desktop-paste", id, text } }));
};
const asked = (): { type: string; id?: number }[] => posted.filter(message => message.type === "raphael-desktop-paste-request");

test("while the owner holds control Ctrl+V is held back from the computer and the app is asked for their clipboard", () => {
  key("ControlLeft", "Control", { ctrlKey: true });
  const paste = key("KeyV", "v", { ctrlKey: true });
  expect(paste.defaultPrevented).toBe(true);
  expect(seenByNoVnc.map(event => event.code)).toEqual(["ControlLeft"]);
  expect(asked()).toHaveLength(1);
  expect(rfb.sent).toEqual([]);
});

test("their text is put into the computer first, then the paste's keys follow", () => {
  key("ControlLeft", "Control", { ctrlKey: true });
  key("KeyV", "v", { ctrlKey: true });
  answer(asked()[0].id, "sk-or-v1-0123456789abcdef");
  expect(rfb.pasted).toEqual(["sk-or-v1-0123456789abcdef"]);
  expect(rfb.sent).toEqual([]);
  vi.advanceTimersByTime(100);
  // Their Ctrl is still down in the computer, so only the V is pressed.
  expect(rfb.sent).toEqual([[0x76, "KeyV"]]);
});

test("Ctrl+Shift+V pastes the same way with its shifted key, and a released Ctrl is pressed again for the paste", () => {
  key("KeyV", "V", { ctrlKey: true, shiftKey: true });
  answer(asked()[0].id, "kept text");
  vi.advanceTimersByTime(100);
  expect(rfb.pasted).toEqual(["kept text"]);
  expect(rfb.sent).toEqual([[0xffe3, "ControlLeft", true], [0xffe1, "ShiftLeft", true], [0x56, "KeyV"], [0xffe1, "ShiftLeft", false], [0xffe3, "ControlLeft", false]]);
});

test("on a Mac their Command+V is the paste: the computer is told Ctrl+V, with its Super let go first", () => {
  key("MetaLeft", "Meta", { metaKey: true });
  const paste = key("KeyV", "v", { metaKey: true });
  expect(paste.defaultPrevented).toBe(true);
  expect(asked()).toHaveLength(1);
  answer(asked()[0].id, "from the Mac");
  vi.advanceTimersByTime(100);
  expect(rfb.pasted).toEqual(["from the Mac"]);
  expect(rfb.sent).toEqual([[0xffeb, "MetaLeft", false], [0xffe3, "ControlLeft", true], [0x76, "KeyV"], [0xffe3, "ControlLeft", false]]);
  // Ctrl and Command together are no paste of theirs.
  const both = key("KeyV", "v", { metaKey: true, ctrlKey: true });
  expect(both.defaultPrevented).toBe(false);
});

test("when they only watch, or a member works, Ctrl+V is not held back and nothing is asked", () => {
  rfb.viewOnly = true;
  key("ControlLeft", "Control", { ctrlKey: true });
  const paste = key("KeyV", "v", { ctrlKey: true });
  expect(paste.defaultPrevented).toBe(false);
  expect(seenByNoVnc.map(event => event.code)).toEqual(["ControlLeft", "KeyV"]);
  expect(asked()).toEqual([]);
  // Nor is a key that is not Ctrl+V, or an Alt chord.
  rfb.viewOnly = false;
  expect(key("KeyV", "v").defaultPrevented).toBe(false);
  expect(key("KeyV", "v", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
  expect(key("KeyC", "c", { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(asked()).toEqual([]);
});

test("control that ends before the answer pastes nothing, and an answer is taken once, for the question asked, from the app only", () => {
  key("ControlLeft", "Control", { ctrlKey: true });
  key("KeyV", "v", { ctrlKey: true });
  const id = asked()[0].id!;
  answer(id + 1, "wrong question"); answer(id, "from elsewhere", {});
  expect(rfb.pasted).toEqual([]);
  rfb.viewOnly = true;
  answer(id, "too late");
  vi.advanceTimersByTime(5000);
  expect(rfb.pasted).toEqual([]); expect(rfb.sent).toEqual([]);
  rfb.viewOnly = false;
  answer(id, "again");
  expect(rfb.pasted).toEqual([]);
});

test("an app that says it has no text, or never answers, leaves the paste as it was: the computer's own clipboard", () => {
  key("ControlLeft", "Control", { ctrlKey: true });
  key("KeyV", "v", { ctrlKey: true });
  answer(asked()[0].id, null);
  vi.advanceTimersByTime(100);
  expect(rfb.pasted).toEqual([]); expect(rfb.sent).toEqual([[0x76, "KeyV"]]);
  rfb.sent.length = 0;
  key("KeyV", "v", { ctrlKey: true });
  // The app hands the text to the computer through the core before it answers: the page waits that long for it.
  vi.advanceTimersByTime(3000);
  expect(rfb.sent).toEqual([]);
  vi.advanceTimersByTime(1000);
  expect(rfb.pasted).toEqual([]); expect(rfb.sent).toEqual([[0x76, "KeyV"]]);
});

const copied = (): { type: string }[] => posted.filter(message => message.type === "raphael-desktop-copied");

test("their copy reaches the computer as typed, and a moment later the app is told, once for each press", () => {
  key("ControlLeft", "Control", { ctrlKey: true });
  const copy = key("KeyC", "c", { ctrlKey: true });
  expect(copy.defaultPrevented).toBe(false);
  expect(seenByNoVnc.map(event => event.code)).toEqual(["ControlLeft", "KeyC"]);
  expect(copied()).toEqual([]);
  vi.advanceTimersByTime(250);
  expect(copied()).toHaveLength(1);
  key("KeyC", "c", { ctrlKey: true, repeat: true });
  // A terminal's Ctrl+Shift+C and a cut are copies too.
  key("KeyC", "C", { ctrlKey: true, shiftKey: true });
  key("KeyX", "x", { ctrlKey: true });
  vi.advanceTimersByTime(250);
  expect(copied()).toHaveLength(3);
  expect(rfb.sent).toEqual([]);
});

test("on a Mac their Command+C is told to the computer as Ctrl+C, with its Super let go first", () => {
  key("MetaLeft", "Meta", { metaKey: true });
  const copy = key("KeyC", "c", { metaKey: true });
  expect(copy.defaultPrevented).toBe(true);
  expect(rfb.sent).toEqual([[0xffeb, "MetaLeft", false], [0xffe3, "ControlLeft", true], [0x63, "KeyC"], [0xffe3, "ControlLeft", false]]);
  vi.advanceTimersByTime(250);
  expect(copied()).toHaveLength(1);
});

test("a copy while they only watch, or after control ended within that moment, tells the app nothing", () => {
  rfb.viewOnly = true;
  expect(key("KeyC", "c", { ctrlKey: true }).defaultPrevented).toBe(false);
  vi.advanceTimersByTime(250);
  rfb.viewOnly = false;
  key("KeyC", "c", { ctrlKey: true });
  rfb.viewOnly = true;
  vi.advanceTimersByTime(250);
  expect(copied()).toEqual([]);
});

const drop = (type: string, files: File[], types = ["Files"]): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, types, dropEffect: "none" } });
  window.dispatchEvent(event);
  return event;
};

test("files dropped on the screen go to the app as they are, and a drag of anything else is left alone", () => {
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  expect(drop("dragover", [file]).defaultPrevented).toBe(true);
  expect(drop("dragover", [], ["text/plain"]).defaultPrevented).toBe(false);
  expect(drop("drop", [file]).defaultPrevented).toBe(true);
  const sent = posted.filter(message => message.type === "raphael-desktop-files");
  expect(sent).toHaveLength(1);
  expect(sent[0].files).toEqual([file]);
  drop("drop", []);
  expect(posted.filter(message => message.type === "raphael-desktop-files")).toHaveLength(1);
});

test("one paste at a time: a key held down asks once, and a text over a million characters is not sent", () => {
  key("ControlLeft", "Control", { ctrlKey: true });
  key("KeyV", "v", { ctrlKey: true });
  key("KeyV", "v", { ctrlKey: true, repeat: true });
  key("KeyV", "v", { ctrlKey: true });
  expect(asked()).toHaveLength(1);
  answer(asked()[0].id, "x".repeat(1_000_001));
  vi.advanceTimersByTime(100);
  expect(rfb.pasted).toEqual([]);
});

test("the page never reads a clipboard itself", () => {
  expect(script).not.toMatch(/navigator\.clipboard|readText|execCommand/);
});
