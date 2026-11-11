// @vitest-environment happy-dom
// The front end and the core must agree on what a shared member holds. core/tests/fixtures/member-template/full.raphael-member
// is one recipe with every field raphael-member v1 has; core/tests/members/test_templates.py proves the core accepts it whole and
// refuses any other field, and this file proves the TypeScript type names exactly those fields and the review shows all of them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { connectionName, type MemberTemplate } from "./member-templates";
import { NAME_MAX, ROLE_MAX } from "./members";
import { routineText } from "./members";
import { reviewPageHTML, type ReviewPage } from "./template-review";
import { t } from "./i18n";
import { de } from "./i18n/de";
import { en } from "./i18n/en";
import { es } from "./i18n/es";
import { fr } from "./i18n/fr";
import { id } from "./i18n/id";
import { it as itLocale } from "./i18n/it";
import { ja } from "./i18n/ja";
import { ko } from "./i18n/ko";
import { ptBR } from "./i18n/pt-BR";
import { ru } from "./i18n/ru";
import { th } from "./i18n/th";
import { tr } from "./i18n/tr";
import { vi } from "./i18n/vi";
import { zhCN } from "./i18n/zh-CN";
import { zhTW } from "./i18n/zh-TW";

const root = resolve(__dirname, "../../..");
const fixture = JSON.parse(readFileSync(resolve(root, "core/tests/fixtures/member-template/full.raphael-member"), "utf8")) as MemberTemplate;

/** The property names of an interface in the source, and which of them may be left out. */
function fields(name: string): { all: string[]; optional: string[] } {
  const path = resolve(__dirname, "member-templates.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === name);
  expect(declaration, `interface ${name}`).toBeDefined();
  const members = declaration!.members.filter(ts.isPropertySignature);
  return { all: members.map(member => member.name.getText()).sort(), optional: members.filter(member => member.questionToken).map(member => member.name.getText()).sort() };
}

describe("the MemberTemplate type is the core's recipe", () => {
  test("a template holds the fixture's fields and no other, and only the description may be left out", () => {
    expect(fields("MemberTemplate")).toEqual({ all: Object.keys(fixture).sort(), optional: ["description"] });
  });

  test("a skill holds its text and optional files, a routine its title, prompt and trigger", () => {
    expect(fields("TemplateSkill")).toEqual({ all: ["files", "text"], optional: ["files"] });
    expect(Object.keys(fixture.skills[0]!).sort()).toEqual(["files", "text"]);
    const routine = fields("TemplateRoutine");
    expect(routine.all).toEqual(Object.keys(fixture.routines[0]!).sort());
    expect(routine.optional).toEqual([]);
  });

  test("the fixture shows both kinds of trigger, so each is read by the review", () => {
    expect(fixture.routines.map(routine => [routine.schedule === null, routine.when === null]).sort()).toEqual([[false, true], [true, false]]);
  });
});

describe("a member's name and role are as long as the core says, in every field of sharing", () => {
  const store = readFileSync(resolve(root, "core/src/raphael_core/members/store.py"), "utf8");
  const limit = (name: string): number => Number(new RegExp(`^${name} = ([0-9]+)`, "m").exec(store)![1]);

  test("the window's limits are the core's", () => {
    expect(NAME_MAX).toBe(limit("NAME_MAX"));
    expect(ROLE_MAX).toBe(limit("ROLE_MAX"));
  });
});

describe("the review shows everything a shared member holds", () => {
  const pages: ReviewPage[] = [{ kind: "main" }, { kind: "context" }, ...fixture.skills.map((_, index) => ({ kind: "skill", index }) as ReviewPage),
    { kind: "routines" }, ...fixture.routines.map((_, index) => ({ kind: "routine", index }) as ReviewPage), { kind: "integrations" }];
  const text = pages.map(page => { const { title, body } = reviewPageHTML(fixture, page); const host = document.createElement("div"); host.innerHTML = body; return `${title}\n${host.textContent}`; }).join("\n");

  test("who it is, what it is for, its instructions and personality, how it replies", () => {
    for (const value of [fixture.name, fixture.role, fixture.description!, fixture.instructions, fixture.personality, t("members.profile.conversational")]) expect(text).toContain(value);
  });

  test("each skill with its name, description, text and files", () => {
    expect(text).toContain("clarity-check");
    expect(text).toContain("Read a guide as a newcomer would");
    expect(text).toContain("mark every unexplained word");
    for (const [path, content] of Object.entries(fixture.skills[0]!.files!)) { expect(text).toContain(path); expect(text).toContain(content); }
  });

  test("each routine with its title, prompt and trigger in words, starting paused", () => {
    for (const routine of fixture.routines) { expect(text).toContain(routine.title); expect(text).toContain(routine.prompt); expect(text).toContain(routineText(routine as never)); }
    expect(text).toContain(t("template.review.startsPaused"));
  });

  test("each app by name", () => {
    for (const app of fixture.connections) expect(text).toContain(connectionName(app));
  });

  test("a template carries no memory, so no page names one", () => {
    expect(text).not.toContain("記憶");
    expect(text).not.toMatch(/最後更新/);
  });
});

describe("the words say what sharing does", () => {
  // Sharing saves a file, or prepares a publish request on GitHub; it never makes a link (owner, 2026-11-11).
  const keys = ["template.copyHint", "template.export", "cards.templateSave", "cards.templatePublish", "cards.templatePublished", "cards.templateOpen", "cards.templatePrepared", "cards.templateWhere", "cards.templateFolder", "store.publish", "store.notOpen", "store.unavailable"] as const;
  const link = /link|連結|链接|リンク|링크|enlace|\blien\b|tautan|collegamento|ссылк|ลิงก์|bağlant|liên kết/i;
  const locales = { de, en, es, fr, id, it: itLocale, ja, ko, ptBR, ru, th, tr, vi, zhCN, zhTW } as Record<string, Record<string, string>>;

  test.each(Object.keys(locales))("%s names no link where a file or a publish request is meant", name => {
    for (const key of keys) expect(locales[name]![key], `${name} ${key}`).not.toMatch(link);
  });

  test("the share menu line says a file is saved or a publish request is prepared", () => {
    expect(en["template.copyHint"]).toBe("Save a file, or prepare a publish request on GitHub");
    expect(zhTW["template.copyHint"]).toBe("存成檔案，或在 GitHub 準備發布請求");
  });
});
