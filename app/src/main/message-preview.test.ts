// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { messagePreviewMeasure } from "./message-preview";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test("repeated resize and font notifications measure every preview at most once per frame", () => {
  const root = document.createElement("ol"); document.body.append(root);
  root.innerHTML = `<li data-expandable><div class="message-text">${"Long message ".repeat(20)}</div><button data-act="expand-message"></button></li>`;
  const text = root.querySelector<HTMLElement>(".message-text")!;
  Object.defineProperties(text, {clientHeight: {value: 100}, scrollHeight: {value: 300}});
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  const query = vi.spyOn(root, "querySelectorAll"), measure = messagePreviewMeasure(root);
  for (let i = 0; i < 20; i++) measure();
  expect(query).not.toHaveBeenCalled(); expect(frames).toHaveLength(1);
  frames.shift()!(0);
  expect(query).toHaveBeenCalledTimes(1);
  expect(root.firstElementChild!.classList.contains("is-clipped")).toBe(true);
});
