// A member template file read for the import review: with or without a byte-order mark, and every way it can be wrong said
// in the owner's language, never as the parser's or the core's own words.
import { describeError } from "./format";
import { t } from "./i18n";

/** The newest recipe version this build reads (`version` of members/templates.py). */
export const TEMPLATE_VERSION = 1;

/** Why a template cannot be added: it is not one, it is from a newer Raphael, it is damaged, it holds a secret, or it is too large. */
export type TemplateProblem = "notTemplate" | "newer" | "damaged" | "secret" | "tooLarge";

const PROBLEM_KEYS = {
  notTemplate: "template.file.notTemplate", newer: "template.file.newer", damaged: "template.file.damaged",
  secret: "template.file.secret", tooLarge: "template.file.tooLarge",
} as const;

export class TemplateFileError extends Error {
  constructor(readonly problem: TemplateProblem) {
    super(problem);
    this.name = "TemplateFileError";
  }
  /** The sentence the owner reads. */
  get text(): string { return t(PROBLEM_KEYS[this.problem]); }
}

/**
 * The recipe a template file holds, as the value the core checks next. Notepad saves UTF-8 with a byte-order mark; the
 * shell takes UTF-16 files down to text and the mark with them, and a mark that is left here is dropped too.
 * Anything else the core's check refuses is told by [`templateErrorText`].
 */
export function parseTemplateFile(text: string): Record<string, unknown> {
  const body = text.replace(/^\uFEFF/, "");
  let value: unknown;
  try { value = JSON.parse(body); }
  // A file that starts as a recipe does and stops, breaks or is cut short is damaged; any other text is not a template at all.
  catch { throw new TemplateFileError(body.trimStart().startsWith("{") ? "damaged" : "notTemplate"); }
  if (typeof value !== "object" || value === null || Array.isArray(value) || (value as Record<string, unknown>).format !== "raphael-member") {
    throw new TemplateFileError("notTemplate");
  }
  const version = (value as Record<string, unknown>).version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new TemplateFileError("damaged");
  if (version > TEMPLATE_VERSION) throw new TemplateFileError("newer");
  return value as Record<string, unknown>;
}

const INVALID_PARAMS = /^\[-32602\]/;

/**
 * What to tell the owner when a template could not be shown or added: for a file, which of its problems it is; for an entry of
 * the store, that the store is not open or the entry cannot be added now; the app's own wording for anything else (the core
 * is not running, ...). The core's English sentences are never shown.
 */
export function templateErrorText(error: unknown, from: "file" | "store" = "file"): string {
  if (error instanceof TemplateFileError) return error.text;
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!INVALID_PARAMS.test(text)) return describeError(error);
  if (from === "store") return t(/not open/i.test(text) ? "store.notOpen" : "store.unavailable");
  if (/private credentials/i.test(text)) return new TemplateFileError("secret").text;
  if (/too large/i.test(text)) return new TemplateFileError("tooLarge").text;
  return new TemplateFileError("damaged").text;
}
