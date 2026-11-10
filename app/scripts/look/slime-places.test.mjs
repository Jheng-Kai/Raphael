// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { placesProblems, slimePlaces } from "./slime-places.mjs";

const surface = (extra = "") => `<span class="slime-surface" ${extra}><svg class="slime"></svg></span>`;

beforeEach(() => { document.body.innerHTML = ""; });

test("a slime in the member list or the thinking line may move, and one anywhere else must be a picture", () => {
  document.body.innerHTML =
    `<div class="mb-list"><button class="mb-row">${surface()}</button></div>` +
    `<div class="live-presence">${surface()}</div>` +
    `<header class="mb-head"><span class="av">${surface('data-slime-still=""')}</span></header>`;
  const result = slimePlaces();
  expect(result.surfaces).toBe(3);
  expect(placesProblems(result)).toEqual([]);
  document.body.insertAdjacentHTML("beforeend", `<aside class="mb-det"><span class="av">${surface()}</span></aside>`);
  expect(placesProblems(slimePlaces())).toEqual([expect.stringContaining("is not drawn as a picture")]);
  document.querySelector(".mb-det .slime-surface").insertAdjacentHTML("beforeend", `<span class="slime-loop"></span>`);
  expect(placesProblems(slimePlaces()).join("|")).toContain("carries animation strips");
});

test("a scene can ask for the moving places to be moving, and for pictures only", () => {
  const quiet = { surfaces: 1, found: { list: 0, line: 0, elsewhere: 0 }, offenders: [] };
  expect(placesProblems(quiet, { list: true, line: true })).toHaveLength(2);
  expect(placesProblems({ ...quiet, found: { list: 2, line: 1, elsewhere: 0 } }, { list: true, line: true })).toEqual([]);
  expect(placesProblems({ ...quiet, found: { list: 1, line: 0, elsewhere: 0 } }, { picturesOnly: true })).toHaveLength(1);
});
