// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearLayerForward } from "./nav-history";
import { frameNavigation, stepOpenLayer } from "./dismissals";
import { bindLayerCancels, bindNavFrame, bindNavLayer } from "./nav-layers";
import { openEventEditor } from "./calendar-popover";
import { mountConversationFind } from "./conversation-find";
import { openMediaLightbox } from "./media-lightbox";
import { openMemberCreator } from "./member-creator";
import { confirmDelete, openDialog } from "./member-dialogs";
import { navInputs, pressLayer } from "./test-support/nav-layer-input";
import { closeMenu, openPopover } from "./ui";

afterEach(() => { clearLayerForward(); closeMenu(); document.body.replaceChildren(); });

test("a focused frame can navigate only its own topmost viewer", () => {
  const viewer = document.createElement("div"), frame = document.createElement("iframe");
  viewer.append(frame); document.body.append(viewer);
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  bindNavLayer(viewer, vi.fn());
  bindNavFrame(frame, viewer);
  const step = (source: MessageEventSource | null = frame.contentWindow, origin = "null", input?: "side") => frameNavigation(new MessageEvent("message", {
    source, origin, data: {type: "raphael-frame-navigation", direction: "back", input},
  }));
  expect(step()).toBeUndefined();
  frame.focus();
  expect(step()).toBe("back");
  expect(step(window)).toBeUndefined();
  expect(step(frame.contentWindow, "https://example.invalid")).toBeUndefined();
  expect(step(frame.contentWindow, "null", "side")).toBe("back");
  bindNavLayer(viewer, vi.fn(), { active: () => false });
  expect(step(frame.contentWindow, "null", "side")).toBeUndefined();
  const dialog = openDialog({ title: "Question", body: "", actions: {}, onAct() {} });
  frame.focus();
  expect(step()).toBeUndefined();
  dialog.close();
});

test("back never throws away typed words: an edited editor takes focus, an untouched one yields", () => {
  const section = document.createElement("section");
  section.innerHTML = '<textarea>Original</textarea><button type="button" data-cancel>Cancel</button>';
  document.body.append(section);
  const cancel = vi.fn();
  section.querySelector("button")!.addEventListener("click", cancel);
  bindLayerCancels(section, "[data-cancel]");
  const field = section.querySelector("textarea")!;
  field.value = "Typed instructions";
  expect(stepOpenLayer("back")).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(field);
  field.value = "Original";
  expect(stepOpenLayer("back")).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
});

test("mouse Back focuses an edited inline field and closes the dialog once the field is unchanged", () => {
  const dialog = openDialog({ title: "Editor", body: '<section><textarea>Original</textarea><button type="button" data-cancel>Cancel</button></section>', actions: {}, onAct() {} });
  const field = dialog.el.querySelector("textarea")!;
  const cancelButton = dialog.el.querySelector<HTMLButtonElement>("[data-cancel]")!;
  const cancel = vi.fn();
  cancelButton.addEventListener("click", cancel);
  bindLayerCancels(dialog.el, "[data-cancel]");
  try {
    field.value = "Typed instructions";
    cancelButton.focus();
    expect(stepOpenLayer("back")).toBe(true);
    expect(dialog.el.isConnected).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Typed instructions");

    field.value = "Original";
    expect(stepOpenLayer("back")).toBe(true);
    expect(dialog.el.isConnected).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  } finally { dialog.close(); }
});

test("a child layer is on top of its parent whatever order they were bound in and wherever an unrelated layer stands", () => {
  const parent = document.createElement("div"), child = document.createElement("div"), other = document.createElement("div");
  parent.append(child);
  const closed: string[] = [];
  bindNavLayer(child, () => closed.push("child"));
  bindNavLayer(other, () => closed.push("other"));
  bindNavLayer(parent, () => closed.push("parent"));
  document.body.append(parent, other);
  stepOpenLayer("back");
  document.body.replaceChildren(other, parent);
  stepOpenLayer("back");
  // The parent bound last yields to its child; the unrelated layer bound after the child is on top of it either way.
  expect(closed).toEqual(["other", "other"]);
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
    expect(document.querySelector("#app-submenu")).toBeNull();
    pressLayer(input);
    expect(menu.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
    pressLayer(input);
    expect(dialog.el.isConnected).toBe(false);
  });

  test("navigation leaves a delete question awaiting its visible answer", async () => {
    const answer = confirmDelete("Robin");
    pressLayer(input, "forward");
    expect(document.querySelector(".mb-delete")).not.toBeNull();
    pressLayer(input);
    expect(document.querySelector(".mb-delete")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.mb-delete [data-dlg="cancel"]')!.click();
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

  test("a dirty calendar editor keeps its unsaved title", () => {
    const panel = openEventEditor({ left: 0, right: 0, top: 0 },
      { start: Date.now(), end: Date.now() + 3600000, title: "", notes: "", allDay: false }, { onSaved: vi.fn() });
    panel.el.querySelector<HTMLInputElement>("#cal-title")!.value = "Draft";
    pressLayer(input, "forward");
    expect(panel.el.isConnected).toBe(true);
    pressLayer(input);
    expect(panel.el.isConnected).toBe(true);
    expect(panel.el.querySelector<HTMLInputElement>("#cal-title")?.value).toBe("Draft");
    panel.close();
  });

  test("Back keeps the member name and Forward restores the clean maker on its avatar tab", () => {
    const dialog = openMemberCreator({ taken: [], groupId: null, create: vi.fn() });
    const name = dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!;
    name.value = "Robin";
    const characters = dialog.el.querySelector<HTMLButtonElement>('[data-slime-tab="characters"]')!;
    characters.click();
    characters.focus();
    try {
      pressLayer(input);
      expect(dialog.el.isConnected).toBe(true);
      expect(name.value).toBe("Robin");
      expect(document.activeElement).toBe(name);
      name.value = "";
      pressLayer(input);
      expect(dialog.el.isConnected).toBe(false);
      pressLayer(input, "forward");
      expect(dialog.el.isConnected).toBe(true);
      expect(characters.getAttribute("aria-selected")).toBe("true");
    } finally { dialog.close(); }
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
