// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { mountDesktopTimeline, type DesktopWork } from "./desktop-timeline";
import { setLocale } from "./i18n";
afterEach(()=>document.body.replaceChildren());
test('a member working at its computer adds nothing to the conversation, and only a handoff the owner must act on is drawn',()=>{
  setLocale('zh-TW');document.body.innerHTML='<ol><li data-desktop-slot="42"></li><li data-desktop-slot="43"></li></ol>';
  const host=document.querySelector('ol')!,timeline=mountDesktopTimeline(host);
  const work:DesktopWork={id:'task',turn_id:42,state:'running',tool:'click',reason:''};
  for(const state of ['running','done','stopped','expired'] as const){
    timeline.update({state:'running',ready:true,control:'member',works:[{...work,state}]});
    expect(host.querySelector('[data-desktop-work],.conversation-event-line,.conversation-card')).toBeNull();expect(host.textContent).toBe('');
  }
  timeline.update({state:'running',ready:true,control:'member',works:[{...work,state:'waiting_control',reason:'two_factor'}]});expect(host.textContent).toContain('雙重驗證');
  host.innerHTML='<li data-desktop-slot="42"></li>';timeline.sync();expect(host.querySelectorAll('.conversation-card')).toHaveLength(1);
  timeline.clear();expect(host.textContent).toBe('');
});

test('handed-back computer work retains a compact settled card and folded decision',()=>{
 document.body.innerHTML='<div data-desktop-slot="42"></div>';
 const timeline=mountDesktopTimeline(document.body),work:DesktopWork={id:'work',turn_id:42,state:'waiting_control',reason:'sign_in',tool:'get_desktop_state'};
 timeline.update({state:'running',ready:true,control:'member',works:[work]});
 timeline.update({state:'running',ready:true,control:'member',works:[{...work,state:'running',reason:''}]});
 expect(document.querySelector('.conversation-card[data-desktop-settled="handed_back"]')).not.toBeNull();
 expect(document.querySelector('.card-detail[hidden]')).not.toBeNull(); expect(document.querySelector('[data-card-desktop]')).toBeNull();
});


test('a refreshed handback retains its settled card from the existing request metadata',()=>{
 document.body.innerHTML='<div data-desktop-slot="42"></div>';
 mountDesktopTimeline(document.body).update({state:"running",ready:true,control:"member",works:[{id:"work",request_id:"nonce",turn_id:42,state:"running",reason:"",tool:"get_desktop_state"}]});
 expect(document.querySelector('.conversation-card[data-desktop-settled="handed_back"]')).not.toBeNull();
});

test('a settled handoff says what the owner did, with no status pill and no word about the live state of the work (R-CARD-15, R-COMP-HANDOFF-01)',()=>{
 setLocale('zh-TW');document.body.innerHTML='<div data-desktop-slot="42"></div>';
 const timeline=mountDesktopTimeline(document.body),work:DesktopWork={id:'work',turn_id:42,state:'waiting_control',reason:'sign_in',tool:'get_desktop_state'};
 timeline.update({state:'running',ready:true,control:'member',works:[work]});
 // The member went on working: the work is `running`, and the conversation's presence line says so. The card never repeats it.
 for(const tool of ['click','type_text','get_desktop_state','something_else']){
  timeline.update({state:'running',ready:true,control:'member',works:[{...work,state:'running',reason:'',tool}]});
  const card=document.querySelector<HTMLElement>('.conversation-card')!;
  expect(card.dataset.desktopSettled).toBe('handed_back');
  expect(card.querySelector('.card-status')).toBeNull();expect(card.querySelector('.is-done')).toBeNull();
  expect(card.querySelector('.card-body')!.textContent).toBe('已交回');
  expect(card.querySelector('.card-detail')!.textContent).toBe('電腦已交還。');
  for(const word of ['完成','正在使用電腦','點擊','輸入'])expect(card.textContent).not.toContain(word);
 }
 // The work ended meanwhile: the handoff was still handed back, and it is not called finished work.
 timeline.update({state:'running',ready:true,control:'member',works:[{...work,state:'done',reason:''}]});
 expect(document.querySelector('.conversation-card')!.textContent).not.toContain('完成');
 expect(document.querySelector('.conversation-card .card-body')!.textContent).toBe('已交回');
});

test('a handoff the owner skipped says so, and the fold says the computer work stopped',()=>{
 setLocale('zh-TW');document.body.innerHTML='<div data-desktop-slot="42"></div>';
 const timeline=mountDesktopTimeline(document.body),work:DesktopWork={id:'work',turn_id:42,state:'waiting_control',reason:'password',tool:'get_desktop_state'};
 timeline.update({state:'running',ready:true,control:'member',works:[work]});
 for(const state of ['stopped','expired'] as const){
  timeline.update({state:'running',ready:true,control:'member',works:[{...work,state,reason:''}]});
  const card=document.querySelector<HTMLElement>('.conversation-card')!;
  expect(card.dataset.desktopSettled).toBe('skipped');expect(card.querySelector('.card-status')).toBeNull();
  expect(card.querySelector('.card-body')!.textContent).toBe('已略過');expect(card.querySelector('.card-detail')!.textContent).toBe('電腦工作已停止');
 }
});

test('every language says what a settled handoff is, in its own words',async()=>{
 const { catalogs } = await import('./i18n');
 for(const [locale,catalog] of Object.entries(catalogs)){
  const messages=catalog as Record<string,string>;
  for(const key of ['desktop.handedBack','desktop.skipped','desktop.handedBackDetail'])expect(messages[key]?.trim(),`${locale} ${key}`).toBeTruthy();
  if(locale!=='en')expect(messages['desktop.handedBack'],locale).not.toBe(catalogs.en['desktop.handedBack']);
 }
});
