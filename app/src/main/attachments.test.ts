// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { bindFilePaste } from "./attachments";
import { t } from "./i18n";

test.each(['x'.repeat(2000), Array(40).fill('line').join('\n'), 'https://sample.invalid/'.repeat(200)])("long clipboard text becomes a numbered ordinary attachment before earlier paste listeners", text => {
  const input = document.createElement('textarea'), add = vi.fn(), earlier = vi.fn();
  input.addEventListener('paste', earlier);
  bindFilePaste(input, add, vi.fn());
  const paste = () => {
    const event = new Event('paste', {cancelable:true});
    Object.defineProperty(event, 'clipboardData', {value:{files:[],getData:()=>text}});
    input.dispatchEvent(event); return event;
  };
  expect(paste().defaultPrevented).toBe(true);
  expect(input.value).toBe(''); expect(earlier).not.toHaveBeenCalled();
  const file = add.mock.calls[0][0][0] as File;
  expect(file.name).toBe(t('agent.pastedText')); expect(file.type).toBe('text/plain'); expect(file.size).toBe(new TextEncoder().encode(text).length);
  paste(); expect(add.mock.calls[1][0][0].name).toBe(t('agent.pastedText').replace(/\.txt$/, ' 2.txt'));
});

test("short text retains native paste and a clipboard with files attaches both its file and long text", () => {
  const input=document.createElement('textarea'),add=vi.fn(); bindFilePaste(input,add,vi.fn());
  const paste=(text:string,files:File[]=[])=>{const event=new Event('paste',{cancelable:true});Object.defineProperty(event,'clipboardData',{value:{files,getData:()=>text}});input.dispatchEvent(event);return event;};
  expect(paste('short').defaultPrevented).toBe(false);expect(add).not.toHaveBeenCalled();
  const image=new File(['sample'],'sample.png',{type:'image/png'});
  paste('x'.repeat(200_000),[image]);expect(input.value).toBe('');expect(add.mock.calls[0][0]).toHaveLength(2);expect(add.mock.calls[0][0][0]).toBe(image);
});
