// The same composer shell in member conversations, rooms and the team board. Member conversations
// own their existing hotkey/attachment lifecycle; room composers keep their draft until delivery.
import { cardFailure, cardHTML } from "./card";
import * as api from "./api";
import { cancelGesture } from "../shared/cancel-gesture";
import "../shared/cancel-gesture.css";
import "../shared/task-action.css";
import { bindComposerHistory } from "./composer-history";
import { bindComposerLearning, learnComposerCorrections } from "./composer-learning";
import { ATTACH_MAX, FILE_MAX_BYTES, TOTAL_MAX_BYTES, attachRefusal, base64Of, bindFilePaste, draftFileHTML, fileMime } from "./attachments";
import { avatarHTML } from "./avatar";
import { wholeLinks } from "./composer-links";
import { describeError } from "./format";
import { getLocale, onLocaleChange, t } from "./i18n";
import type { WireAttachment } from "./types";
import { esc, ico, iconButton, openMenu, patchHTML, sendGlyph, toaster } from "./ui";
import "./agent.css";

/** `recording`: the owner is speaking into this composer and the button that ends it sends what was said. */
export type ComposerTaskState = "idle" | "ack" | "running" | "waiting" | "recording";

/**
 * The one button of the composer's right-hand slot (`.cmp-voice`): the voice emblem while idle; while recording the send
 * glyph, since pressing it sends what was said; the Stop square only once something has been sent, for as long as that runs.
 * It is the same 32px button in every state, so a press never moves it.
 */
export function drawTaskSlot(el: HTMLElement, state: ComposerTaskState, stopping = false): void {
  el.dataset.taskState = state;
  const button = el.querySelector<HTMLButtonElement>(".cmp-voice")!, sends = state === "recording";
  button.classList.toggle("task-action", state !== "idle");
  button.dataset.tooltip = state === "idle" ? button.getAttribute("aria-label") ?? t("agent.voice") : t(sends ? "chat.send" : "rooms.stop");
  if (state !== "idle") {
    patchHTML(button, sends ? sendGlyph() : ico("stop"));
    button.setAttribute("aria-label", t(sends ? "chat.send" : stopping ? "rooms.stopping" : "rooms.stop"));
    button.removeAttribute("title");
    button.disabled = stopping && !sends;
  }
  cancelGesture(el.ownerDocument).sync();
}

export function composerHTML(): string {
  return `<div class="cmp-quote" hidden></div><div class="cmp-file" hidden></div><div class="cmp-row">` +
    `<div class="cmp-field"><textarea class="cmp-input" rows="1" autocomplete="off" enterkeyhint="send"></textarea><div class="cmp-mirror" aria-hidden="true"></div></div>` +
    `<div class="cmp-bar"><button type="button" class="btn cmp-attach" data-act="attach">${ico("plus")}</button>` +
    `<button type="button" class="btn sm cmp-mode" aria-haspopup="menu" aria-expanded="false">${ico("shield")}<span></span></button>` +
    `<span class="cmp-bar-fill"></span><span class="cmp-model"></span>` +
    `<span class="cmp-pair">` +
    iconButton("send", t("chat.send"), " disabled", "cmp-send task-action").replace('type="button"', 'type="submit"').replace(" title=", " data-tooltip=").replace(ico("send"), sendGlyph()) +
    `<button type="button" class="btn cmp-voice" data-act="voice"></button></span></div></div><input class="cmp-picker" type="file" multiple hidden>`;
}

