// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { mountConversationFind } from "./conversation-find";

test("find navigates unmounted records without mounting the entire history", async () => {
  document.body.innerHTML = '<button></button><aside></aside><main></main>';
  const thread = document.querySelector<HTMLElement>('main')!;
  const records = Array.from({length:150}, (_, id) => ({key:`turn:${id}`, texts:[id === 5 || id === 140 ? 'needle' : 'other words']}));
  const reveal = vi.fn((key: string) => { thread.innerHTML = `<li data-key="${key}"><div class="message-text">needle</div></li>`; });
  const find = mountConversationFind({button:document.querySelector('button')!,bar:document.querySelector('aside')!,thread,scroll:thread,load:async()=>{},records:()=>records,reveal});
  find.open();
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value='needle'; input.dispatchEvent(new Event('input'));
  await new Promise(resolve=>setTimeout(resolve,260));
  expect(reveal).toHaveBeenLastCalledWith('turn:140');
  expect(document.querySelector('.ra-find-count')!.textContent).toBe('2/2');
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true}));
  expect(reveal).toHaveBeenLastCalledWith('turn:5');
  expect(document.querySelector('mark.is-current')?.closest<HTMLElement>('[data-key]')?.dataset.key).toBe('turn:5');
  expect(thread.children).toHaveLength(1);
});

test("find starts at the newest word, wraps in both directions, and closes in place", async () => {
  document.body.innerHTML = '<button id="open"></button><div id="bar"></div><div id="scroll"><ol><li class="message-text">needle and needle</li><li class="message-text">new needle</li></ol></div>';
  const scroll = document.querySelector<HTMLElement>('#scroll')!;
  const find = mountConversationFind({ button: document.querySelector('#open')!, bar: document.querySelector('#bar')!, thread: document.querySelector('ol')!, scroll, load: async () => {} });
  document.querySelector<HTMLButtonElement>('#open')!.click();
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value = 'needle'; input.dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 260));
  expect(document.querySelector('.ra-find-count')!.textContent).toBe('3/3');
  input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));
  expect(document.querySelector('.ra-find-count')!.textContent).toBe('1/3');
  input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', shiftKey:true}));
  expect(document.querySelector('.ra-find-count')!.textContent).toBe('3/3');
  expect(document.querySelectorAll('mark.is-current')).toHaveLength(1);
  scroll.scrollTop = 123;
  input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
  expect(document.querySelectorAll('mark')).toHaveLength(0);
  expect(scroll.scrollTop).toBe(123);
  expect(find.isOpen()).toBe(false);
});

test("a closed pending load cannot restore highlights; a failed load never claims a complete count", async () => {
  document.body.innerHTML = '<button></button><aside></aside><main><div class="message-text">needle</div></main>';
  let done!: () => void;
  const load = vi.fn(() => new Promise<void>(resolve => { done=resolve; }));
  const find = mountConversationFind({button:document.querySelector('button')!,bar:document.querySelector('aside')!,thread:document.querySelector('main')!,scroll:document.querySelector('main')!,load});
  find.open();
  const input=document.querySelector<HTMLInputElement>('input')!;
  input.value='needle';input.dispatchEvent(new Event('input'));
  await new Promise(resolve=>setTimeout(resolve,260));
  find.close();done();await Promise.resolve();await Promise.resolve();
  expect(document.querySelector('mark')).toBeNull();
});

test("typing updates without another jump and failures keep the count incomplete", async () => {
  document.body.innerHTML = '<button></button><aside></aside><main><div class="message-text">needle needle</div></main>';
  const jump=vi.fn();
  const old=HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView=jump;
  const load=vi.fn().mockResolvedValue(undefined);
  const find=mountConversationFind({button:document.querySelector('button')!,bar:document.querySelector('aside')!,thread:document.querySelector('main')!,scroll:document.querySelector('main')!,load});
  try {
    find.open();const input=document.querySelector<HTMLInputElement>('input')!;
    input.value='needle';input.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,260));
    expect(jump).toHaveBeenCalledOnce();
    input.value='needl';input.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,260));
    expect(jump).toHaveBeenCalledOnce();expect(document.querySelector('.ra-find-count')!.textContent).toBe('2/2');
    load.mockRejectedValueOnce(new Error('Synthetic history failure'));
    input.value='failed';input.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,260));
    expect(document.querySelector('.ra-find-count')!.textContent).not.toContain("/");
    expect(document.querySelector('.ra-find-count')!.textContent!.length).toBeGreaterThan(10);
    expect(document.querySelector('mark')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[data-find="next"]')!.disabled).toBe(true);
  } finally {HTMLElement.prototype.scrollIntoView=old;find.close();}
});
test("typing during the first pending history load still starts at the newest match", async () => {
  document.body.innerHTML = '<button></button><aside></aside><main><div class="message-text">needle needle needle</div></main>';
  let firstDone!: () => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { firstDone = resolve; })).mockResolvedValue(undefined);
  const find = mountConversationFind({button:document.querySelector('button')!,bar:document.querySelector('aside')!,thread:document.querySelector('main')!,scroll:document.querySelector('main')!,load});
  find.open();
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value = 'n'; input.dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 260));
  input.value = 'needle'; input.dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 260));
  expect(document.querySelector('.ra-find-count')!.textContent).toBe('3/3');
  firstDone(); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('.ra-find-count')!.textContent).toBe('3/3');
  find.close();
});
