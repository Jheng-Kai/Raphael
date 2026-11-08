// @vitest-environment happy-dom
// The face picker's 生成 tab: off until an image model is chosen (one button to choose it), one picture per press,
// 使用 saves it, and every failure says what happened and, where it can be fixed, opens that place.
import { beforeEach, describe, expect, test, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: { settingsGet: vi.fn(), membersAvatarGenerate: vi.fn() } }));
vi.mock("./api", () => api);

import { generateFailure, generateHTML, mountGenerate } from "./avatar-generate";

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const picture = { name: "avatar.png", mime: "image/png", data: "iVBORw0KGgo=" };

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function mount() {
  const pane = document.createElement("div");
  document.body.append(pane);
  const o = { memberId: 3, face: '<span class="av face"></span>', apply: vi.fn(async () => {}), leave: vi.fn(), resized: vi.fn(), done: vi.fn() };
  mountGenerate(pane, o);
  return { pane, o };
}
const press = (pane: HTMLElement, what: string): void => pane.querySelector<HTMLButtonElement>(`[data-avg="${what}"]`)!.click();

describe("the 生成 tab", () => {
  test("with no image model it explains and offers the one button that opens that row of Settings", async () => {
    api.settingsGet.mockResolvedValue({ settings: {} });
    const { pane, o } = mount();
    expect(pane.querySelector(".spin")).not.toBeNull();
    await flush();
    expect(pane.querySelector(".avg-note")!.textContent).toBe("還沒有選圖片生成模型，選好後就能在這裡生成頭像。");
    expect(pane.querySelector('[data-avg="prompt"]')).toBeNull();
    const fix = pane.querySelector<HTMLButtonElement>('[data-avg="fix"]')!;
    expect([fix.textContent, fix.dataset.missingRepair, fix.dataset.missingResource]).toEqual(["選圖片模型", "models", "image"]);
    fix.click();
    expect(o.leave).toHaveBeenCalled();
    expect(api.membersAvatarGenerate).not.toHaveBeenCalled();
  });

  test("one press asks for one picture with the owner's words, shows it, and 使用 saves it", async () => {
    api.settingsGet.mockResolvedValue({ settings: { image_model: "openrouter:image" } });
    let finish!: (value: unknown) => void;
    api.membersAvatarGenerate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { pane, o } = mount();
    await flush();
    const field = pane.querySelector<HTMLInputElement>('[data-avg="prompt"]')!;
    field.value = "a green fox"; field.dispatchEvent(new Event("input", { bubbles: true }));
    press(pane, "go");
    // While it is drawn: a spinner and no second press.
    const go = pane.querySelector<HTMLButtonElement>('[data-avg="go"]')!;
    expect(go.disabled && !!go.querySelector(".spin")).toBe(true);
    go.click();
    expect(api.membersAvatarGenerate).toHaveBeenCalledTimes(1);
    expect(api.membersAvatarGenerate).toHaveBeenCalledWith(3, "a green fox");
    finish({ candidate: picture, model: "openrouter:image" });
    await flush();
    expect(pane.querySelector<HTMLImageElement>(".avg-candidate img")!.src).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(pane.querySelector('[data-avg="go"]')!.textContent).toBe("再生成一張");
    expect(pane.querySelector<HTMLInputElement>('[data-avg="prompt"]')!.value).toBe("a green fox");
    press(pane, "use");
    await flush();
    expect(o.apply).toHaveBeenCalledWith(picture);
    expect(o.done).toHaveBeenCalled();
  });

  test("a failure says what happened, keeps the words and offers its fix; nothing is tried again by itself", async () => {
    api.settingsGet.mockResolvedValue({ settings: { image_model: "openai:gpt-image" } });
    api.membersAvatarGenerate.mockRejectedValue('[1001] Avatar generation failed {"kind":"missing_secret","repair":"models","resource":"service:openai"}');
    const { pane } = mount();
    await flush();
    press(pane, "go");
    await flush();
    expect(pane.querySelector(".avg-note.is-failure")!.textContent).toContain("圖片模型還需要金鑰。");
    const fix = pane.querySelector<HTMLButtonElement>('.avg-note [data-avg="fix"]')!;
    expect([fix.dataset.missingRepair, fix.dataset.missingResource]).toEqual(["models", "service:openai"]);
    expect(api.membersAvatarGenerate).toHaveBeenCalledTimes(1);
  });
});

test("with a model chosen, a 'missing' answer says that model cannot draw now, never that none is chosen", async () => {
  api.settingsGet.mockResolvedValue({ settings: { image_model: "black-forest-labs/flux-3-image" } });
  api.membersAvatarGenerate.mockRejectedValue('[1001] Avatar generation failed {"kind":"image_model_missing","repair":"models","resource":"image"}');
  const { pane } = mount();
  await flush();
  press(pane, "go");
  await flush();
  expect(pane.querySelector(".avg-off")).toBeNull();
  expect(pane.querySelector(".avg-note.is-failure")!.textContent).toContain("選好的圖片模型現在不能畫");
  const fix = pane.querySelector<HTMLButtonElement>('.avg-note [data-avg="fix"]')!;
  expect([fix.dataset.missingRepair, fix.dataset.missingResource]).toEqual(["models", "image"]);
  expect(pane.querySelector('[data-avg="prompt"]')).not.toBeNull();
});

describe("reading the core's failure", () => {
  test("its kind and fix come from the window's error text; an unknown text is an unknown failure", () => {
    expect(generateFailure('[1001] Avatar generation failed {"kind":"image_model_missing","repair":"models","resource":"image"}'))
      .toEqual({ kind: "image_model_missing", repair: "models", resource: "image" });
    expect(generateFailure('[1001] x {"kind":"content_policy","repair":null,"resource":null}')).toEqual({ kind: "content_policy", repair: null, resource: "app" });
    expect(generateFailure("[1003] Avatar generation is busy")).toEqual({ kind: "busy", repair: null, resource: "app" });
    expect(generateFailure(new Error("the main window may not call members.avatar_generate"))).toEqual({ kind: "unknown", repair: null, resource: "app" });
  });

  test("each kind reads in plain words, with a fix only where there is one", () => {
    const html = (kind: string, repair: string | null = null) => {
      const host = document.createElement("div");
      host.innerHTML = generateHTML({ step: "ready", failure: { kind, repair, resource: "app" } }, "");
      return host;
    };
    expect(html("content_policy").querySelector(".avg-note")!.textContent).toBe("圖片模型拒絕了這段描述，換個說法再試。");
    expect(html("content_policy").querySelector('[data-avg="fix"]')).toBeNull();
    expect(html("rate_limit").textContent).toContain("暫時太忙");
    expect(html("whatever").textContent).toContain("這次沒能生成");
    expect(html("auth_expired", "models").querySelector('[data-avg="fix"]')!.textContent).toBe("去設定");
  });
});
