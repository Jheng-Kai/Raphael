// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
import { attachRefusal, readComposerFile } from "./attachments";
vi.mock("./api", () => ({core:vi.fn()}));
beforeEach(() => vi.clearAllMocks());

test("large files are read in 1 MiB slices and sent as an opaque stored ID", async () => {
  const size = 5 * 1024 * 1024 + 17;
  const whole = vi.fn(() => { throw new Error("whole-file read"); });
  const slice = vi.fn((start: number, end: number) => ({arrayBuffer:async()=>new Uint8Array(Math.min(size, end) - start).buffer}));
  const stored = {name:"clip.mp4",mime:"video/mp4",data:"",stored_id:"a".repeat(32)+".mp4",size};
  vi.mocked(api.core).mockImplementation(async (_method, params) => {
    const p = params as Record<string, unknown>;
    if (p.action === "begin") return {token:"sample"} as never;
    if (p.action === "finish") return stored as never;
    expect((p.data as string).length).toBeLessThanOrEqual(1_398_104);
    return {} as never;
  });
  expect(await readComposerFile({name:"clip.mp4",size,arrayBuffer:whole,slice} as unknown as File,"video/mp4")).toEqual(stored);
  expect(whole).not.toHaveBeenCalled(); expect(slice).toHaveBeenCalledTimes(6);
  expect(api.core).toHaveBeenLastCalledWith("attachments.upload",{action:"finish",token:"sample"});
});

test("navigation aborts an unfinished upload and never publishes its ID", async () => {
  vi.mocked(api.core).mockResolvedValue({token:"sample"});
  await expect(readComposerFile({name:"clip.mp4",size:9_000_000} as File,"video/mp4",()=>false)).rejects.toThrow("cancelled");
  expect(api.core).toHaveBeenLastCalledWith("attachments.upload",{action:"abort",token:"sample"});
  expect(api.core).not.toHaveBeenCalledWith("attachments.upload",expect.objectContaining({action:"finish"}));
});

test("the composer admits exact document/video bounds and refuses the next byte", () => {
  for (const [mime,limit] of [["application/pdf",250*1024*1024],["video/mp4",1024*1024*1024]] as const) {
    expect(attachRefusal(19,mime,limit)).toBeNull();
    expect(attachRefusal(0,mime,limit+1)).toBe("size");
    expect(attachRefusal(20,mime,1)).toBe("count");
  }
});
