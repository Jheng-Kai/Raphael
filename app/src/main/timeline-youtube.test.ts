import { expect, test } from "vitest";
import { youtubeFrameUrl } from "./timeline";

test("on a Mac a YouTube embed plays from the core's own page, which names itself to YouTube", () => {
  const base = "http://127.0.0.1:49152/v/";
  expect(youtubeFrameUrl("https://www.youtube.com/embed/dQw4w9WgXcQ", base)).toBe(base + "dQw4w9WgXcQ");
  expect(youtubeFrameUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42", base)).toBe(base + "dQw4w9WgXcQ?start=42");
  expect(youtubeFrameUrl("https://www.youtube.com/embed/dQw4w9WgXcQ", null)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  expect(youtubeFrameUrl("https://www.youtube.com/embed/<bad>", base)).toBe("https://www.youtube.com/embed/<bad>");
});
