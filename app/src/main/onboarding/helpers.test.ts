import { describe, expect, test } from "vitest";
import type { StoreService } from "../types";
import { pickServices } from "./helpers";

const WORDS = { "zh-TW": "", en: "", ja: "" };
const service = (id: string, over: Partial<StoreService> = {}): StoreService => ({
  id, name: id[0].toUpperCase() + id.slice(1), publisher: "", url: "", category: "", icon: null, popular: false,
  summary: WORDS, about: WORDS, examples: { "zh-TW": [], en: [], ja: [] }, server_id: null, ...over,
});

describe("pickServices", () => {
  test("the popular apps of the store come first, in the store's order", () => {
    const picked = pickServices([service("zzz"), service("notion"), service("github")], [service("gmail", { source: "composio" }), service("googlecalendar", { source: "composio" })]);
    expect(picked.map((s) => s.id)).toEqual(["gmail", "googlecalendar", "notion", "github", "zzz"]);
  });

  test("six at most, and an app that wants its own key or developer app is left to the store", () => {
    const many = Array.from({ length: 10 }, (_, i) => service(`app${i}`));
    expect(pickServices(many, [])).toHaveLength(6);
    const picked = pickServices([service("sentry", { needs: "key" }), service("linear", { needs: "own_app" }), service("notion", { needs: "sign_in" })], []);
    expect(picked.map((s) => s.id)).toEqual(["notion"]);
  });

  test("a built-in app wins over a managed one of the same name", () => {
    const picked = pickServices([service("notion", { server_id: "n1" })], [service("notion", { source: "composio" }), service("calendar", { name: "Google Calendar", source: "composio" })]);
    expect(picked.map((s) => [s.id, s.source])).toEqual([["notion", undefined], ["calendar", "composio"]]);
  });

  test("an app that is already connected stays in the list, as connected", () => {
    expect(pickServices([service("notion", { server_id: "n1" })], [])[0].server_id).toBe("n1");
  });
});