const MODE_CHANGED = "raphael:action-mode";
type ActionMode = "direct" | "ask" | "plan" | "bypass";
const MODES = {
  direct: { name: "chat.modeDirect", hint: "chat.modeDirectHint" },
  ask: { name: "chat.modeAsk", hint: "chat.modeAskHint" },
  plan: { name: "chat.modePlan", hint: "chat.modePlanHint" },
  bypass: { name: "chat.modeBypass", hint: "chat.modeBypassHint" },
} as const;
/** The one global choice of what a member may do without asking, named where the owner writes. */
export function bindActionMode(button: HTMLElement): void {
  let mode: ActionMode = "direct";
  const name = (value: ActionMode): string => t(MODES[value].name);
  const draw = (): void => {
    button.querySelector("span")!.textContent = name(mode);
    button.setAttribute("aria-label", `${t("chat.beforeAct")}: ${name(mode)}`);
  };
  const read = async (): Promise<void> => {
    try { mode = (await api.core<{ settings: { action_mode?: ActionMode } }>("settings.get"))?.settings?.action_mode ?? "direct"; draw(); }
    catch { /* A reconnecting core keeps the last answer; saving still requires the core. */ }
  };
  button.addEventListener("click", () => {
    const modes = Object.keys(MODES) as ActionMode[];
    openMenu(button, modes.map(value => ({ value, label: name(value), desc: t(MODES[value].hint) })), mode, value => {
      mode = value as ActionMode; draw();
      void api.core("settings.set", { key: "action_mode", value }).then(() => window.dispatchEvent(new Event(MODE_CHANGED))).catch(error => toaster.info(describeError(error)));
    }, t("chat.beforeAct"), [], { placement: "above" });
  });
  window.addEventListener(MODE_CHANGED, () => void read());
  onLocaleChange(draw);
  draw(); void read();
}

export function wavBytes(channels: readonly Float32Array[], rate: number): Uint8Array {
  const length = channels[0]?.length ?? 0, bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => { for (let i=0;i<value.length;i++) bytes[at+i]=value.charCodeAt(i); };
  text(0,"RIFF"); view.setUint32(4,bytes.length-8,true); text(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){const sample=Math.max(-1,Math.min(1,channels.reduce((sum,c)=>sum+c[i],0)/channels.length));view.setInt16(44+i*2,sample*(sample<0?32768:32767),true);}
  return bytes;
}

