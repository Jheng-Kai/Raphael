// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { faceHTML } from "./members";
import { SLIME_IDS, isSlimeAvatar, seasonalHat, slimeFaceHTML, slimeSVG } from "./slime";

test("a member without a picture is a slime, its chosen one or a colour from its id; Raphael is not", () => {
  const face = (member: Parameters<typeof faceHTML>[0]): HTMLElement => {
    const el = document.createElement("div"); el.innerHTML = faceHTML(member, 40); return el;
  };
  expect(face({ id: 3, name: "Ada" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  expect(slimeFaceHTML({ id: 3 }, 40)).toContain('style="--av:40px"');
  expect(face({ id: 3, name: "Ada", avatar: "slime:demon" }).innerHTML).toContain("#ff3b4e");
  expect(face({ id: 3, name: "Ada", avatar: "slime:unknown" }).querySelector(".mb-av-slime")).not.toBeNull();
  expect(face({ id: 3, name: "Ada", avatar_url: "data:image/png;base64,AAAA" }).querySelector(".mb-av-slime")).toBeNull();
  expect(face({ id: 0, name: "Raphael" }).querySelector(".mb-av-slime")).toBeNull();
});

test("the season puts a hat on every slime only in its week", () => {
  expect(seasonalHat(new Date(2026, 9, 23))).toBeNull();
  expect(seasonalHat(new Date(2026, 9, 31))).toBe("witch");
  expect(seasonalHat(new Date(2026, 10, 1))).toBe("witch");
  expect(seasonalHat(new Date(2026, 11, 24))).toBe("santa");
  expect(seasonalHat(new Date(2026, 5, 1))).toBeNull();
  for (const id of SLIME_IDS) {
    expect(slimeSVG(id, new Date(2026, 9, 31))).toContain("#3b2563");
    expect(slimeSVG(id, new Date(2026, 5, 1))).not.toContain("#3b2563");
  }
});

test("each drawing has its own gradient, so one in a hidden place cannot blank another", () => {
  const ids = [slimeSVG("azure"), slimeSVG("azure")].map(svg => /id="(slime-\d+)"/.exec(svg)![1]);
  expect(ids[0]).not.toBe(ids[1]);
  expect(isSlimeAvatar("slime:azure")).toBe(true);
  expect(isSlimeAvatar("preset:azure")).toBe(false);
});
