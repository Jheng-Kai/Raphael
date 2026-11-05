// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { mentionChipHTML, mentionRanges, mentionsHTML, type MentionTarget } from "./mention-text";

const target = (name: string, kind: MentionTarget["kind"] = "member", aliases: string[] = []): MentionTarget => ({ name, kind, aliases, mark: size => `<i data-size="${size}"></i>` });
const TEAM = [target("Ops"), target("Ops Lead"), target("小森"), target("小晴"), target("Raphael", "member", ["拉斐爾", "ラファエル"]), target("Notion", "app")];
const named = (text: string): string[] => mentionRanges(text, TEAM).map(range => range.target.name);

test("finished mention ranges and patterns are reused until the roster version changes", () => {
  const roster = [target("Cache Member")], text = "Ask @Cache Member about the result.";
  const first = mentionRanges(text, roster);
  const regexp = vi.spyOn(globalThis, "RegExp");
  try {
    expect(mentionRanges(text, roster)).toBe(first);
    expect(regexp).not.toHaveBeenCalled();
  } finally { regexp.mockRestore(); }
  expect(mentionRanges(text, [target("Renamed Member")])).toEqual([]);
});

// The same table as core/tests/members/test_rooms.py::test_mentions_are_read_from_the_words_exactly_as_the_composer_draws_its_chips:
// the composer draws a chip for what the core would address and for nothing else.
test.each<[string, string[]]>([
  ["@Ops Lead ", ["Ops Lead"]],
  ["請 @小森 看一下", ["小森"]],
  ["@小森，@小晴。", ["小森", "小晴"]],
  ["@小森請看一下", []],
  ["請@小森 看", []],
  ["@ops lead", ["Ops Lead"]],
  ["@Ops Lead and @Ops", ["Ops Lead", "Ops"]],
  ["`@小森` 「@小晴」 \"@Ops\"", []],
  ["\n> @小森\n@小晴 ", ["小晴"]],
  ["＠Ops Lead and @Ops", ["Ops Lead", "Ops"]],
  ["請 ＠小森 看一下", ["小森"]],
  ["＠小森，＠小晴。", ["小森", "小晴"]],
  ["＠小森請看一下", []],
  ["請＠小森 看", []],
  ["jo＠Ops.com and ＠Opsgenie", []],
  ["`＠小森` 「＠小晴」 \"＠Ops\"", []],
  ["\n> ＠小森\n＠小晴 ", ["小晴"]],
  ["jo@Ops.com and @Opsgenie are not mentions", []],
  ["@拉斐爾，請收束", ["Raphael"]],
  ["@ラファエル、お願いします", ["Raphael"]],
  ["ask @Notion about it", ["Notion"]],
])("%j addresses %j", (text, expected) => expect(named(text)).toEqual(expected));

test("a range covers the whole @Name and keeps what was typed, in order and never overlapping", () => {
  const text = "x @ops lead @Ops";
  expect(mentionRanges(text, TEAM).map(range => text.slice(range.start, range.end))).toEqual(["@ops lead", "@Ops"]);
});

test("a name that is not a target stays plain text", () => {
  expect(mentionRanges("@Nobody and @", TEAM)).toEqual([]);
  expect(mentionRanges("no address at all", TEAM)).toEqual([]);
  expect(mentionRanges("@小森", [])).toEqual([]);
});

test("a chip reads as the words it replaces, with its mark where the @ is, and nothing typed can become markup", () => {
  const html = mentionChipHTML("@<b>x</b>", target("<b>x</b>", "app"));
  const host = document.createElement("div"); host.innerHTML = html;
  expect(host.textContent).toBe("@<b>x</b>");
  expect(host.querySelector("b")).toBeNull();
  const chip = host.querySelector<HTMLElement>(".mention-chip")!;
  expect(chip.dataset.mention).toBe("app");
  expect(chip.querySelector(".mention-at .mention-ico i")).not.toBeNull();
});

test("a sentence is its words and its chips in order, the words drawn as the caller draws them", () => {
  const host = document.createElement("div");
  host.innerHTML = mentionsHTML("請 @小森 & @Notion。", TEAM, words => `<u>${words.replace("&", "&amp;")}</u>`);
  expect(host.textContent).toBe("請 @小森 & @Notion。");
  expect([...host.querySelectorAll(".mention-chip")].map(chip => chip.textContent)).toEqual(["@小森", "@Notion"]);
  expect([...host.querySelectorAll(":scope > u")].map(part => part.textContent)).toEqual(["請 ", " & ", "。"]);
});
