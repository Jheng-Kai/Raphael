// @vitest-environment happy-dom
// A model writes a markdown link to a file it delivered, by stored id: `[words](attachment:<id>)` (R-MSG-LINK-01).
import { expect, test } from "vitest";
import { attachmentTarget, messageHTML, replyContentHTML } from "./message-content";
import { emptyTimelineState, fileLinks, knownFiles, turnHTML } from "./timeline";
import type { AgentTurn } from "./types";

const ID = "4e43d6d3fd9d47fab8b552f849c3c48b.md";
const OTHER = "0123456789abcdef0123456789abcdef.md";
const files = new Map([[ID, { name: "2026-11-14-notion-sync-partial.md" }]]);
const dom = (html: string): HTMLElement => { const root = document.createElement("div"); root.innerHTML = html; return root; };
const turn = (more: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 5, created_at_ms: 1000, question: "Sync", text: "", prefix: "", route: "answer", source: "app", session_id: "sample", status: "done",
  detail: null, steps: [], task: null, ...more,
});
const media = (id: string) => ({ seq: 1, kind: "media" as const, at_ms: 1000, text: JSON.stringify({ attachment: { id, name: "report.md", mime: "text/markdown", size: 12_000 } }) });
const reply = (text: string, seq = 2) => ({ seq, kind: "reply" as const, at_ms: 2000, text });
const look = { face: () => "<i></i>" };

test("only the stored ids of the two link forms are read", () => {
  expect(attachmentTarget(`attachment:${ID}`)).toBe(ID);
  expect(attachmentTarget(`attachment:attachments/${ID}`)).toBe(ID);
  expect(attachmentTarget(`attachments/${ID}`)).toBe(ID);
  for (const target of [ID, `attachment:../${ID}`, `attachment:C:\\Users\\sample\\${ID}`, "attachment:/etc/passwd", `attachment:${ID}/../x`, "attachment:abc.md", `attachment:${ID}?x=1`, `file:${ID}`])
    expect(attachmentTarget(target), target).toBeNull();
});

test("a link to a file of the conversation is its chip, opened by its id", () => {
  const root = dom(messageHTML(`The partial record: [已查核的部分紀錄](attachment:${ID}).`, "", true, [], files));
  const chip = root.querySelector<HTMLElement>("button[data-attachment-link]")!;
  expect(chip.dataset.act).toBe("attachment-open");
  expect(chip.dataset.id).toBe(ID);
  expect(chip.textContent).toBe("已查核的部分紀錄");
  expect(root.textContent).toBe("The partial record: 已查核的部分紀錄.");
  expect(root.innerHTML).not.toContain("attachment:");
});

test("a link without words is the file's own name", () => {
  const chip = dom(messageHTML(`[](attachment:${ID})`, "", true, [], files)).querySelector("button[data-attachment-link]")!;
  expect(chip.textContent).toBe("2026-11-14-notion-sync-partial.md");
});

test("a link to a file the conversation does not know is its words alone", () => {
  for (const target of [`attachment:${OTHER}`, `attachments/${OTHER}`, `attachment:${ID.toUpperCase()}`, "attachment:../../secret.md", "attachment:C:\\Windows\\win.ini", "attachment:/etc/passwd", "attachment:"]) {
    const root = dom(messageHTML(`See [the record](${target}) now`, "", true, [], files));
    expect(root.textContent, target).toBe("See the record now");
    expect(root.querySelector("button, a, [data-id], [data-act]"), target).toBeNull();
    expect(root.innerHTML, target).not.toContain("attachment");
  }
});

test("where nothing is known, the words stand alone and no raw target shows", () => {
  const root = dom(messageHTML(`[已查核的部分紀錄](attachment:${ID})`, "", true));
  expect(root.textContent).toBe("已查核的部分紀錄");
  expect(root.querySelector("button, a, [data-id]")).toBeNull();
  expect(dom(messageHTML(`[](attachment:${ID})`, "", true)).textContent).toBe("");
});

