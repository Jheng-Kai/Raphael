// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { stepSideLayer } from "./dismissals";
import { openDialog } from "./member-dialogs";
import { openMemberCreator } from "./member-creator";
import { installNavInput } from "./nav-input";
import { PlaceHistory, stepPlace, type MainPlace } from "./place-history";
import { sendNavInput } from "./test-support/nav-layer-input";

const a: MainPlace = { page: "member", member: 1, conversation: 11 };
const b: MainPlace = { page: "member", member: 2, conversation: 22 };
const c: MainPlace = { page: "room", room: 3 };
const calendar: MainPlace = { page: "automations" };
const exists = () => true;

test("places step back and forward, and a new switch drops forward entries", () => {
  const history = new PlaceHistory();
  for (const place of [a, b, c]) history.arrive(place);
  expect(history.step("back", exists)).toEqual(b);
  expect(history.step("back", exists)).toEqual(a);
  expect(history.step("forward", exists)).toEqual(b);
  history.arrive({ ...b });
  expect(history.step("forward", exists)).toEqual(c);
  expect(history.step("back", exists)).toEqual(b);
  history.arrive(calendar);
  expect(history.step("forward", exists)).toBeUndefined();
  expect(history.step("back", exists)).toEqual(b);
});

test("history is bounded and skips deleted members, rooms and conversations in either direction", () => {
  const deletedConversation: MainPlace = { page: "member", member: 1, conversation: 12 };
  const history = new PlaceHistory(5);
  for (const place of [calendar, a, b, deletedConversation, c, calendar]) history.arrive(place);
  const stillExists = (place: MainPlace) => place.page === "automations" || (place.page === "member" && place.conversation === a.conversation);
  expect(history.step("back", stillExists)).toEqual(a);
  expect(history.step("back", exists)).toBeUndefined();
  expect(history.step("forward", stillExists)).toEqual(calendar);
});

test("receiving a conversation ID identifies the original visit to that member", () => {
  const history = new PlaceHistory();
  history.arrive({ page: "member", member: a.member });
  history.arrive(b);
  history.resolveConversation(a.member, a.conversation!);
  expect(history.step("back", exists)).toEqual(a);
  expect(history.step("forward", exists)).toEqual(b);
});

test("mouse Back closes the dialog alone and Forward does not reopen it", () => {
  const history = new PlaceHistory();
  history.arrive(a);
  history.arrive(b);
  const show = vi.fn(), keyboard = vi.fn();
  const dialog = openDialog({ title: "Settings", body: "", actions: {}, onAct() {} });
  const stop = installNavInput(window, keyboard, undefined, direction => {
    stepPlace(direction, history, { layer: stepSideLayer, exists, show });
  });
  try {
    sendNavInput("mouse", "back");
    expect(dialog.el.isConnected).toBe(false);
    expect(show).not.toHaveBeenCalled();
    sendNavInput("mouse", "forward");
    expect(dialog.el.isConnected).toBe(false);
    expect(show).not.toHaveBeenCalled();
    sendNavInput("mouse", "back");
    expect(show).toHaveBeenCalledExactlyOnceWith(a);
    expect(keyboard).not.toHaveBeenCalled();
  } finally { stop(); dialog.close(); }
});

test("mouse Back closes the member maker and its draft is there when it is opened again", () => {
  const options = { groupId: null, taken: [], create: vi.fn() };
  const maker = openMemberCreator(options);
  maker.el.querySelector<HTMLInputElement>("#mb-new-name")!.value = "Robin";
  maker.el.querySelector<HTMLButtonElement>('[data-slime-tab="characters"]')!.click();
  const stop = installNavInput(window, vi.fn(), undefined, stepSideLayer);
  try {
    sendNavInput("mouse", "back");
    expect(maker.el.isConnected).toBe(false);
    sendNavInput("mouse", "forward");
    expect(maker.el.isConnected).toBe(false);
    const reopened = openMemberCreator(options);
    expect(reopened.el.querySelector<HTMLInputElement>("#mb-new-name")!.value).toBe("Robin");
    reopened.close();
  } finally { stop(); maker.close(); }
});
