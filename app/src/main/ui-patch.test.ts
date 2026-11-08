// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { patchHTML } from "./ui";
import { slimeSVG } from './slime';

test('an unchanged generated face is reused before its cel markup is parsed', () => {
  const root=document.createElement('div');
  const picture=slimeSVG({character:'shion'},{state:'thinking',member:3});
  patchHTML(root,`<button data-k="3">${picture}<b>Old</b></button>`);
  const surface=root.querySelector('.slime-surface');
  const template=document.createElement('template');
  const parse=vi.spyOn(template,'innerHTML','set');
  const create=document.createElement.bind(document);
  const allocation=vi.spyOn(document,'createElement').mockImplementation((name,options)=>name==='template'?template:create(name,options));
  try {
    patchHTML(root,`<button data-k="3">${picture}<b>New</b></button>`);
    expect(parse.mock.calls[0]?.[0]).not.toContain('slime-cel-eye');
    expect(root.querySelector('.slime-surface')).toBe(surface);
    expect(root.querySelector('b')?.textContent).toBe('New');
  } finally {allocation.mockRestore();parse.mockRestore();}
});

test('inserting a generated cel subtree does not allocate a second copy for garbage collection', () => {
  const root=document.createElement('div');
  const clone=vi.spyOn(Node.prototype,'cloneNode');
  try {
    patchHTML(root,`<span class="slime-surface"><svg>${'<path d="M0 0"/>'.repeat(576)}</svg></span>`);
    expect(root.querySelectorAll('path')).toHaveLength(576);
    expect(clone).not.toHaveBeenCalled();
  } finally {clone.mockRestore();}
});

test('generated face reuse follows keyed reorders and still updates a changed identity or state', () => {
  const root=document.createElement('div');
  const row=(id:number,state:'thinking'|'working',color:'sky'|'coral'='sky')=>`<button data-k="${id}">${slimeSVG({color},{state,member:id})}</button>`;
  patchHTML(root,row(1,'thinking')+row(2,'working'));
  const [one,two]=[...root.querySelectorAll('svg.slime')];
  patchHTML(root,row(2,'working')+row(1,'thinking'));
  expect([...root.querySelectorAll('svg.slime')]).toEqual([two,one]);
  patchHTML(root,row(2,'thinking','coral')+row(1,'thinking'));
  expect(root.querySelector('svg.slime')).toBe(two);
  expect(two?.getAttribute('data-state')).toBe('thinking');
  expect((two as SVGElement).style.getPropertyValue('--slime-color')).toBe('#FC2C3E');
  expect(root.querySelectorAll('.slime-loop-body[data-state="thinking"]')).toHaveLength(2);
});

test('a colour change updates the retained vector fallback as well as its cel surface', () => {
  const root = document.createElement('div');
  const picture=(color:string)=>`<span class="slime-surface" data-slime-drawing="plain" style="--slime-color:${color}"><svg class="slime" data-state="working" data-slime-member="1" style="--slime-color:${color}"></svg></span>`;
  patchHTML(root,picture('red')); const face=root.querySelector('svg');
  patchHTML(root,picture('blue'));
  expect(root.querySelector('svg')).toBe(face);
  expect(root.querySelector('svg')?.style.getPropertyValue('--slime-color')).toBe('blue');
});

test('a retained cel surface still updates a changed character drawing', () => {
  const root = document.createElement('div');
  const picture = (id: string) => `<span class="slime-surface" data-slime-drawing="${id}"><svg class="slime" data-state="working" data-slime-member="1"><path d="${id}"/></svg></span>`;
  patchHTML(root,picture('one'));
  const face=root.querySelector('svg');
  patchHTML(root,picture('two'));
  expect(root.querySelector('svg')).toBe(face);
  expect(root.querySelector('path')?.getAttribute('d')).toBe('two');
});

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

test("a face never becomes another member's: Raphael's face where Testarossa's stood is a new one, so her bow cannot move on him", () => {
  const root=document.createElement('div');
  patchHTML(root,`<button>${slimeSVG({character:'testarossa'},{state:'idle',member:7})}</button>`);
  const before=root.querySelector('svg.slime');
  patchHTML(root,`<button>${slimeSVG({character:'rimuru'},{state:'working',member:0,crown:true})}</button>`);
  const after=root.querySelector('svg.slime')!;
  expect(after).not.toBe(before);
  expect(after.getAttribute('data-slime-member')).toBe('0');
  expect(root.querySelectorAll('.slime-surface')).toHaveLength(1);
  expect(root.innerHTML).not.toContain('#3FBF94');
});
