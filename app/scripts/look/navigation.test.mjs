import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { navigationRequests, warmupEntries } from "./navigation.mjs";

it("warms each entry and drains its static transforms before moving to the next", async () => {
  const calls = [];
  const server = {
    transformIndexHtml: async (url, html) => calls.push([url, html]),
    environments: { client: { waitForRequestsIdle: async () => calls.push("idle") } },
  };
  await warmupEntries(server, ["index.html", "index.html", "overlay.html"], async entry => entry);
  expect(calls).toEqual([["/index.html", "index.html"], "idle", ["/overlay.html", "overlay.html"], "idle"]);
});

it("propagates warm-up errors before any capture can pass", async () => {
  const server = { transformIndexHtml: vi.fn().mockRejectedValue(new Error("broken entry")) };
  await expect(warmupEntries(server, ["index.html"], async () => "html")).rejects.toThrow("broken entry");
});

it("retains failures of the current document and only classifies superseded aborts as navigation noise", () => {
  const page = new EventEmitter(), frame = {}, childFrame = {};
  page.mainFrame = () => frame;
  const failures = navigationRequests(page);
  const request = (url, errorText = "net::ERR_ABORTED", navigation = false, owner = frame) => ({
    url: () => url, failure: () => ({ errorText }), isNavigationRequest: () => navigation, frame: () => owner,
  });
  page.emit("request", request("/", undefined, true));
  page.emit("framenavigated", frame);
  const oldImage = request("/brand/app-emblem-light-128.webp"), broken = request("/broken.js", "net::ERR_FAILED");
  for (const value of [oldImage, broken]) page.emit("request", value);
  // Chromium can emit failure before the replacement document commits.
  page.emit("requestfailed", oldImage);
  page.emit("requestfailed", broken);
  page.emit("request", request("/reload", undefined, true));
  expect(failures()[0].superseded).toBe(false); // A failed navigation cannot excuse a broken resource.
  page.emit("framenavigated", frame);
  const current = request("/current.webp");
  page.emit("request", current);
  page.emit("request", request("/iframe", undefined, true, childFrame));
  page.emit("framenavigated", childFrame);
  page.emit("requestfailed", current);
  const unknown = request("/untracked.js");
  page.emit("requestfailed", unknown);
  expect(failures().map(value => [value.url, value.superseded])).toEqual([
    ["/brand/app-emblem-light-128.webp", true], ["/broken.js", false], ["/current.webp", false], ["/untracked.js", false],
  ]);
});
