import { expect, test } from "vitest";
import { linkRanges, shortenLinks, wholeLinks } from "./composer-links";

const LONG = "https://x.com/someone/status/2115177376921293212?ref_src=twsrc%5Etfw&ref_url=https%3A%2F%2Fexample.com%2Fa";

test("a link stays whole in the words, long or not, with the words around it as they were", () => {
  const words = `看這個 ${LONG} 這個是我當時`;
  expect(shortenLinks(words)).toBe(words);
  expect(wholeLinks(shortenLinks(words))).toBe(words);
  const address = "https://draft.example/article?sample=1";
  expect(wholeLinks(`Sample ${address} and ${address}`)).toBe(`Sample ${address} and ${address}`);
  expect(wholeLinks((address + " ").repeat(6000)) === (address + " ").repeat(6000)).toBe(true);
});

test("two addresses that once shared a short name are each kept as written", () => {
  const one = "https://same.example/page?id=1", other = "https://same.example/page?id=2";
  const words = `${one} ${other} ${one}`;
  expect(shortenLinks(words)).toBe(words);
  expect(linkRanges(words).map(range => words.slice(range.start, range.end))).toEqual([one, other, one]);
});

test("the ranges mark each whole address, and punctuation after it stays with the words", () => {
  const words = "見 https://example.com/a/b。謝謝，也看 (https://example.com/c_(d)) 和 https://example.com/e.";
  expect(linkRanges(words).map(range => words.slice(range.start, range.end))).toEqual([
    "https://example.com/a/b", "https://example.com/c_(d)", "https://example.com/e",
  ]);
});

test("words without a link have no ranges and are left alone", () => {
  expect(linkRanges("no link here, http:// alone, ftp://example.com")).toEqual([]);
  expect(shortenLinks("no link here, http:// alone")).toBe("no link here, http:// alone");
  expect(wholeLinks("no link here")).toBe("no link here");
});

test("a long link is one range, so the field treats it as one unit", () => {
  const words = `a ${LONG} b`;
  expect(linkRanges(words)).toEqual([{ start: 2, end: 2 + LONG.length }]);
});
