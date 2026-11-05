// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { setLocale } from "./i18n";
import { routineSentenceHTML } from "./members";
import { routineLineHTML } from "./timeline";
import type { Routine, AgentTurn } from "./types";

test.each(["en", "zh-TW", "ja"] as const)("trigger sentences weight the verb and quiet the object in %s", locale => {
  setLocale(locale);
  const html = routineSentenceHTML({schedule:{kind:"monthly",day:31,time:"08:00"}});
  document.body.innerHTML = html;
  expect(document.querySelector('.i')).not.toBeNull();
  expect(document.querySelector('strong')!.textContent).toBeTruthy();
  expect(document.querySelector('.routine-object')!.textContent).toContain('31');
  expect(document.querySelector('.routine-object')!.textContent).toContain('08:00');
  const webhook = routineSentenceHTML({schedule:null,when:{webhook:true}} as Pick<Routine,'schedule'|'when'>);
  expect(webhook).toContain('POST');
});

test("a routine transcript line names the routine and opens the exact routine", () => {
  setLocale('en');
  const html = routineLineHTML({id:12,question:'Sample routine',routine:{id:4,schedule:null,when:{webhook:true}}} as unknown as AgentTurn);
  document.body.innerHTML=html;
  expect(document.querySelector('button[data-act="open-routine"]')?.getAttribute('data-routine')).toBe('4');
  expect(document.querySelector('.routine-origin')?.textContent).toContain('Sample routine');
  expect(document.body.textContent).not.toContain('POST');
});
