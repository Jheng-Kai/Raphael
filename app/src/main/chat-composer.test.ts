// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
const api=vi.hoisted(()=>({roomTranscribe:vi.fn(),core:vi.fn()}));
vi.mock("./api",()=>api);
import { createChatComposer, drawTaskSlot, wavBytes } from "./chat-composer";
import { setLocale } from "./i18n";
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
beforeEach(()=>{document.body.innerHTML="";vi.clearAllMocks();setLocale("en");api.core.mockImplementation(async method => method === "settings.get" ? { settings: { action_mode: "ask" } } : {});});
function mount(send=vi.fn().mockResolvedValue(undefined)) {const view=createChatComposer({placeholder:()=>"Room message",send});document.body.append(view.el);return {view,send};}

test("page provenance follows its draft across restoration, localization and failed delivery", async () => {
 const {view,send}=mount(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined));
 view.setDraft("Owner words\n");
 expect(view.placePageText("p1","Page words <b>")).toBe(true);
 expect(view.input.value).toBe("Owner words\nPage words <b>");
 expect(send).not.toHaveBeenCalled();
 const saved=view.snapshot(),note=view.el.querySelector<HTMLElement>(".cmp-page-note")!;
 view.setDraft("Another conversation");expect(note.hidden).toBe(true);
 view.setDraft(saved.text,saved.files,saved.pageId);expect(note.hidden).toBe(false);
 setLocale("zh-TW");expect(note.textContent).toBe("這段文字來自頁面，確認後再送出");
 view.el.requestSubmit();await flush();expect(note.hidden).toBe(false);
 expect(view.snapshot().pageId).toBe("p1");
 view.el.requestSubmit();await flush();expect(note.hidden).toBe(true);
 expect(send).toHaveBeenCalledTimes(2);
 view.el.hidden=true;expect(view.placePageText("p2","Stale page")).toBe(false);
});

test("a page's pending question is answered only after the owner submits the composer", () => {
 const answerPage=vi.fn(()=>true),send=vi.fn().mockResolvedValue(undefined);
 const view=createChatComposer({placeholder:()=>"Message",send,answerPage});document.body.append(view.el);
 view.placePageText("p1","Chosen date");
 expect(answerPage).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 view.el.requestSubmit();
 expect(answerPage).toHaveBeenCalledExactlyOnceWith("p1","Chosen date");expect(send).not.toHaveBeenCalled();
});

test("room sends clear immediately and accept more messages while delivery is pending", async () => {
 const complete: (() => void)[] = [];
 const {view,send}=mount(vi.fn(()=>new Promise<void>(resolve=>complete.push(resolve))));
 view.setDraft("First");view.el.requestSubmit();expect(view.input.value).toBe("");
 view.input.value="Second";view.input.dispatchEvent(new Event("input"));view.el.requestSubmit();
 expect(send.mock.calls.map(call=>call[0])).toEqual(["First","Second"]);
 complete[0]();complete[1]();await flush();expect(view.input.value).toBe("");
});
test("failed delivery retains a draft and Enter retries; IME Enter never submits",async()=>{
 const {view,send}=mount(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined));view.setDraft("Hello");
 view.input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}));expect(send).not.toHaveBeenCalled();
 view.input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await flush();expect(view.input.value).toBe("Hello");
 view.input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await flush();expect(send).toHaveBeenCalledTimes(2);expect(view.input.value).toBe("");
});
test("switching rooms while a send completes preserves the new room draft",async()=>{
 let complete!:()=>void;const {view}=mount(vi.fn(()=>new Promise<void>(resolve=>{complete=resolve;})));view.setDraft("Old room");view.el.requestSubmit();view.setDraft("New room");complete();await flush();expect(view.input.value).toBe("New room");
});
test("failed delivery preserves voice correction evidence for a retry, and learns only after delivery",async()=>{
 const {view}=mount(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined));
 view.setDraft("Please use Sample Tool Ex");view.seedDictation("Please use Sample Tool Ex");
 view.input.value="Please use SampleToolX";view.input.dispatchEvent(new Event("input"));
 view.el.requestSubmit();await flush();expect(api.core).not.toHaveBeenCalledWith("dictionary.correct",expect.anything());
 api.core.mockResolvedValue({learned:[]});view.el.requestSubmit();await flush();
 expect(api.core).toHaveBeenCalledWith("dictionary.correct",{edits:[{before:"Please use Sample Tool Ex",after:"Please use SampleToolX"}]});
});
test("composer buttons do not also trigger an enclosing member composer",()=>{
 const outer=document.createElement("section"),handler=vi.fn();outer.addEventListener("click",handler);const {view}=mount();outer.append(view.el);document.body.append(outer);view.el.querySelector<HTMLButtonElement>(".cmp-attach")!.click();expect(handler).not.toHaveBeenCalled();
});

