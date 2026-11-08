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
  routines: [{ title: "transcript-healthcheck", prompt: "Review bot conversations for friction.", schedule: { kind: "daily", time: "08:44" } as never, when: null as never,
    description: "On weekday mornings, review conversations and suggest fixes.", fires_on: "Weekdays 08:44 (cron 44 8 * * 1-5)", ask: ["Timezone"] }],
  connections: ["github"], description: "Plans focused sample projects.", memories: ["Healthchecks stay quiet when there is nothing to propose."], updated_at_ms: new Date(2026, 10, 8).getTime(),
};
const parse = (html: string): HTMLElement => { const host = document.createElement("div"); host.innerHTML = html; return host; };

describe("the review's pages", () => {
  test("the first page: name, last updated, what it is for, and three rows saying what each holds", () => {
    const { body } = reviewPageHTML(template, { kind: "main" });
    const page = parse(body);
    expect(page.querySelector(".tpr-hero b")!.textContent).toBe("Sample Planner");
    expect(page.querySelector(".tpr-hero small")!.textContent).toContain("最後更新");
    expect(page.querySelector(".tpr-hero p")!.textContent).toBe("Plans focused sample projects.");
    expect([...page.querySelectorAll<HTMLElement>(".tpr-row")].map(row => [row.dataset.tplGo, row.querySelector(".tpr-row-t > span")!.textContent]))
      .toEqual([["context", "指示、記憶、技能"], ["routines", "transcript-healthcheck"], ["integrations", "GitHub"]]);
  });

  test("內容 holds the instructions, the personality, the memories and a row per skill; a skill reads without its front matter", () => {
    const context = parse(reviewPageHTML(template, { kind: "context" }).body);
    expect([...context.querySelectorAll(".tpr-field > h4")].map(h => h.textContent)).toEqual(["指示", "個性", "記憶", "技能"]);
    expect(context.querySelector('[data-tpl-go="skill:0"]')!.textContent).toContain("Project planner getting started");
    const skill = reviewPageHTML(template, { kind: "skill", index: 0 });
    expect(skill.title).toBe("Project planner getting started");
    expect(parse(skill.body).textContent).toContain("Ask three questions first.");
    expect(parse(skill.body).textContent).not.toContain("---");
  });

  test("a routine: its description, content, trigger (starting paused) and what an importer is asked", () => {
    const routine = reviewPageHTML(template, { kind: "routine", index: 0 });
    expect(routine.title).toBe("transcript-healthcheck");
    const page = parse(routine.body);
    expect([...page.querySelectorAll(".tpr-field > h4")].map(h => h.textContent)).toEqual(["說明", "內容", "觸發方式", "匯入時會問"]);
    expect(page.textContent).toContain("cron 44 8 * * 1-5");
    expect(page.textContent).toContain("匯入後先暫停");
    expect(page.textContent).toContain("Timezone");
  });

  test("an older template without the new fields still reads, and nothing repeats", () => {
    const old: MemberTemplate = { ...template, description: undefined, memories: undefined, updated_at_ms: undefined,
      routines: [{ title: "Daily", prompt: "Check sources.", schedule: { kind: "daily", time: "09:00" } as never, when: null as never }] };
    const main = parse(reviewPageHTML(old, { kind: "main" }).body);
    expect(main.querySelector(".tpr-hero small")).toBeNull();
    expect(main.querySelector(".tpr-hero p")!.textContent).toBe("Project planner");
    const routine = parse(reviewPageHTML(old, { kind: "routine", index: 0 }).body);
    expect([...routine.querySelectorAll(".tpr-field > h4")].map(h => h.textContent)).toEqual(["內容", "觸發方式"]);
  });
});
