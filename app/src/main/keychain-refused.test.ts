// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

const askAgain = vi.fn<() => Promise<{ refused: boolean }>>();
vi.mock("./api", () => ({ keychainAskAgain: () => askAgain() }));

import { setLocale } from "./i18n";
import { warnKeychainRefused } from "./keychain-refused";

const notes = (): string[] => [...document.querySelectorAll(".toast span")].map(span => span.textContent ?? "");

afterEach(() => {
  setLocale("zh-TW");
  vi.useRealTimers();
  askAgain.mockReset();
  document.body.replaceChildren();
});

describe("the owner refused the Keychain (R-PRIV-KEYCHAIN-01)", () => {
  test("one toast says so with 再問一次, however often the core tells, and goes by itself", () => {
    vi.useFakeTimers();
    warnKeychainRefused();
    warnKeychainRefused();
    expect(notes()).toEqual(["你拒絕了拉斐爾讀取它存的金鑰，需要金鑰的功能先暫停，拉斐爾不會再自己詢問。"]);
    expect(document.querySelector("[data-keychain-ask-again]")?.textContent).toBe("再問一次");
    setLocale("en");
    expect(document.querySelector("[data-keychain-ask-again]")?.textContent).toBe("Ask again");
    vi.advanceTimersByTime(12_000);
    expect(document.querySelector(".toast")).toBeNull();
    warnKeychainRefused();
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
  });

  test("再問一次 asks the core once, takes the toast away and says what happens next", async () => {
    askAgain.mockResolvedValue({ refused: false });
    warnKeychainRefused();
    const button = document.querySelector<HTMLButtonElement>("[data-keychain-ask-again]")!;
    button.click();
    button.click();
    await vi.waitFor(() => expect(document.querySelector(".keychain-refused")).toBeNull());
    expect(askAgain).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual(["下次需要金鑰時會再問你一次。"]);
  });

  test("a failed call leaves the toast and its button for another try", async () => {
    askAgain.mockRejectedValue("core gone");
    warnKeychainRefused();
    const button = document.querySelector<HTMLButtonElement>("[data-keychain-ask-again]")!;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(document.querySelector(".keychain-refused")).not.toBeNull();
  });
});