test("a pending learning response does not keep a delivered composer busy",async()=>{
 api.core.mockImplementation(()=>new Promise(()=>{}));const {view,send}=mount();
 view.setDraft("Please use Sample Tool Ex");view.seedDictation("Please use Sample Tool Ex");
 view.input.value="Please use SampleToolX";view.input.dispatchEvent(new Event("input"));view.el.requestSubmit();await flush();
 expect(send).toHaveBeenCalledOnce();expect(view.input.value).toBe("");
 view.input.value="Next message";view.input.dispatchEvent(new Event("input"));
 expect(view.el.querySelector<HTMLButtonElement>(".cmp-send")!.disabled).toBe(false);
});
test("attachment-only delivery uses the shared composer and keeps the file on failure",async()=>{
 const {view,send}=mount(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined));const picker=view.el.querySelector<HTMLInputElement>(".cmp-picker")!;
 Object.defineProperty(picker,"files",{value:[{name:"notes.txt",type:"text/plain",size:5,arrayBuffer:async()=>new TextEncoder().encode("notes").buffer}]});picker.dispatchEvent(new Event("change"));await flush();
 expect(view.el.querySelector<HTMLButtonElement>(".cmp-send")!.disabled).toBe(false);view.el.requestSubmit();await flush();expect(view.el.querySelector(".cmp-file")!.textContent).toContain("notes.txt");
 view.el.requestSubmit();await flush();expect(send).toHaveBeenLastCalledWith("",[{name:"notes.txt",mime:"text/plain",data:btoa("notes")}]);expect(view.el.querySelector<HTMLElement>(".cmp-file")!.hidden).toBe(true);
});