test("links in lists, headings and emphasis open the same way", () => {
  const root = dom(messageHTML(`# [Head](attachment:${ID})\n\n- **[Bold](attachment:${ID})**\n- [Plain](attachment:${OTHER})`, "", true, [], files));
  expect([...root.querySelectorAll("button[data-attachment-link]")].map(chip => chip.textContent)).toEqual(["Head", "Bold"]);
  expect(root.textContent).toContain("Plain");
  expect(root.innerHTML).not.toContain("attachment:");
});

test("a reply that was drawn before the file was known is drawn again once it is", () => {
  const words = `[record](attachment:${ID})`;
  const before = dom(replyContentHTML(words, "", false, undefined, undefined));
  const after = dom(replyContentHTML(words, "", false, undefined, files));
  expect(before.querySelector("button")).toBeNull();
  expect(after.querySelector<HTMLElement>("button[data-attachment-link]")?.dataset.id).toBe(ID);
  expect(dom(replyContentHTML(words, "", false, undefined, undefined)).querySelector("button")).toBeNull();
});

test("a routine's message links the file it delivered in the same turn", () => {
  const delivered = turn({ messages: [media(ID), reply(`7 點同步未完成；[已查核的部分紀錄](attachment:${ID})`)], routine: { id: 3 } as AgentTurn["routine"] });
  const state = emptyTimelineState();
  state.files = knownFiles([delivered]);
  const root = dom(turnHTML(delivered, state, false, look));
  const chip = root.querySelector<HTMLElement>("[data-message='2'] button[data-attachment-link]")!;
  expect(chip.dataset.id).toBe(ID);
  expect(chip.textContent).toBe("已查核的部分紀錄");
  expect(root.querySelector("[data-message='2']")!.textContent).not.toContain("attachment:");
  // The file's own card stays where it was.
  expect(root.querySelector(`.attachment-file[data-id="${ID}"]`)).not.toBeNull();
});

test("a file of an earlier turn of the conversation opens from a later reply, and one of no turn does not", () => {
  const earlier = turn({ id: 4, messages: [media(ID)] });
  const later = turn({ id: 6, messages: [reply(`Again [the file](attachment:${ID}) and [another](attachment:${OTHER})`)] });
  const state = emptyTimelineState();
  state.files = knownFiles([earlier, later]);
  const root = dom(turnHTML(later, state, false, look));
  expect([...root.querySelectorAll<HTMLElement>("button[data-attachment-link]")].map(chip => chip.dataset.id)).toEqual([ID]);
  expect(root.textContent).toContain("another");
  expect(root.innerHTML).not.toContain("attachment:");
  // Without the conversation's files the same turn shows no chip.
  expect(dom(turnHTML(later, emptyTimelineState(), false, look)).querySelector("button[data-attachment-link]")).toBeNull();
});

test("what the owner attached with a message is known too, a malformed id is not", () => {
  const sent = turn({ attachments: [{ id: ID, name: "notes.md", mime: "text/markdown" }, { id: "../etc/passwd", name: "x", mime: "text/plain" }, { name: "no id", mime: "text/plain" }] });
  expect([...knownFiles([sent]).keys()]).toEqual([ID]);
  const badMedia = turn({ messages: [{ seq: 1, kind: "media", at_ms: 1, text: JSON.stringify({ attachment: { id: "a/b.md", name: "x", mime: "text/plain" } }) }, { seq: 2, kind: "media", at_ms: 1, text: "not json" }] });
  expect(knownFiles([badMedia]).size).toBe(0);
});

test("a turn's drawing changes with the files its words link to, and only those", () => {
  const linking = turn({ messages: [reply(`[x](attachment:${ID})`)] });
  const quiet = turn({ id: 6, messages: [reply("No link here")] });
  expect(fileLinks(linking, undefined)).toBe("");
  expect(fileLinks(linking, files)).toBe(ID);
  expect(fileLinks(linking, new Map([[OTHER, { name: "o" }]]))).toBe("");
  expect(fileLinks(quiet, files)).toBe("");
});
