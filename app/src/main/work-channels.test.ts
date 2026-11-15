// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { emptyMessagingView, messagingHTML } from "./messaging";
import { secretCardHTML } from "./secret-card";
import { setLocale } from "./i18n";
import { iconHTML } from "./service-mark";

describe("work chat and private login rows", () => {
  it("uses the same settings rows for all three channels, with separate masked fields", () => {
    setLocale("zh-TW");
    const view = { ...emptyMessagingView(), status: { connected: false, enabled: false, running: false, error: null, bot: null, allowed: [], pending: [] } };
    document.body.innerHTML = messagingHTML({ ...view, channels: { slack: view, discord: view } });
    expect([...document.querySelectorAll("section.msg")].map(el => el.getAttribute("aria-label"))).toEqual(["Telegram", "Slack", "Discord"]);
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3);
    expect(new Set([...document.querySelectorAll("input")].map(el => el.id)).size).toBe(3);
    for (const kind of ["slack", "discord"]) {
      const section = document.querySelector(`[data-msg-kind="${kind}"]`)!;
      expect(section.querySelector('[data-msg="setup-link"]')).not.toBeNull();
      expect(section.querySelector('.note')?.textContent).not.toMatch(/https?:\/\//);
      const expected = document.createElement("template");
      expected.innerHTML = iconHTML(kind, kind as "slack" | "discord", "md");
      expect(section.querySelector('.msg-name .logo-mono')?.outerHTML).toBe(expected.content.firstElementChild?.outerHTML);
    }
  });
  it("asks for login fields only in the existing secret card", () => {
    document.body.innerHTML = secretCardHTML({ id: "login", name: "https://example.com", secret: "login", login: true, state: "pending", error: null, expires_at_ms: 99, resumed: false });
    expect(document.querySelector(".secret-card [data-login-user]")).not.toBeNull();
    expect(document.querySelector('input[data-secret-input][type="password"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("JSON");
    expect(document.querySelectorAll(".sc-login label > span:first-child")).toHaveLength(2);
    expect(document.querySelector(".sc-login")?.textContent).toContain("帳號");
  });
});
