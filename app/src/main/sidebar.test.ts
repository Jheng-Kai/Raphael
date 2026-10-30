// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { columnHTML } from "./member-column";
import { setLocale } from "./i18n";
import { createSidebar } from "./sidebar";
import { ownerFaceHTML, ownerName, setOwnerProfile } from "./owner-avatar";
import { roomAvatarHTML } from "./group-chats";
import type { Member } from "./types";

test("the chief is an ordinary row until it is pinned, then a larger centered face above its name", () => {
  const el = document.createElement("div");
  el.innerHTML = columnHTML({ list: null, current: 0, query: "", folded: new Set(), fresh: new Set(), previews: new Map([[0, "Latest report"]]) });
  expect(el.querySelector('.mb-chief .mb-row-p')?.textContent).toBe("Latest report");
  expect(el.querySelector('.mb-chief > .av')?.getAttribute("style")).toBe("--av:40px");
  expect(el.querySelector('.mb-pinned')).toBeNull();
  const chief = { id: 0, name: "Raphael", pinned: true } as Member;
  el.innerHTML = columnHTML({ list: { members: [chief], groups: [] }, current: 0, query: "", folded: new Set(), fresh: new Set(), previews: new Map([[0, "Latest report"]]) });
  expect(el.querySelector('.mb-pinned .mb-tile.mb-chief > .av')?.getAttribute("style")).toBe("--av:64px");
  expect(el.querySelector('.mb-tile > b')?.textContent).toBe("Raphael");
  expect(el.querySelector('.mb-tile .mb-row-p')).toBeNull();
  expect(el.querySelectorAll('[data-member="0"]')).toHaveLength(1);
});

test("the sidebar has no brand, names Home in each language, and collapses to a rail and back", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!;
  const column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button type="button" data-col="add"></button></div>';
  const redraws: Event[] = [];
  column.addEventListener("sidebar-rail", event => redraws.push(event));
  createSidebar(nav, column);
  expect(nav.querySelector(".brand, .app-icon")).toBeNull();
  for (const [locale, label] of [["zh-TW", "回到首頁"], ["en", "Back to home"], ["ja", "ホームへ"]] as const) {
    setLocale(locale);
    expect(nav.querySelector('[data-go="home"]')!.getAttribute("aria-label")).toBe(label);
  }
  setLocale("zh-TW");
  const collapse = nav.querySelector<HTMLElement>('[data-sidebar="collapse"]')!;
  const add = nav.querySelector<HTMLElement>('[data-col="add"]')!;
  expect(add.parentElement!.className).toBe("mb-top");
  const before = redraws.length;
  collapse.click();
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  expect(collapse.getAttribute("aria-label")).toBe("展開側欄");
  expect(add.parentElement!.className).toBe("side-foot");
  expect(localStorage.getItem("raphael.sidebar.collapsed")).toBe("true");
  expect(redraws.length).toBe(before + 1);
  collapse.click();
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(false);
  expect(add.parentElement!.className).toBe("mb-top");
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
