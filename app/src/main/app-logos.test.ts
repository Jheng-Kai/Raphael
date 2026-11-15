// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { appLogo, rememberAppLogos } from "./app-logos";
import { senderMarkHTML } from "./mail-card";
import { connectionMarkHTML } from "./secret-card";

test("a card that only knows an app's name draws the picture the lists draw, from the one source", () => {
  // Owner, 2026-11-15: 「不是說統一來源嗎? 為甚麼這邊還是沒有 outlook 的 icon 我不是有說要統一確認嗎?」.
  const logo = "https://logos.composio.dev/api/outlook";
  const box = document.createElement("div");
  box.innerHTML = connectionMarkHTML("Outlook");
  expect(box.querySelector("img")).toBeNull();
  rememberAppLogos([{ name: "Outlook", logo }, { name: "Slack" }]);
  expect(appLogo(" outlook ")).toBe(logo);
  box.innerHTML = connectionMarkHTML("Outlook");
  expect(box.querySelector<HTMLImageElement>(".mono.logo-art img.logo")!.getAttribute("src")).toBe(logo);
  box.innerHTML = senderMarkHTML("Outlook");
  expect(box.querySelector<HTMLImageElement>("img.logo")!.getAttribute("src")).toBe(logo);
  // A listing without a picture keeps the one the app had; a picture that is not the catalogue's is never drawn.
  rememberAppLogos([{ name: "Outlook" }]);
  expect(appLogo("Outlook")).toBe(logo);
  rememberAppLogos([{ name: "Elsewhere", logo: "https://example.com/mark.png" }]);
  box.innerHTML = connectionMarkHTML("Elsewhere");
  expect(box.querySelector("img")).toBeNull();
});
