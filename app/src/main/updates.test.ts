// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { installedUpdateNotice, updateHTML } from "./updates";
import { toaster } from "./ui";

vi.mock("./api", () => ({ updateControl: vi.fn() }));
vi.mock("./ui", async original => ({ ...await original<typeof import("./ui")>(), toaster: { info: vi.fn() } }));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

it("keeps the installation receipt until the owner can see its one notice", async () => {
  let hidden = true;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.mocked(api.updateControl).mockResolvedValue({ state:"idle", version:"", notes:"", error:"", installed:"1.1.0" });
  await installedUpdateNotice();
  expect(api.updateControl).not.toHaveBeenCalled();
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(toaster.info).toHaveBeenCalledOnce());
  document.dispatchEvent(new Event("visibilitychange"));
  expect(api.updateControl).toHaveBeenCalledExactlyOnceWith("status");
});

it("renders escaped release notes and default-off auto updates without making requests", () => {
  const html = updateHTML({state:"found", version:"1.1.0", notes:"<script>untrusted</script>", error:""}, false);
  expect(html).toContain("&lt;script&gt;untrusted&lt;/script&gt;");
  expect(html).toContain('aria-checked="false"');
  expect(api.updateControl).not.toHaveBeenCalled();
});
