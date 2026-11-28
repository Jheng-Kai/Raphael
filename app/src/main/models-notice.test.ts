// @vitest-environment happy-dom
// What the core says about the features' models (models-notice.ts, R-DEFAULT-05): the words name the feature, never a provider.
import { afterEach, describe, expect, test, vi } from "vitest";
import * as notices from "./models-notice";
import { warnModelMissing } from "./models-notice";
import { setLocale } from "./i18n";

afterEach(() => { document.body.innerHTML = ""; setLocale("zh-TW"); });

describe("a feature with no model", () => {
  test("is said once a feature, by the feature's name, with the one button that opens its choice", () => {
    const choose = vi.fn();
    warnModelMissing({ role: "cleanup" }, choose);
    warnModelMissing({ role: "cleanup" }, choose);
    warnModelMissing({ role: "stt" }, choose);
    const notes = [...document.querySelectorAll(".toast .model-missing")];
    expect(notes.map((note) => note.textContent)).toEqual(["整理文字還沒選模型，這次先貼上原文", "語音轉文字還沒選模型"]);
    expect(notes.every((note) => !/OpenRouter|金鑰/.test(note.textContent!))).toBe(true);
    const button = document.querySelector<HTMLButtonElement>('.toast [data-model-missing="cleanup"]')!;
    expect(button.textContent).toBe("選擇模型");
    button.click();
    expect(choose).toHaveBeenCalledExactlyOnceWith("cleanup");
    expect(document.querySelectorAll(".toast .model-missing")).toHaveLength(1);
  });

  test("a feature the window does not know is not said", () => {
    warnModelMissing({ role: "anything" }, vi.fn());
    expect(document.querySelector(".toast")).toBeNull();
  });
});

describe("features filled when a source is connected", () => {
  // The choices on screen show the models a connected source filled; a toast saying so repeated them (R-TOAST-01).
  test("are not announced: the window has no way to toast them", () => {
    expect(Object.keys(notices).sort()).toEqual(["modelMissingHTML", "warnModelMissing"]);
    expect(document.querySelector(".toast")).toBeNull();
  });
});
