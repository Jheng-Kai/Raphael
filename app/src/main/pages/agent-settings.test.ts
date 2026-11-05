import { expect, test, vi } from "vitest";

vi.mock("../api", () => ({}));

import { openRaphaelSettings } from "./agent";

test("the page's settings button opens the Settings panel through its legacy agent link", () => {
  const go = vi.fn();
  openRaphaelSettings({ go });
  expect(go).toHaveBeenCalledWith("settings", "agent");
});