test("plus only attaches, and the permission mode is its own named control on the model menu's card, with what each mode does", async () => {
 const {view}=mount();
 const picker=view.el.querySelector<HTMLInputElement>(".cmp-picker")!,pick=vi.spyOn(picker,"click");
 view.el.querySelector<HTMLButtonElement>(".cmp-attach")!.click();
 expect(pick).toHaveBeenCalledTimes(1);expect(document.querySelector("#app-popover")).toBeNull();
 view.el.querySelector<HTMLButtonElement>(".cmp-mode")!.click();await flush();
 expect(document.querySelector("#app-popover.cb-menu > .cb-card.cb-modes")).not.toBeNull();
 const rows=[...document.querySelectorAll<HTMLElement>("#app-popover [data-mode]")];
 expect(rows.map(row=>row.dataset.mode)).toEqual(["direct","ask","plan","bypass"]);
 expect(rows.every(row=>row.getAttribute("role")==="radio"&&row.querySelector(".cb-name small")?.textContent)).toBe(true);
 expect(rows.filter(row=>row.getAttribute("aria-checked")==="true").map(row=>row.dataset.mode)).toEqual(["direct"]);
 api.core.mockImplementation(async method => method === "settings.get" ? { settings: { action_mode: "plan" } } : {});
 document.querySelector<HTMLButtonElement>('#app-popover [data-mode="plan"]')!.click();await flush();
 expect(api.core).toHaveBeenCalledWith("settings.set",{key:"action_mode",value:"plan"});
 expect(view.el.querySelector(".cmp-mode span")!.textContent).toBe("Plan");
 api.core.mockImplementation(async method => method === "settings.get" ? { settings: { action_mode: "bypass" } } : {});
 view.el.querySelector<HTMLButtonElement>(".cmp-mode")!.click();await flush();
 document.querySelector<HTMLButtonElement>('#app-popover [data-mode="bypass"]')!.click();await flush();
 expect(api.core).toHaveBeenCalledWith("settings.set",{key:"action_mode",value:"bypass"});
 expect(view.el.querySelector(".cmp-mode span")!.textContent).toBe("Allow all");
});
test("voice shows Send while recording and its next press delivers the combined draft once",async()=>{
 const stopTrack=vi.fn(),stop=vi.fn();let recorder:any;Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop:stopTrack}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;ondataavailable?:(e:any)=>void;constructor(){recorder=this;}start(){this.state="recording";}stop(){stop();this.state="inactive";this.onstop?.();}});
 vi.stubGlobal("AudioContext",class {decodeAudioData=async()=>({numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array([0,0.5])});close=async()=>{};});
 api.roomTranscribe.mockResolvedValue({text:"Please use Sample Tool Ex"});const {view,send}=mount();view.setDraft("Typed first");view.el.querySelector<HTMLButtonElement>(".cmp-voice")!.click();await flush();expect(view.el.dataset.taskState).toBe("recording");expect(view.el.querySelector(".cmp-voice .cmp-plane")).not.toBeNull();expect(recorder.state).toBe("recording");expect(stop).not.toHaveBeenCalled();
 expect(view.el.querySelector<HTMLButtonElement>(".cmp-send")!.disabled).toBe(true);view.el.querySelector<HTMLButtonElement>(".cmp-voice")!.click();await flush();expect(stop).toHaveBeenCalledOnce();expect(stopTrack).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledExactlyOnceWith("Typed first Please use Sample Tool Ex", []);expect(view.input.value).toBe("");expect(api.roomTranscribe).toHaveBeenCalledOnce();
 vi.unstubAllGlobals();
});
test("WAV encoding produces mono PCM with correct sample rate and clipping",()=>{
 const bytes=wavBytes([new Float32Array([-2,0,2])],16000),view=new DataView(bytes.buffer);expect(new TextDecoder().decode(bytes.slice(0,4))).toBe("RIFF");expect(view.getUint32(24,true)).toBe(16000);expect(view.getUint16(22,true)).toBe(1);expect(view.getInt16(44,true)).toBe(-32768);expect(view.getInt16(48,true)).toBe(32767);
});

test("speech completion cannot automatically submit text placed by a page", async () => {
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop(){}}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;start(){this.state="recording";}stop(){this.state="inactive";this.onstop?.();}});
 vi.stubGlobal("AudioContext",class {decodeAudioData=async()=>({numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array([0])});close=async()=>{};});
 api.roomTranscribe.mockResolvedValue({text:"Owner dictation"});
 try {
  const {view,send}=mount();view.placePageText("p1","Page words");
  const voice=view.el.querySelector<HTMLButtonElement>('.cmp-voice')!;
  voice.click();await flush();voice.click();await flush();
  expect(send).not.toHaveBeenCalled();
  expect(view.input.value).toBe("Page words Owner dictation");
  view.el.requestSubmit();await flush();
  expect(send).toHaveBeenCalledExactlyOnceWith("Page words Owner dictation",[]);
 } finally {vi.unstubAllGlobals();}
});

test("denied microphone permission says why and preserves the typed draft", async () => {
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockRejectedValue(new DOMException("denied","NotAllowedError"))}});
 const {view,send}=mount();view.setDraft("Keep my words");view.el.querySelector<HTMLButtonElement>('.cmp-voice')!.click();await flush();
 expect(document.querySelector('.toasts')?.textContent).toContain('Microphone access was denied');
 expect(view.input.value).toBe('Keep my words');expect(send).not.toHaveBeenCalled();
});

