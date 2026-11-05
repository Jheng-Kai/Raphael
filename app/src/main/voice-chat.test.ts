// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({voiceCallStart: vi.fn(), voiceCallStatus: vi.fn(), voiceCallEnd: vi.fn(), voiceCallMute: vi.fn(), voiceCallSettings: vi.fn(), voiceCallFeedback: vi.fn()}));
vi.mock("./api", () => api);
import { foldCallTurns, mountVoiceChat, voiceCallCardHTML, type VoiceCall } from "./voice-chat";
import { setLocale } from "./i18n";
import type { AgentTurn } from "./types";

const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const call = (member = 1): VoiceCall => ({id:`call-${member}`,member_id:member,conversation_id:member+10,started_at_ms:1000,ended_at_ms:84000,state:"listening",muted:false,name:"Member",avatar:"slime:shion",voice:"member-voice",speed:1,language:"auto",transcript:[{id:5,question:"<Owner>",text:"<Member>",status:"done"}]});
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); document.body.innerHTML = ""; setLocale("en");
  api.voiceCallStatus.mockResolvedValue({call:null});
  api.voiceCallStart.mockResolvedValue({call:call()});
  api.voiceCallEnd.mockResolvedValue({summary_id:6});
  api.voiceCallFeedback.mockResolvedValue({ok:true});
});
afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.useRealTimers(); });
function mount() {
  const root = document.createElement("div");
  root.innerHTML = '<form class="composer"><button type="button"></button></form>';
  document.body.append(root);
  let eligible = true, member = 1;
  const composer = root.querySelector("form")!, button = root.querySelector("button")!;
  const refresh = vi.fn();
  const controller = mountVoiceChat({root,composer,button,eligible:()=>eligible,target:()=>({member,conversation:member+10,name:"Member"}),changed:()=>{},refresh});
  return {root,composer,button,controller,refresh,eligible:(value:boolean)=>{eligible=value;controller.draw();},member:(id:number)=>{member=id;controller.draw();}};
}

test("an empty member entry starts the captured conversation and a panel replaces its composer", async () => {
  const view = mount(); await flush();
  expect(view.button.getAttribute("aria-label")).toBe("Start voice chat");
  view.button.click(); await flush();
  expect(api.voiceCallStart).toHaveBeenCalledExactlyOnceWith(1,11,"en");
  expect(view.composer.classList.contains("has-voice-call")).toBe(true);
  expect(view.controller.panel.querySelectorAll("svg.slime")).toHaveLength(1);
  view.controller.panel.querySelector<HTMLButtonElement>('[data-call-act="transcript"]')!.click();
  expect(view.controller.panel.textContent).toContain("<Owner>");
  expect(view.controller.panel.querySelector("Owner")).toBeNull();
  view.member(2);
  expect(view.controller.panel.hidden).toBe(true);
  expect(view.composer.classList.contains("has-voice-call")).toBe(false);
});

test("typed or room composers cannot start a call and busy admission never implicitly ends one", async () => {
  const view = mount(); await flush();
  view.eligible(false); view.button.click(); await flush();
  expect(api.voiceCallStart).not.toHaveBeenCalled();
  view.eligible(true);
  api.voiceCallStart.mockResolvedValue({busy:call(2)});
  view.button.click(); await flush();
  expect(document.querySelector('.vc-confirm')).not.toBeNull();
  expect(api.voiceCallEnd).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('.vc-confirm [data-dlg="cancel"]')!.click();
  expect(api.voiceCallEnd).not.toHaveBeenCalled();
});

test("end and start confirms once, mute stops recognition, hang-up restores the composer", async () => {
  const view = mount(); await flush();
  api.voiceCallStart.mockResolvedValueOnce({busy:call(2)}).mockResolvedValueOnce({call:call()});
  view.button.click(); await flush();
  document.querySelector<HTMLButtonElement>('.vc-confirm [data-dlg="replace"]')!.click(); await flush();
  expect(api.voiceCallEnd).toHaveBeenCalledExactlyOnceWith("call-2");
  api.voiceCallMute.mockResolvedValue({call:{...call(),muted:true}});
  view.controller.panel.querySelector<HTMLButtonElement>('[data-call-act="mute"]')!.click(); await flush();
  expect(api.voiceCallMute).toHaveBeenCalledExactlyOnceWith("call-1",true);
  expect(view.controller.panel.textContent).toContain("Unmute");
  view.controller.panel.querySelector<HTMLButtonElement>('[data-call-act="end"]')!.click(); await flush();
  expect(view.controller.panel.hidden).toBe(true);
  expect(view.refresh).toHaveBeenCalled();
});

test("failed service uses one shared repair action and receipt escapes a folded transcript", async () => {
  const view = mount(); await flush();
  api.voiceCallStart.mockResolvedValue({failure:"microphone"});
  view.button.click(); await flush();
  expect(view.root.querySelectorAll('[data-missing-repair="dictation"]')).toHaveLength(1);
  const receipt = voiceCallCardHTML(call(), "<Member>");
  expect(receipt).toContain("1:23");
  expect(receipt).toContain('data-card-status-text>Ended</span>');
  expect(receipt).toContain("&lt;Owner&gt;");
  expect(receipt).not.toContain("<Owner>");
  const summary = {id:6,voice_call:call()} as AgentTurn;
  expect(foldCallTurns([{id:5,voice_call_id:"call-1"} as AgentTurn,summary])).toEqual([summary]);
});

test("a durable failed receipt carries the repair once and a lost bridge retries hang-up", async () => {
  const view = mount(); await flush();
  view.button.click(); await flush();
  api.voiceCallStatus.mockRejectedValueOnce(new Error("disconnected"));
  await vi.advanceTimersByTimeAsync(500);
  expect(view.controller.active()).toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  expect(api.voiceCallEnd).toHaveBeenCalledExactlyOnceWith("call-1");
  const failed = {...call(),failure:"microphone",summary_id:6};
  const html = voiceCallCardHTML(failed,"Member");
  expect(html.match(/data-missing-repair="dictation"/g)).toHaveLength(1);
  expect(html.match(/No microphone is available/g)).toHaveLength(1);
});

test("call folding keeps owner decisions actionable until their existing cards settle", () => {
  const pending = {id:5,voice_call_id:"call-1",status:"confirm",permissions:[{state:"pending"}]} as AgentTurn;
  const setup = {id:7,voice_call_id:"call-1",status:"done",connectors:[{state:"pending"}]} as AgentTurn;
  expect(foldCallTurns([pending,setup])).toEqual([pending,setup]);
  expect(foldCallTurns([{...pending,status:"done",permissions:[]},{...setup,connectors:[]}])).toEqual([]);
});
