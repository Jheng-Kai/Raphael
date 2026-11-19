// @vitest-environment happy-dom
// A connection that stopped working (connection-lost.ts, R-ACCT-04): one toast an app, its one button signs in again.
import { afterEach, describe, expect, test, vi } from "vitest";
import { warnConnectionLost } from "./connection-lost";
import { setLocale } from "./i18n";

afterEach(() => { document.body.innerHTML = ""; setLocale("zh-TW"); });

describe("a lost connection", () => {
  test("is said once an app, with 重新登入, which goes to that app's sign-in and takes the toast away", () => {
    const relogin = vi.fn();
    warnConnectionLost({ id: "composio:gmail", name: "Gmail" }, relogin);
    warnConnectionLost({ id: "composio:gmail", name: "Gmail" }, relogin);
    warnConnectionLost({ id: "composio:notion", name: "Notion" }, relogin);
    const notes = [...document.querySelectorAll(".toast .connection-lost")];
    expect(notes.map((note) => note.textContent)).toEqual(["Gmail 的連線中斷了，重新登入就能繼續使用。", "Notion 的連線中斷了，重新登入就能繼續使用。"]);
    expect(notes[0]!.getAttribute("role")).toBe("status");
    const button = document.querySelector<HTMLButtonElement>('.toast [data-connection-relogin="composio:gmail"]')!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("重新登入");
    button.click();
    expect(relogin).toHaveBeenCalledWith("composio:gmail");
    expect(document.querySelectorAll(".toast .connection-lost")).toHaveLength(1);
  });

  test("says the app's name in the window's language, escaped", () => {
    setLocale("en");
    warnConnectionLost({ id: "composio:x", name: "<b>X</b>" }, vi.fn());
    const note = document.querySelector(".toast .connection-lost")!;
    expect(note.textContent).toBe("<b>X</b> stopped working. Sign in again to keep using it.");
    expect(note.querySelector("b")).toBeNull();
  });
});