export function createChatComposer(options: { placeholder(): string; transcriptTarget?(): (text: string) => void; send(text: string, files: WireAttachment[]): Promise<void>; stopTask?(): Promise<void> }) {
  const el=document.createElement("form");el.className="composer";el.noValidate=true;el.innerHTML=composerHTML();
  const input=el.querySelector<HTMLTextAreaElement>("textarea")!,send=el.querySelector<HTMLButtonElement>(".cmp-send")!,voice=el.querySelector<HTMLButtonElement>(".cmp-voice")!,picker=el.querySelector<HTMLInputElement>(".cmp-picker")!;
  const learning=bindComposerLearning(input);bindComposerHistory(input,()=>api.agentSent());
  let taskRun=0, discardVoice=false, transcribing=false;
  let revision=0, taskState: ComposerTaskState = "idle", stoppingTask = false;
  el.addEventListener("click",e=>e.stopPropagation());
  let files:WireAttachment[]=[],drawnFiles:WireAttachment[]|null=null,attachQueue:Promise<void>=Promise.resolve(),attaching=0,busy=false,recording=false,starting=false,stream:MediaStream|undefined,recorder:MediaRecorder|undefined;
  const draw=():void=>{input.placeholder=options.placeholder();input.setAttribute("aria-label",input.placeholder);send.disabled=busy||attaching>0||recording||starting||(!input.value.trim()&&!files.length);if(!recording&&!transcribing&&taskState==="idle")patchHTML(voice,avatarHTML({size:32,avatar:null,loop:recording}));voice.setAttribute("aria-label",t(recording?"rooms.stopVoice":"agent.voice"));voice.setAttribute("aria-pressed",String(recording));voice.disabled=starting||transcribing||(busy&&!transcribing);drawTaskSlot(el,recording||transcribing?"recording":taskState,stoppingTask);voice.disabled ||= starting||transcribing;el.querySelector(".cmp-attach")!.setAttribute("aria-label",t("agent.attach"));drawFiles();};
  // Drawn only when the files change: a picture is not decoded again at each keystroke.
  const drawFiles=():void=>{if(drawnFiles===files)return;drawnFiles=files;const chips=el.querySelector<HTMLElement>(".cmp-file")!;chips.hidden=!files.length;chips.replaceChildren(...files.map((f,i)=>{const chip=document.createElement("span");chip.className="cmp-chip";chip.innerHTML=draftFileHTML({name:f.name,mime:f.mime,size:Math.round(f.data.length*0.75)},`data-file="${i}" aria-label="${esc(t("agent.unattach"))}"`);const thumb=chip.querySelector<HTMLImageElement>(".cmp-thumb");if(thumb)thumb.src=`data:${f.mime};base64,${f.data}`;return chip;}));};
  /** 「＋」, a paste or a drop, one file after the other. One that cannot be taken says why and the rest are still taken, but for too many, which ends it. */
  const addFiles=(list:readonly File[]):void=>{const mine=revision;attaching++;draw();attachQueue=attachQueue.then(async()=>{for(const file of list){if(mine!==revision)break;const mime=fileMime(file),name=file.name.trim()||`image.${mime.slice(mime.indexOf("/")+1)}`,refusal=attachRefusal(files.length,mime,file.size,files.reduce((n,f)=>n+f.data.length*0.75,0));if(refusal==="count"){toaster.info(t("agent.attachTooMany",{p0:ATTACH_MAX}));break;}if(refusal==="size"){toaster.info(t("agent.attachTooBig",{p0:name,p1:FILE_MAX_BYTES/1024/1024}));continue;}if(refusal==="total"){toaster.info(t("agent.attachTotal",{p0:TOTAL_MAX_BYTES/1024/1024}));continue;}try{if(refusal==="empty")throw new Error("empty");const data=base64Of(new Uint8Array(await file.arrayBuffer()));if(mine===revision){files=[...files,{name,mime,data}];draw();}}catch{toaster.info(t("agent.attachUnreadable",{p0:name}));}}}).finally(()=>{attaching--;draw();});};
  // The field sizes itself to its text (`.cmp-input` in agent.css).
  const fit=():void=>{draw();};
  el.addEventListener("submit", e => {
    e.preventDefault();
    if (send.disabled) return;
    el.querySelector(".composer-failure")?.remove();
    const text = input.value, snapshot = files, submitted = revision;
    const dictation = learning.snapshot(), corrections = learning.take(text);
    input.value = ""; files = [];
    input.dispatchEvent(new Event("composer-draft-restored"));
    if (options.stopTask) taskState = "ack";
    fit();
    void options.send(wholeLinks(text).trim(), snapshot).then(() => {
      void learnComposerCorrections(corrections);
    }).catch(() => {
      if (submitted !== revision) return;
      if (!learning.snapshot()) learning.restore(dictation);
      input.value = [input.value, text].filter(Boolean).join("\n\n");
      files = [...files, ...snapshot];
      let failed = el.querySelector<HTMLElement>(".composer-failure");
      if (!failed) { failed = document.createElement("div"); failed.className = "composer-failure"; el.prepend(failed); }
      failed.innerHTML = cardHTML({title: t("cards.sendFailed"), status: "failed"});
      cardFailure(failed.firstElementChild, () => el.requestSubmit(), () => failed?.remove());
    }).finally(() => { if (submitted === revision) { fit(); input.focus(); } });
  });
  input.addEventListener("input",fit);input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();el.requestSubmit();}});
  el.querySelector<HTMLElement>(".cmp-attach")!.addEventListener("click",()=>{picker.value="";picker.click();});bindActionMode(el.querySelector<HTMLElement>(".cmp-mode")!);
  el.querySelector(".cmp-file")!.addEventListener("click",e=>{const button=(e.target as Element).closest<HTMLElement>("[data-file]");if(button){files=files.filter((_,i)=>i!==Number(button.dataset.file));draw();}});
  picker.addEventListener("change",()=>addFiles([...picker.files??[]]));bindFilePaste(input,addFiles,fit,()=>files.map(file=>file.name));
  const release=():void=>{stream?.getTracks().forEach(track=>track.stop());stream=undefined;recording=false;draw();};
  const stop=():void=>{if(recorder?.state==="recording")recorder.stop();};
  const cancelVoice=():void=>{if(!starting&&!recording&&!transcribing)return;taskRun++;discardVoice=true;starting=false;transcribing=false;busy=false;stop();release();};
  voice.addEventListener("click",()=>{
    if(transcribing)return;
    if(taskState!=="idle"){if(stoppingTask)return;stoppingTask=true;draw();void options.stopTask?.().catch(error=>toaster.info(describeError(error))).finally(()=>{stoppingTask=false;draw();});return;}
    if(recording){stop();return;}if(starting)return;
    starting=true;const run=++taskRun, destinationRevision=revision;
    const transcript=options.transcriptTarget?.()??((text:string)=>{input.value+=(input.value?" ":"")+text;learning.seed(input.value,text);});
    draw();void(async()=>{
      const acquired=await navigator.mediaDevices.getUserMedia({audio:true});
      if(run!==taskRun||destinationRevision!==revision){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;
      const chunks:Blob[]=[];recorder=new MediaRecorder(stream);
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onerror=()=>{if(run!==taskRun)return;discardVoice=true;stop();release();toaster.info(t("rooms.voiceFailed"));};
      recorder.onstop=()=>{
        if(run!==taskRun)return;
        release();if(discardVoice){discardVoice=false;return;}
        let handedOff=false;
        busy=true;transcribing=true;draw();
        void(async()=>{
          const audio=new AudioContext();
          try{
            const decoded=await audio.decodeAudioData(await new Blob(chunks).arrayBuffer());
            if(run!==taskRun)return;
            const data=wavBytes(Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i)),decoded.sampleRate);
            const result=await api.roomTranscribe(base64Of(data),getLocale());
            if(run!==taskRun)return;
            if(destinationRevision!==revision)return;
            if(result.text.trim()){transcript(result.text);fit();}
            busy=false;transcribing=false;draw();
            if(result.text.trim()){handedOff=true;el.requestSubmit();}else toaster.info(t("chat.voiceEmpty"));
          }finally{await audio.close();}
        })().catch(error=>{if(run===taskRun)toaster.info(t("chat.voiceFailed",{p0:describeError(error)}));}).finally(()=>{if(run===taskRun){if(!handedOff)busy=false;transcribing=false;draw();}});
      };
      discardVoice=false;recorder.start(1000);recording=true;
    })().catch(error=>{if(run!==taskRun)return;release();toaster.info(error instanceof DOMException && error.name==="NotAllowedError" ? t("chat.microphoneDenied") : describeError(error));}).finally(()=>{if(run===taskRun)starting=false;draw();});
  });
  cancelGesture().register(() => (starting || recording || transcribing || taskState !== "idle") ? { key: `composer:${revision}:${taskRun}:${recording}:${transcribing}`, immediate: starting || recording || transcribing, button: voice, hint: t("common.cancelAgain"), cancel: () => { if(starting||recording||transcribing)cancelVoice();else voice.click(); } } : null);
  onLocaleChange(()=>{drawnFiles=null;draw();});draw();
  return {el,input,draw,addFiles,snapshot:()=>({text:input.value,files:[...files]}),setTaskState(state:ComposerTaskState){if(taskState==="idle"&&state!=="idle")taskRun++;taskState=state;draw();},stopVoice:cancelVoice,seedDictation(text:string){learning.seed(input.value,text);},setDraft(text:string,draftFiles:WireAttachment[]=[]){cancelVoice();learning.clear();revision++;input.dispatchEvent(new Event("composer-draft-restored"));input.value=text;files=[...draftFiles];fit();input.setSelectionRange(text.length,text.length);}};
}
