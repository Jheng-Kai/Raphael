import { expect, test, vi } from "vitest";
import { sameWire, ThreadRenderCache } from "./thread-render";

test("a streaming turn rebuilds only its own line among 150 finished turns", () => {
  const cache = new ThreadRenderCache(), draw = vi.fn((id: number) => `<li>${id}</li>`);
  const turns = Array.from({ length: 151 }, (_, id) => ({ id, text: "Kept words", messages: [{ text: "Code and cards" }] }));
  const render = () => turns.map(turn => cache.line(String(turn.id), turn, [false], () => draw(turn.id)));
  const before = render(); draw.mockClear();
  turns[150] = { ...turns[150]!, text: "The next token" };
  expect(render().slice(0, 150)).toEqual(before.slice(0, 150));
  expect(draw).toHaveBeenCalledExactlyOnceWith(150);
  draw.mockClear(); render(); expect(draw).not.toHaveBeenCalled();
});

test("wire equality detects same-length edits without JSON and presentation changes invalidate one line", () => {
  const cache = new ThreadRenderCache(), draw = vi.fn(() => "line");
  const before = { text: "old", messages: [{ text: "first" }] };
  expect(sameWire(before, { ...before, text: "new" })).toBe(false);
  cache.line("one", before, [false], draw);
  cache.line("one", structuredClone(before), [false], draw);
  expect(draw).toHaveBeenCalledTimes(1);
  cache.line("one", before, [true], draw);
  expect(draw).toHaveBeenCalledTimes(2);
  cache.retain(new Set()); cache.line("one", before, [true], draw);
  expect(draw).toHaveBeenCalledTimes(3);
});
