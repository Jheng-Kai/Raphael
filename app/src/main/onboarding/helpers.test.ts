import { describe, expect, test } from "vitest";
import type { BrainSettings, ServicesStatus, StoreService } from "../types";
import { abilityRows, pickServices } from "./helpers";

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

const status = (over: Partial<ServicesStatus> = {}): ServicesStatus =>
  ({
    search: { enabled: true, service: "builtin", options: [{ id: "builtin", needs_key: false, has_key: false, key_optional: false }] },
    read: { enabled: true, service: "builtin", options: [{ id: "builtin", needs_key: false, has_key: false, key_optional: false }] },
    pdf: { enabled: true, service: "builtin", options: [{ id: "builtin", needs_key: false, has_key: false, key_optional: false }] },
    voice: { enabled: false, service: "fish", options: [{ id: "fish", needs_key: true, has_key: false, key_optional: false }], fish_voice_set: false },
    vision: { enabled: true, model: "", resolved_model: "openai/gpt-6-sol", supports_images: true },
    ...over,
  }) as unknown as ServicesStatus;

describe("abilityRows", () => {
  test("the abilities of Settings > Tools in their order, with their switches as they are", () => {
    const rows = abilityRows(status(), null);
    expect(rows.map((r) => [r.kind, r.on])).toEqual([["search", true], ["read", true], ["vision", true], ["pdf", true], ["voice", false]]);
  });

  test("an ability that waits for a key says so and cannot be switched on yet", () => {
    const voice = abilityRows(status(), null).find((r) => r.kind === "voice")!;
    expect(voice.note).toBeTruthy();
    expect(abilityRows(status(), null).filter((r) => r.kind !== "voice").every((r) => r.note === null)).toBe(true);
  });

  test("the switch the owner just turned wins over the core's older status", () => {
    const brain = { web_search_enabled: false } as unknown as BrainSettings;
    expect(abilityRows(status(), brain).find((r) => r.kind === "search")!.on).toBe(false);
  });
});
