// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { columnHTML } from "./member-column";
import { ownerFaceHTML, ownerName, setOwnerProfile } from "./owner-avatar";
import { roomAvatarHTML } from "./group-chats";
import type { Member } from "./types";

test("the chief leads with a larger centered face and its name, without a preview", () => {
  const el = document.createElement("div");
  el.innerHTML = columnHTML({ list: null, current: 0, query: "", folded: new Set(), fresh: new Set(), previews: new Map([[0, "Latest report"]]) });
  expect(el.querySelector('.mb-chief .mb-row-p')).toBeNull();
  expect(el.querySelector('.mb-chief > b')?.textContent).toBeTruthy();
  expect(el.querySelector('.mb-chief > .av')?.getAttribute("style")).toBe("--av:64px");
});

test("the shell has one permanent conversation sidebar and no Team route or apps entry", () => {
  const main = readFileSync("src/main/main.ts", "utf8");
  expect(main).not.toContain("createTeamPage");
  expect(main).not.toContain("navAppsHTML");
  expect(main).toContain("createSidebar");
  const types = readFileSync("src/main/types.ts", "utf8");
  expect(types.match(/export type PageId = ([^;]+)/)?.[1]).not.toContain('"team"');
});

test("room identity uses the participants' own faces and caps the grid at four", () => {
  const urls = [1, 2, 3, 4].map(id => `data:image/png;base64,${btoa(String(id))}`);
  const list = { members: [1, 2, 3, 4].map(id => ({ id, name: `Person ${id}`, avatar_url: urls[id - 1] } as Member)), groups: [] };
  const el = document.createElement("div");
  el.innerHTML = roomAvatarHTML({ member_ids: [2, 1, 3, 4] }, list);
  expect(el.querySelector(".room-avatar")?.getAttribute("data-faces")).toBe("4");
  expect([...el.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual([urls[1], urls[0], urls[2], urls[3]]);
});

test("owner profile updates the existing outgoing face as well as the footer identity", () => {
  document.body.innerHTML = `<div class="me">${ownerFaceHTML()}</div>`;
  setOwnerProfile({ owner_name: "Jack", owner_photo: "data:image/webp;base64,YQ==" } as never);
  expect(ownerName()).toBe("Jack");
  expect(document.querySelector(".me .owner-face img")?.getAttribute("src")).toBe("data:image/webp;base64,YQ==");
  setOwnerProfile({ owner_name: "", owner_photo: "" } as never);
  expect(document.querySelector(".me .owner-face svg")).not.toBeNull();
  document.body.replaceChildren();
});