test("a cancelled permission request cannot release a later recording", async () => {
 let reject!:(error:Error)=>void;const stopTrack=vi.fn();
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockImplementationOnce(()=>new Promise((_resolve,no)=>{reject=no;})).mockResolvedValue({getTracks:()=>[{stop:stopTrack}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;start(){this.state="recording";}stop(){this.state="inactive";this.onstop?.();}});
 try {
  const {view,send}=mount(),voice=view.el.querySelector<HTMLButtonElement>('.cmp-voice')!;
  voice.click();await flush();view.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();
  voice.click();await flush();reject(new Error('Late old permission failure'));await flush();
  expect(view.el.dataset.taskState).toBe('recording');expect(stopTrack).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  view.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();
 } finally {vi.unstubAllGlobals();}
});

test.each([false,true])("unrecognized or failed speech retains the draft and names the voice failure (%s)",async failed=>{
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop(){}}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;start(){this.state="recording";}stop(){this.state="inactive";this.onstop?.();}});
 vi.stubGlobal("AudioContext",class {decodeAudioData=async()=>({numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array([0])});close=async()=>{};});
 if(failed)api.roomTranscribe.mockRejectedValue(new Error('Synthetic transcription failure'));else api.roomTranscribe.mockResolvedValue({text:''});
 try{
  const {view,send}=mount();view.setDraft('Keep my words');const voice=view.el.querySelector<HTMLButtonElement>('.cmp-voice')!;
  voice.click();await flush();voice.click();await flush();
  expect(document.querySelector('.toasts')?.textContent).toContain(failed?'Voice input could not be processed':'No speech was recognized');
  expect(view.input.value).toBe('Keep my words');expect(send).not.toHaveBeenCalled();expect(view.el.dataset.taskState).toBe('idle');
 }finally{vi.unstubAllGlobals();}
});

test("a voice delivery failure keeps the combined draft and learns corrections only on a successful retry", async () => {
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop(){}}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;start(){this.state="recording";}stop(){this.state="inactive";this.onstop?.();}});
 vi.stubGlobal("AudioContext",class {decodeAudioData=async()=>({numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array([0])});close=async()=>{};});
 api.roomTranscribe.mockResolvedValue({text:'Sample Tool Ex'});
 try {
  const {view,send}=mount(vi.fn().mockRejectedValueOnce(new Error('Synthetic delivery failure')).mockResolvedValue(undefined));view.setDraft('Use');
  const voice=view.el.querySelector<HTMLButtonElement>('.cmp-voice')!;voice.click();await flush();voice.click();await flush();
  expect(send).toHaveBeenCalledExactlyOnceWith('Use Sample Tool Ex',[]);expect(view.input.value).toBe('Use Sample Tool Ex');
  expect(document.querySelector('.conversation-card')?.textContent).toContain('Could not send');
  view.input.value='Use SampleToolX';view.input.dispatchEvent(new Event('input'));view.el.requestSubmit();await flush();
  expect(api.core).toHaveBeenCalledWith('dictionary.correct',{edits:[{before:'Sample Tool Ex',after:'SampleToolX'}]});
 } finally {vi.unstubAllGlobals();}
});

test("one Escape discards a room recording without sending audio for transcription",async()=>{
 const stopTrack=vi.fn(),stop=vi.fn();
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop:stopTrack}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;start(){this.state="recording";}stop(){stop();this.state="inactive";this.onstop?.();}});
 try {
  const {view,send}=mount();view.el.querySelector<HTMLButtonElement>(".cmp-voice")!.click();await flush();
  view.input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  await flush();
  expect(view.el.querySelector("[data-cancel-armed]")).toBeNull();
  expect(stop).toHaveBeenCalledOnce();expect(stopTrack).toHaveBeenCalledOnce();expect(api.roomTranscribe).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(view.input.value).toBe("");
 } finally {vi.unstubAllGlobals();}
});

test("task Stop owns the slot through ack, running and waiting, independently of send completion",async()=>{
 const stopTask=vi.fn().mockResolvedValue(undefined),send=vi.fn().mockResolvedValue(undefined);
 const view=createChatComposer({placeholder:()=>"Message",send,stopTask});document.body.append(view.el);
 view.setDraft("Start");view.el.requestSubmit();expect(view.el.dataset.taskState).toBe("ack");
 await flush();expect(view.el.dataset.taskState).toBe("ack");
 for(const state of ["running","waiting"] as const){view.setTaskState(state);expect(view.el.querySelector(".cmp-voice")!.getAttribute("aria-label")).toBe("Stop");}
 view.el.querySelector<HTMLButtonElement>(".cmp-voice")!.click();await flush();expect(stopTask).toHaveBeenCalledOnce();
 expect(send).toHaveBeenCalledOnce();view.setTaskState("idle");expect(view.el.dataset.taskState).toBe("idle");
 expect(view.el.querySelector<HTMLElement>(".cmp-voice")!.dataset.tooltip).not.toBe("Stop");
});

