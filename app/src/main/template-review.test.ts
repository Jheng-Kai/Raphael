// @vitest-environment happy-dom
// A template reviewed as separate pages: a first page of who it is and three rows that open
// pages; a page has a back arrow and its title; each part reads in full.
import { describe, expect, test } from "vitest";
import type { MemberTemplate } from "./member-templates";
import { reviewPageHTML } from "./template-review";

const template: MemberTemplate = {
  format: "raphael-member", version: 1, name: "Sample Planner", role: "Project planner", personality: "Calm and methodical.",
  instructions: "Plan projects with one clear goal.", reply_style: "full",
  skills: [{ text: "---\nname: Project planner getting started\ndescription: How to start a bot\n---\nAsk three questions first." }],
  routines: [{ title: "transcript-healthcheck", prompt: "Review bot conversations for friction.", schedule: { kind: "weekdays", time: "08:44" } as never, when: null }],
  connections: ["github"], description: "Plans focused sample projects.",
};
const parse = (html: string): HTMLElement => { const host = document.createElement("div"); host.innerHTML = html; return host; };

describe("the review's pages", () => {
  test("the first page: name, what it is for, and three rows saying what each holds", () => {
    const { body } = reviewPageHTML(template, { kind: "main" });
    const page = parse(body);
    expect(page.querySelector(".tpr-hero b")!.textContent).toBe("Sample Planner");
    expect(page.querySelector(".tpr-hero small")).toBeNull();
    expect(page.querySelector(".tpr-hero p")!.textContent).toBe("Plans focused sample projects.");
    expect([...page.querySelectorAll<HTMLElement>(".tpr-row")].map(row => [row.dataset.tplGo, row.querySelector(".tpr-row-t > span")!.textContent]))
      .toEqual([["context", "指示、技能"], ["routines", "transcript-healthcheck"], ["integrations", "GitHub"]]);
  });

  test("內容 holds the role, instructions, personality, reply style and a row per skill; a skill reads without its front matter", () => {
    const context = parse(reviewPageHTML(template, { kind: "context" }).body);
    expect([...context.querySelectorAll(".tpr-field > h4")].map(h => h.textContent)).toEqual(["角色", "指示", "個性", "回覆風格", "技能"]);
    expect(context.querySelector('[data-tpl-go="skill:0"]')!.textContent).toContain("Project planner getting started");
    const skill = reviewPageHTML(template, { kind: "skill", index: 0 });
    expect(skill.title).toBe("Project planner getting started");
    expect(parse(skill.body).textContent).toContain("Ask three questions first.");
    expect(parse(skill.body).textContent).not.toContain("---");
  });

  test("a routine: its content and its trigger in words, starting paused; an importer is asked nothing", () => {
    const routine = reviewPageHTML(template, { kind: "routine", index: 0 });
    expect(routine.title).toBe("transcript-healthcheck");
    const page = parse(routine.body);
    expect([...page.querySelectorAll(".tpr-field > h4")].map(h => h.textContent)).toEqual(["內容", "觸發方式"]);
    expect(page.textContent).toContain("08:44");
    expect(page.textContent).toContain("匯入後先暫停");
  });

  test("a template without a description reads as its role, and nothing repeats", () => {
    const old: MemberTemplate = { ...template, description: undefined,
      routines: [{ title: "Daily", prompt: "Check sources.", schedule: { kind: "daily", time: "09:00" } as never, when: null }] };
    const main = parse(reviewPageHTML(old, { kind: "main" }).body);
    expect(main.querySelector(".tpr-hero small")).toBeNull();
    expect(main.querySelector(".tpr-hero p")!.textContent).toBe("Project planner");
    const routine = parse(reviewPageHTML(old, { kind: "routine", index: 0 }).body);
    expect([...routine.querySelectorAll(".tpr-field > h4")].map(h => h.textContent)).toEqual(["內容", "觸發方式"]);
  });
});
