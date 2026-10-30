// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { mountDesktopTimeline, type DesktopWork } from "./desktop-timeline";
import { setLocale } from "./i18n";
afterEach(()=>document.body.replaceChildren());
test('one metadata-only system event follows its private turn and redraws without streams or controls',()=>{
  setLocale('zh-TW');document.body.innerHTML='<ol><li data-desktop-slot="42"></li><li data-desktop-slot="43"></li></ol>';
  const host=document.querySelector('ol')!,timeline=mountDesktopTimeline(host,()=>"小晴");
  const work:DesktopWork={id:'task',turn_id:42,state:'running',tool:'click',reason:''};
  timeline.update({state:'running',ready:true,control:'member',works:[work]});
  expect(host.querySelectorAll('.conversation-event-line')).toHaveLength(1);expect(host.textContent).toContain('小晴');expect(host.querySelector('iframe,button,input,textarea')).toBeNull();
  timeline.update({state:'running',ready:true,control:'member',works:[{...work,state:'waiting_control',reason:'two_factor'}]});expect(host.textContent).toContain('雙重驗證');
  host.innerHTML='<li data-desktop-slot="42"></li>';timeline.sync();expect(host.querySelectorAll('.conversation-event-line')).toHaveLength(1);
  timeline.clear();expect(host.textContent).toBe('');
});