test("the slot's one button is the send glyph while recording and Stop only once something is sent, never a second control",()=>{
 const view=createChatComposer({placeholder:()=>"Message",send:vi.fn().mockResolvedValue(undefined)});document.body.append(view.el);
 const button=view.el.querySelector<HTMLButtonElement>(".cmp-voice")!,sendLabel=view.el.querySelector(".cmp-send")!.getAttribute("aria-label");
 drawTaskSlot(view.el,"recording");
 expect(view.el.dataset.taskState).toBe("recording");expect(view.el.querySelector(".cmp-voice")).toBe(button);
 expect(button.querySelector(".cmp-plane")).not.toBeNull();expect(button.querySelector(".av")).toBeNull();
 expect(button.getAttribute("aria-label")).toBe(sendLabel);expect(button.dataset.tooltip).toBe(sendLabel);expect(button.hasAttribute("title")).toBe(false);
 expect(button.type).toBe("button");expect(button.disabled).toBe(false);expect(button.classList.contains("task-action")).toBe(true);
 drawTaskSlot(view.el,"recording",true);expect(button.disabled).toBe(false);
 drawTaskSlot(view.el,"ack");
 expect(button.querySelector(".cmp-plane")).toBeNull();expect(button.querySelector("svg")).not.toBeNull();expect(button.getAttribute("aria-label")).toBe("Stop");
 drawTaskSlot(view.el,"idle");expect(view.el.querySelector(".cmp-voice")).toBe(button);
});

test("one Escape discards pending transcription and a late result cannot affect a new recording",async()=>{
 const stopTrack=vi.fn();let finish!:(value:{text:string})=>void;
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop:stopTrack}]})}});
 vi.stubGlobal("MediaRecorder",class {state="inactive";onstop?:()=>void;start(){this.state="recording";}stop(){this.state="inactive";this.onstop?.();}});
 vi.stubGlobal("AudioContext",class {decodeAudioData=async()=>({numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array([0])});close=async()=>{};});
 api.roomTranscribe.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 try{
  const {view,send}=mount(),voice=view.el.querySelector<HTMLButtonElement>(".cmp-voice")!;
  voice.click();await flush();voice.click();await flush();
  expect(api.roomTranscribe).toHaveBeenCalledOnce();expect(voice.disabled).toBe(true);
  view.input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await flush();
  expect(view.el.querySelector("[data-cancel-armed]")).toBeNull();
  expect(view.el.dataset.taskState).toBe("idle");
  voice.click();await flush();expect(voice.getAttribute("aria-pressed")).toBe("true");
  finish({text:"Discard this old transcript"});await flush();
  expect(view.input.value).toBe("");expect(send).not.toHaveBeenCalled();
  expect(voice.getAttribute("aria-pressed")).toBe("true");expect(view.el.dataset.taskState).toBe("recording");
  view.input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await flush();
 }finally{vi.unstubAllGlobals();}
});

