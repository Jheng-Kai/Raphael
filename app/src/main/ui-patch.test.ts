// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { patchHTML } from "./ui";

test("a no-op patch has no mutations and preserves focus, selection and listeners", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const html = '<button data-k="one"><svg><path d="M0 0"/></svg><b>Name</b></button><input value="saved">';
  patchHTML(root, html);
  const button = root.firstElementChild!, face = root.querySelector("svg"), input = root.querySelector("input")!;
  input.value = "draft"; input.focus(); input.setSelectionRange(2, 2);
  let pressed = 0; button.addEventListener("click", () => pressed++);
  const records: MutationRecord[] = [], observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  patchHTML(root, html); await Promise.resolve();
  expect(records).toHaveLength(0); expect(root.querySelector("svg")).toBe(face);
  expect(document.activeElement).toBe(input); expect(input.value).toBe("draft"); expect(input.selectionStart).toBe(2);
  (button as HTMLElement).click(); expect(pressed).toBe(1); observer.disconnect(); root.remove();
});

test("words, dots and attributes patch in place; only a differing shape is replaced", () => {
  const root = document.createElement("div");
  patchHTML(root, '<button data-k="one"><svg><path d="M0 0"/></svg><b>Old</b></button>');
  const button = root.firstElementChild!, face = button.firstElementChild, words = button.lastElementChild;
  patchHTML(root, '<button data-k="one" aria-current="true"><svg><path d="M0 0"/></svg><b>New</b><i class="dot"></i></button>');
  expect(root.firstElementChild).toBe(button); expect(button.firstElementChild).toBe(face); expect(button.children[1]).toBe(words);
  expect(words?.textContent).toBe("New"); expect(button.getAttribute("aria-current")).toBe("true");
  patchHTML(root, '<button data-k="one"><svg><path d="M0 0"/></svg><small>Role</small></button>');
  expect(root.firstElementChild).toBe(button); expect(button.firstElementChild).toBe(face); expect(words?.isConnected).toBe(false);
  expect(button.hasAttribute("aria-current")).toBe(false); expect(button.querySelector("i")).toBeNull();
});

test("keyed siblings retain their nodes through an insertion and reorder", () => {
  const root = document.createElement("div");
  patchHTML(root, '<section data-member-item="1">One</section><section data-member-item="2">Two</section>');
  const [one, two] = [...root.children];
  patchHTML(root, '<section data-member-item="3">Three</section><section data-member-item="2">Two</section><section data-member-item="1">One</section>');
  expect(root.children[1]).toBe(two); expect(root.children[2]).toBe(one);
});

test("a changed row preserves its slime clock and active transition", async () => {
  const root = document.createElement("div");
  const row = (time: number, words: string) => `<button><span class="slime-surface" data-state="working" style="--slime-delay:-${time}ms"><svg class="slime" data-slime-member="3" data-state="working" style="--slime-delay:-${time}ms;--slime-since:-${time}ms"><g class="slime-settle"></g></svg></span><b>${words}</b></button>`;
  patchHTML(root, row(1000, "Earlier reply"));
  const svg = root.querySelector<SVGElement>("svg")!, surface = svg.parentElement!, part = svg.firstElementChild!;
  svg.classList.add("is-delighted"); svg.setAttribute("data-moved", "working"); part.classList.add("slime-in-between"); part.setAttribute("style", "");
  const style = svg.getAttribute("style"), surfaceStyle = surface.getAttribute("style");
  const records: MutationRecord[] = [], observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(surface, { subtree: true, childList: true, attributes: true, characterData: true });
  patchHTML(root, row(3000, "New reply"));
  await Promise.resolve(); observer.disconnect();
  expect(root.querySelector("svg")).toBe(svg);
  expect(svg.getAttribute("style")).toBe(style); expect(surface.getAttribute("style")).toBe(surfaceStyle);
  expect(svg.classList.contains("is-delighted")).toBe(true); expect(svg.getAttribute("data-moved")).toBe("working");
  expect(part.classList.contains("slime-in-between")).toBe(true); expect(root.querySelector("b")!.textContent).toBe("New reply");
  expect(records).toHaveLength(0);
});
