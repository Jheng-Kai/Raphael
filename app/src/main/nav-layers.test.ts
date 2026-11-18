// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { frameNavigation } from "./dismissals";
import { bindNavFrame, bindNavLayer } from "./nav-layers";
import { openEventEditor } from "./calendar-popover";
import { mountConversationFind } from "./conversation-find";
import { openMediaLightbox } from "./media-lightbox";
import { openMemberCreator } from "./member-creator";
import { confirmDelete, openDialog } from "./member-dialogs";
import { navInputs, pressLayer } from "./test-support/nav-layer-input";
import { closeMenu, openPopover } from "./ui";

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

test("a focused frame can navigate only its own topmost viewer", () => {
  const viewer = document.createElement("div"), frame = document.createElement("iframe");
  viewer.append(frame); document.body.append(viewer);
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  bindNavLayer(viewer, vi.fn());
  bindNavFrame(frame, viewer);
  const step = (source: MessageEventSource | null = frame.contentWindow, origin = "null") => frameNavigation(new MessageEvent("message", {
    source, origin, data: {type: "raphael-frame-navigation", direction: "back"},
  }));
  expect(step()).toBeUndefined();
  frame.focus();
  expect(step()).toBe("back");
  expect(step(window)).toBeUndefined();
  expect(step(frame.contentWindow, "https://example.invalid")).toBeUndefined();
  const dialog = openDialog({ title: "Question", body: "", actions: {}, onAct() {} });
  frame.focus();
  expect(step()).toBeUndefined();
  dialog.close();
});

describe.each(navInputs)("%s layer navigation", input => {
  test("a submenu, its menu and its dialog close one at a time", () => {
    const dialog = openDialog({ title: "Member", body: "<button>Actions</button>", actions: {}, onAct() {} });
    const opener = dialog.el.querySelector<HTMLElement>(".mb-dlg-body button")!;
    const menu = openPopover(opener, "<button>Apps</button>", { className: "menu", role: "menu" });
    const apps = menu.querySelector("button")!;
    apps.addEventListener("click", () => openPopover(apps, "<button>App</button>", { className: "menu", role: "menu", placement: "beside" }).querySelector("button")!.focus());
    apps.click();
    pressLayer(input, "forward");
    expect(document.querySelector("#app-submenu")).not.toBeNull();
    pressLayer(input);
    expect(document.querySelector("#app-submenu")).toBeNull();
    expect(document.activeElement).toBe(apps);
    pressLayer(input, "forward");
    expect(document.querySelector("#app-submenu")).not.toBeNull();
    pressLayer(input);
    pressLayer(input);
    expect(menu.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
    pressLayer(input);
    expect(dialog.el.isConnected).toBe(false);
  });

  test("back cancels a delete question and never confirms it", async () => {
    const answer = confirmDelete("Robin");
    pressLayer(input, "forward");
    expect(document.querySelector(".mb-delete")).not.toBeNull();
    pressLayer(input);
    expect(await answer).toBe(false);
  });

  test("back puts away the lightbox and returns focus to the picture", () => {
    const picture = document.createElement("button");
    document.body.append(picture);
    openMediaLightbox(picture, "thumb.png");
    pressLayer(input, "forward");
    expect(document.querySelector(".lb-img")).not.toBeNull();
    pressLayer(input);
    expect(document.querySelector(".media-lightbox")).toBeNull();
    expect(document.activeElement).toBe(picture);
  });

  test("a dirty calendar editor follows its explicit cancel path", () => {
    const panel = openEventEditor({ left: 0, right: 0, top: 0 },
      { start: Date.now(), end: Date.now() + 3600000, title: "", notes: "", allDay: false }, { onSaved: vi.fn() });
    panel.el.querySelector<HTMLInputElement>("#cal-title")!.value = "Draft";
    pressLayer(input, "forward");
    expect(panel.el.isConnected).toBe(true);
    pressLayer(input);
    expect(panel.el.isConnected).toBe(false);
  });

  test("the member maker retraces avatar tabs and keeps the name", () => {
    const dialog = openMemberCreator({ taken: [], groupId: null, create: vi.fn() });
    const name = dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!;
    name.value = "Robin";
    const characters = dialog.el.querySelector<HTMLButtonElement>('[data-slime-tab="characters"]')!;
    characters.click();
    characters.focus();
    pressLayer(input);
    expect(dialog.el.querySelector('[data-slime-tab="colors"]')?.getAttribute("aria-selected")).toBe("true");
    expect(name.value).toBe("Robin");
    pressLayer(input, "forward");
    expect(characters.getAttribute("aria-selected")).toBe("true");
    pressLayer(input);
    pressLayer(input);
    expect(dialog.el.isConnected).toBe(false);
  });

  test("conversation search closes even after focus has left its field", () => {
    const button = document.createElement("button"), bar = document.createElement("div"), thread = document.createElement("div");
    document.body.append(button, bar, thread);
    const search = mountConversationFind({ button, bar, thread, scroll: thread, load: vi.fn() });
    search.open();
    button.focus();
    pressLayer(input, "forward");
    expect(search.isOpen()).toBe(true);
    pressLayer(input);
    expect(search.isOpen()).toBe(false);
    expect(document.activeElement).toBe(button);
  });
});