const png=(name="shot.png",size=4)=>new File([new Uint8Array(size)],name,{type:"image/png"});
const paste=(input:HTMLTextAreaElement,files:File[],text="")=>{const event=Object.assign(new Event("paste",{bubbles:true,cancelable:true}),{clipboardData:{files,getData:()=>text}});input.dispatchEvent(event);return event;};
test("an image pasted into the composer is attached with its picture, and its words stay in the field",async()=>{
 const {view,send}=mount();const event=paste(view.input,[png()],"caption");expect(event.defaultPrevented).toBe(true);await flush();await new Promise(resolve=>setTimeout(resolve));await flush();
 expect(view.input.value).toBe("caption");
 expect(view.el.querySelector<HTMLImageElement>(".cmp-chip img.cmp-thumb")!.src).toContain("data:image/png;base64,");
 // Only the picture: its name is for screen readers, never printed beside it.
 expect(view.el.querySelector(".cmp-chip .cmp-pic")!.getAttribute("aria-label")).toBe("shot.png");
 expect(view.el.querySelector(".cmp-chip")!.textContent!.trim()).toBe("");
 // The composer keeps its clicks, so its own picture opens large from inside it.
 view.el.querySelector<HTMLButtonElement>(".cmp-chip .cmp-pic")!.click();
 expect(document.querySelector<HTMLImageElement>(".media-lightbox .lb-img")!.src).toContain("data:image/png;base64,");
 document.querySelector<HTMLButtonElement>('.media-lightbox [data-lb="close"]')!.click();
 expect(view.el.querySelectorAll(".cmp-chip")).toHaveLength(1);
 view.el.requestSubmit();await flush();
 expect(send).toHaveBeenCalledWith("caption",[{name:"shot.png",mime:"image/png",data:"AAAAAA=="}]);
});
test("too many files says so and the first ones stay",async()=>{
 const {view}=mount();view.addFiles(Array.from({length:21},(_,i)=>png(`${i}.png`)));await new Promise(resolve=>setTimeout(resolve,10));await flush();
 expect(view.el.querySelectorAll(".cmp-chip")).toHaveLength(20);
 expect(document.querySelector(".toasts")?.textContent??"").toContain("20");
});
test("a file still being read does not reach the next room's draft",async()=>{
 const {view}=mount();view.addFiles([png()]);view.setDraft("Other room");await new Promise(resolve=>setTimeout(resolve,10));await flush();
 expect(view.el.querySelectorAll(".cmp-chip")).toHaveLength(0);
 expect(view.el.querySelector<HTMLElement>(".cmp-file")!.hidden).toBe(true);
});
test("typing does not draw the picture again",async()=>{
 const {view}=mount();view.addFiles([png()]);await new Promise(resolve=>setTimeout(resolve,10));await flush();
 const chip=view.el.querySelector(".cmp-chip");view.input.value="words";view.input.dispatchEvent(new Event("input"));
 expect(view.el.querySelector(".cmp-chip")).toBe(chip);
});


test("a delivered paste starts the next draft filename at the base name", async () => {
 const {view}=mount();
 paste(view.input,[],'x'.repeat(2000));await new Promise(resolve=>setTimeout(resolve,0));await flush();
 expect(view.el.querySelector('.cmp-chip-t')!.textContent).toBe('Pasted text.txt');
 view.el.requestSubmit();await flush();
 paste(view.input,[],'y'.repeat(2000));await new Promise(resolve=>setTimeout(resolve,0));await flush();
 expect(view.el.querySelector('.cmp-chip-t')!.textContent).toBe('Pasted text.txt');
});

test("the composer is one row: the + , the words, then the permission, the model and send, in that order, and the page note above them (owner, 2026-11-12)", () => {
 const {view}=mount();
 const row=view.el.querySelector<HTMLElement>(":scope > .cmp-row")!;
 // The row's own children are the + , the field and the group of the other controls: no second row, no wrapper of a bar under the words.
 expect([...row.children].map(child=>child.className.split(" ").find(name=>name.startsWith("cmp-")))).toEqual(["cmp-attach","cmp-field","cmp-end"]);
 const end=row.querySelector<HTMLElement>(":scope > .cmp-end")!;
 expect([...end.children].map(child=>child.className.split(" ").find(name=>name.startsWith("cmp-")))).toEqual(["cmp-mode","cmp-model","cmp-pair"]);
 expect(view.el.querySelector(".cmp-bar")).toBeNull();
 // What can stand over the words is a row of the box before the controls', so the controls stay on the box's last line.
 const order=[...view.el.children].map(child=>child.className.split(" ").find(name=>name.startsWith("cmp-")));
 expect(order.indexOf("cmp-quote")).toBeLessThan(order.indexOf("cmp-row"));
 expect(order.indexOf("cmp-file")).toBeLessThan(order.indexOf("cmp-row"));
 expect(order.indexOf("cmp-page-note")).toBeLessThan(order.indexOf("cmp-row"));
 expect(order.indexOf("cmp-row")).toBe(order.length-2);
 expect(order[order.length-1]).toBe("cmp-picker");
});
