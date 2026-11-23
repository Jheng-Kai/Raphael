import { afterEach, expect, test, vi } from "vitest";
import { clearLayerForward, rememberLayerBack, restoreLayerForward, setLayerPlace } from "./nav-history";

afterEach(() => { clearLayerForward(); setLayerPlace(undefined); });

test("forward reverses each back through levels in the opposite order", () => {
  const actions: string[] = [];
  const back = (from: string, to: string) => rememberLayerBack(() => actions.push(to), () => actions.push(from));
  back("Slack", "Connectors");
  back("Connectors", "Conversation");

  expect(restoreLayerForward()).toBe(true);
  expect(restoreLayerForward()).toBe(true);
  expect(restoreLayerForward()).toBe(false);
  expect(actions).toEqual(["Connectors", "Conversation", "Connectors", "Slack"]);
});

test("a new choice forgets closed layers and releases a suspended surface", () => {
  const restore = vi.fn(), discard = vi.fn();
  rememberLayerBack(vi.fn(), restore, discard);
  clearLayerForward();
  expect(restoreLayerForward()).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect(discard).toHaveBeenCalledOnce();
});

test("navigation's own close and restore actions do not forget remaining levels", () => {
  const child = vi.fn();
  rememberLayerBack(vi.fn(), child);
  rememberLayerBack(clearLayerForward, clearLayerForward);
  expect(restoreLayerForward()).toBe(true);
  expect(restoreLayerForward()).toBe(true);
  expect(child).toHaveBeenCalledOnce();
});

test("a closed layer can only return when Forward reaches its original place visit", () => {
  const original = {}, previous = {};
  const restore = vi.fn();
  setLayerPlace(original);
  rememberLayerBack(vi.fn(), restore);
  setLayerPlace(previous);
  expect(restoreLayerForward()).toBe(false);
  setLayerPlace(original);
  expect(restoreLayerForward()).toBe(true);
  expect(restore).toHaveBeenCalledOnce();
});
