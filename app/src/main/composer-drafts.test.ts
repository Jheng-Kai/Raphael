// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { DRAFT_STORAGE_KEY, readDraftWords, writeDraftWords } from "./composer-drafts";

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

test("one guarded key retains separate member conversations and rooms, including quotes", () => {
  writeDraftWords('member:3:31', {text:'First draft',quote:{text:'Quoted sample',author:'Reader'}});
  writeDraftWords('member:3:32', {text:'Second draft'});
  writeDraftWords('room:1', {text:'Room draft',quote:{id:4,text:'Room quote'}});
  expect(localStorage.length).toBe(1);
  expect(readDraftWords('member:3:31')).toEqual({text:'First draft',quote:{text:'Quoted sample',author:'Reader'}});
  writeDraftWords('member:3:31');
  expect(readDraftWords('member:3:32')?.text).toBe('Second draft');
  expect(readDraftWords('room:1')?.text).toBe('Room draft');
  writeDraftWords('member:3:32'); writeDraftWords('room:1', {text:''});
  expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
});

test("malformed and unavailable storage never prevents a composer from working", () => {
  for (const data of ['invalid', 'null', '[]', '{"member:0:1":{"text":42}}']) {
    localStorage.setItem(DRAFT_STORAGE_KEY,data);expect(readDraftWords('member:0:1')).toBeUndefined();
  }
  const get = vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw new Error('unavailable');});
  const set = vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('unavailable');});
  try {
    expect(readDraftWords('member:0:1')).toBeUndefined();
    expect(()=>writeDraftWords('member:0:1',{text:'Still usable'})).not.toThrow();
  } finally { get.mockRestore(); set.mockRestore(); }
});

test("page provenance survives draft storage without retaining non-string page identifiers", () => {
  writeDraftWords("room:1", { text: "Page text", pageId: "p1" });
  expect(readDraftWords("room:1")).toEqual({ text: "Page text", pageId: "p1" });
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ "room:1": { text: "Draft", pageId: { unsafe: true } } }));
  expect(readDraftWords("room:1")).toEqual({ text: "Draft" });
});
