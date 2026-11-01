import { expect, test } from "vitest";
import { captionText } from "./caption";

test("dictated form captions contain readable values instead of JSON fields", () => {
  const text = '```forecast\n{"place":"Harbor","units":"C","days":[{"day":"Monday","condition":"Cloudy","high":24,"low":18}]}\n```';
  expect(captionText(text)).toBe("Harbor Monday: Cloudy, 24 / 18 C");
});
