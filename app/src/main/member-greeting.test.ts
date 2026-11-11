// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { greetingHTML, mountGreeting } from "./member-greeting";
import type { AgentTurn } from "./types";

test("the shared choice form sends exactly the option or free text through the ordinary send callback", () => {
  const turn = {id: 7, route:"greeting", text:"What outcome should we work toward?", detail:JSON.stringify({kind:"greeting",options:["Help me clear important mail"]})} as AgentTurn;
  const thread = document.createElement("div"), send = vi.fn();
  document.body.replaceChildren(thread); thread.innerHTML = greetingHTML(turn, true); mountGreeting(thread, send);
  expect(thread.querySelector(".owner-question-form")).not.toBeNull();
  expect(thread.querySelector("[data-owner-question]")).toBeNull();
  thread.querySelector<HTMLButtonElement>("[data-greeting-option]")!.click();
  expect(send).toHaveBeenLastCalledWith("Help me clear important mail");
  const input = thread.querySelector<HTMLTextAreaElement>("textarea")!; input.value = "Prepare the launch"; input.dispatchEvent(new Event("input",{bubbles:true}));
  thread.querySelector<HTMLButtonElement>('[data-greeting-answer="text"]')!.click();
  expect(send).toHaveBeenLastCalledWith("Prepare the launch");
  expect(greetingHTML(turn, false)).toBe("");
  expect(greetingHTML({...turn,detail:'{"kind":"greeting","options":[{}]}'},true)).toBe("");
});
