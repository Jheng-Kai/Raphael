import { describe, expect, test } from "vitest";
import { findsName, foldName, nameScore } from "./find-match";

describe("finding a thing by its name forgives typing (owner, 2026-11-08)", () => {
  test.each([
    ["gamil", "Gmail"], // two letters swapped
    ["gmial", "Gmail"],
    ["gmal", "Gmail"], // a letter missing
    ["gmaail", "Gmail"], // a letter too many
    ["notoin", "Notion"],
    ["slakc", "Slack"],
    ["calender", "Google Calendar"], // a wrong letter in a later word
    ["goolge calendar", "Google Calendar"],
    ["googlecal", "Google Calendar"], // the words run together
    ["gml", "Gmail"], // its letters in order
    ["telgram", "Telegram"],
    ["spotfy", "Spotify"],
    ["ＧＭＡＩＬ", "Gmail"], // full width
    ["linar", "Linear"],
    ["行事歷", "Google 行事曆"], // one wrong character of three
  ])("「%s」 finds 「%s」", (query, name) => {
    expect(findsName([name], query)).toBe(true);
  });

  test.each([
    ["360", "Acme Ledger 350"], // numbers are typed right
    ["gm", "Game"], // too short to forgive anything
    ["rev", "research"], // three letters are typed right
    ["行事", "行程"], // two characters are typed right
    ["zzzz", "Gmail"],
    ["no-such-catalog-app-xyz", "Notion"],
  ])("「%s」 does not find 「%s」", (query, name) => {
    expect(findsName([name], query)).toBe(false);
  });

  test("the exact name, then its start, then inside it, then near misses, in that order", () => {
    const score = (name: string): number => nameScore([name], "slack");
    expect(score("Slack")).toBeLessThan(score("Slack Huddles"));
    expect(score("Slack Huddles")).toBeLessThan(score("MySlackBot"));
    expect(score("MySlackBot")).toBeLessThan(nameScore(["Slack"], "slakc"));
  });

  test("every word of the query is needed, and other names of the thing count", () => {
    expect(findsName(["Google Drive", "googledrive"], "gogle drive")).toBe(true);
    expect(findsName(["Google Drive"], "google sheets")).toBe(false);
    expect(findsName(["Notion", "notes wiki"], "wikki")).toBe(true);
    expect(findsName(["Gmail"], "   ")).toBe(true);
  });

  test("folding drops case, width and accents", () => {
    expect(foldName("Ｇmáil")).toBe("gmail");
  });
});
