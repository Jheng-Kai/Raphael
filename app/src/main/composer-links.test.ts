import { expect, test } from "vitest";
import { linkRanges, shortenLinks, wholeLinks } from "./composer-links";

const LONG = "https://x.com/someone/status/2115177376921293212?ref_src=twsrc%5Etfw&ref_url=https%3A%2F%2Fexample.com%2Fa";

test("a long link stands as its short name and goes out whole, with the words around it as they were", () => {
  const short = shortenLinks(`看這個 ${LONG} 這個是我當時`);
  expect(short).toBe("看這個 x.com/someone/status/2115177376… 這個是我當時");
  expect(wholeLinks(short)).toBe(`看這個 ${LONG} 這個是我當時`);
});

test("punctuation after a link stays with the words, and words without a link are left alone", () => {
  expect(shortenLinks("見 https://example.com/a/b。謝謝")).toBe("見 example.com/a/b。謝謝");
  expect(shortenLinks("no link here, http:// alone")).toBe("no link here, http:// alone");
  expect(wholeLinks("no link here")).toBe("no link here");
});

test("two addresses with one short name keep their own", () => {
  const one = "https://same.example/page?id=1", other = "https://same.example/page?id=2";
  const short = shortenLinks(`${one} ${other} ${one}`);
  expect(short).toBe("same.example/page same.example/page (2) same.example/page");
  expect(wholeLinks(short)).toBe(`${one} ${other} ${one}`);
});

test("shortening what is short already changes nothing, so a draft can go back in", () => {
  const short = shortenLinks(LONG);
  expect(shortenLinks(short)).toBe(short);
});

test("the ranges say where each name stands, a longer name over one it starts with", () => {
  shortenLinks("https://ranges.example/a https://ranges.example/ab");
  const text = "go ranges.example/ab now ranges.example/a";
  expect(linkRanges(text).map(range => text.slice(range.start, range.end))).toEqual(["ranges.example/ab", "ranges.example/a"]);
});
