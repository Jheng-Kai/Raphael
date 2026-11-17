// Which apps a member may use (member-tools.ts): the one rule behind the settings' 工具 switches and the composer's + menu.
import { expect, test } from "vitest";
import { connectedApps, toolOn, toolsAfterToggle } from "./member-tools";

const choices = { tools: ["files"], connections: [
  { id: "notion", name: "Notion", enabled: true }, { id: "github", name: "GitHub", enabled: true }, { id: "slack", name: "Slack", enabled: false },
] };

test("only the apps the owner left on are the member's to choose among", () => {
  expect(connectedApps(choices).map(app => app.id)).toEqual(["notion", "github"]);
});

test("a member with no list may use every app, and one with a list only what it names", () => {
  expect(toolOn(null, "notion")).toBe(true);
  expect(toolOn(["github"], "notion")).toBe(false);
  expect(toolOn(["github"], "github")).toBe(true);
});

test("switching an app off from the default writes the list without it, and switching it back on writes null again", () => {
  const off = toolsAfterToggle(null, choices, "notion");
  expect(off).toEqual(["files", "github"]);
  expect(toolsAfterToggle(off, choices, "notion")).toBeNull();
});

test("an app that is off in the settings is not part of what every app means", () => {
  // Slack is off for everyone: the member's list with Notion and GitHub is already every app that is on.
  expect(toolsAfterToggle(["files", "github"], choices, "notion")).toBeNull();
  expect(toolsAfterToggle(["files"], choices, "github")).toEqual(["files", "github"]);
});
