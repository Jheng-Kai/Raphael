import { describe, expect, it } from "vitest";
import { platformOf } from "./platform";

describe("platform", () => {
  it("knows WKWebView on macOS from WebView2 on Windows", () => {
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe("macos");
    expect(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")).toBe("windows");
    expect(platformOf("")).toBe("windows");
  });
});
