import { describe, expect, test } from "vitest";
import { TEMPLATE_VERSION, TemplateFileError, parseTemplateFile, templateErrorText } from "./template-file";
import { t } from "./i18n";

// Notepad saves a template as UTF-8 with this mark in front of it.
const BOM = String.fromCharCode(0xfeff);
const recipe = { format: "raphael-member", version: 1, name: "編輯", role: "", personality: "", instructions: "", reply_style: "full", skills: [], routines: [], connections: [] };

const problem = (text: string): string | undefined => {
  try { parseTemplateFile(text); } catch (error) { return error instanceof TemplateFileError ? error.problem : "other"; }
  return undefined;
};

describe("a template file is read the way Notepad and the installer's users leave it", () => {
  test("a byte-order mark is the cause of the parse failure the owner used to see, and is now dropped", () => {
    const text = JSON.stringify(recipe, null, 2);
    expect(() => JSON.parse(BOM + text)).toThrow();
    expect(parseTemplateFile(BOM + text)).toEqual(recipe);
    expect(parseTemplateFile(text)).toEqual(recipe);
    expect(parseTemplateFile(BOM + text.split("\n").join("\r\n"))).toEqual(recipe);
  });

  test("it hands the recipe on without judging its fields: the core does that", () => {
    expect(parseTemplateFile(JSON.stringify({ ...recipe, extra: true }))).toMatchObject({ extra: true });
  });
});

describe("what is wrong with a file, in three kinds", () => {
  test("text that is not a recipe at all, or another kind of JSON, is not a template", () => {
    expect(problem("")).toBe("notTemplate");
    expect(problem("hello")).toBe("notTemplate");
    expect(problem("[1, 2]")).toBe("notTemplate");
    expect(problem("null")).toBe("notTemplate");
    expect(problem(JSON.stringify({ format: "raphael-catalog", version: 1 }))).toBe("notTemplate");
    expect(problem("{}")).toBe("notTemplate");
  });

  test("a recipe from a newer Raphael is told apart from a damaged one", () => {
    expect(problem(JSON.stringify({ ...recipe, version: TEMPLATE_VERSION + 1 }))).toBe("newer");
    expect(problem(JSON.stringify({ ...recipe, version: 0 }))).toBe("damaged");
    expect(problem(JSON.stringify({ ...recipe, version: "1" }))).toBe("damaged");
    expect(problem(JSON.stringify({ ...recipe, version: 1.5 }))).toBe("damaged");
    expect(problem(JSON.stringify({ format: "raphael-member" }))).toBe("damaged");
  });

  test("a file that starts as a recipe and stops is damaged", () => {
    const text = JSON.stringify(recipe, null, 2);
    expect(problem(text.slice(0, 40))).toBe("damaged");
    expect(problem(BOM + text.slice(0, text.length - 3))).toBe("damaged");
  });
});

describe("what the owner reads", () => {
  test("each problem has its own sentence, none of them raw", () => {
    for (const kind of ["notTemplate", "newer", "damaged", "secret", "tooLarge"] as const) {
      const text = new TemplateFileError(kind).text;
      expect(text).toBe(t(`template.file.${kind}`));
      expect(text).not.toMatch(/JSON|Unexpected|Invalid|token|position/i);
    }
  });

  test("the core's refusals are told as their kind, and anything unknown never shows the core's own words", () => {
    const refusal = (message: string): string => templateErrorText(new Error(`[-32602] Invalid params: ${message}`));
    expect(refusal("Invalid member template fields")).toBe(t("template.file.damaged"));
    expect(refusal("Only safe, public text dependencies belong in a skill recipe")).toBe(t("template.file.damaged"));
    expect(refusal("Remove private credentials from the member recipe first")).toBe(t("template.file.secret"));
    expect(refusal("Member template is too large")).toBe(t("template.file.tooLarge"));
    expect(templateErrorText(new Error("[-32603] boom: Traceback (most recent call last)"))).not.toMatch(/Traceback|boom/);
    expect(templateErrorText(new Error("Raphael's core is not running"))).toBe(t("format.010"));
  });

  test("an entry of the store that cannot be added says why in one of two ways", () => {
    expect(templateErrorText(new Error("[-32602] Invalid params: The store is not open yet"), "store")).toBe(t("store.notOpen"));
    expect(templateErrorText(new Error("[-32602] Invalid params: Template digest mismatch"), "store")).toBe(t("store.unavailable"));
  });
});
