// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { desktopWorkText, mountDesktopTimeline, type DesktopWork } from "./desktop-timeline";
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

test.each(['returning', 'running', 'done', 'stopped', 'expired', 'absent'] as const)(
  'a computer handoff leaves the conversation when the request is %s (R-CARD-15, R-COMP-HANDOFF-01)', state => {
    document.body.innerHTML = '<div data-desktop-slot="42"></div>';
    const timeline = mountDesktopTimeline(document.body);
    const work: DesktopWork = {id:'work', request_id:'nonce', turn_id:42, state:'waiting_control', reason:'sign_in', tool:'get_desktop_state'};
    const running = {state:'running', ready:true, control:'member'} as const;
    timeline.update({...running, works:[work]});
    expect(document.querySelector('.computer-card')).not.toBeNull();
    timeline.update({...running, works:state === 'absent' ? [] : [{...work, state}]});
    expect(document.querySelector('.computer-card')).toBeNull();
    expect(document.body.textContent).toBe('');
    document.body.innerHTML = '<div data-desktop-slot="42"></div>';
    timeline.sync();
    expect(document.body.textContent).toBe('');
  },
);

test('the Computer view says why Chrome could not choose the certificate by itself, in words and never as a code (R-COMP-CERT-02)', () => {
  const work: DesktopWork = {id: 'work', request_id: 'nonce', turn_id: 42, state: 'waiting_control', reason: 'certificate', tool: 'get_browser_state'};
  setLocale('en');
  expect(desktopWorkText({...work, detail: 'certificate_unmatched'})).toBe("Chrome could not choose a certificate for this site by itself. A Chrome window opened on your screen. Choose the certificate there, then press “I'm done”.");
  expect(desktopWorkText({...work, detail: 'certificate_refused'})).toContain('Your computer did not let Chrome use the certificate.');
  setLocale('zh-TW');
  expect(desktopWorkText({...work, detail: 'certificate_refused'})).toBe('電腦不允許 Chrome 使用這張憑證。螢幕上開了一個 Chrome 視窗，請在那裡選擇憑證並在詢問時允許，再按「我完成了」。');
  expect(desktopWorkText({...work, reason: 'sign_in', detail: 'certificate_refused'})).toBe('certificate_refused');
});

test('the Computer view says a Chrome window opened for the certificate, and names the button that ends the step (#345)', () => {
  const work: DesktopWork = {id: 'work', request_id: 'nonce', turn_id: 42, state: 'waiting_control', reason: 'certificate', tool: 'get_browser_state'};
  setLocale('en');
  expect(desktopWorkText(work)).toBe("A Chrome window opened on your screen. Choose the certificate there, then press “I'm done”.");
  setLocale('zh-TW');
  expect(desktopWorkText(work)).toBe('螢幕上開了一個 Chrome 視窗，請在那裡選擇憑證，再按「我完成了」。');
});
