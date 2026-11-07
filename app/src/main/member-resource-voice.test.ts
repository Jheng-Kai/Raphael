// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSet: vi.fn(), membersVoices: vi.fn(), servicesStatus: vi.fn(), ttsPreview: vi.fn(), membersUpdate: vi.fn() }));
vi.mock("./api", () => api);
import { mountMemberResources } from "./member-profile-resources";
import { setLocale } from "./i18n";

const flush = async (): Promise<void> => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let editor: ReturnType<typeof mountMemberResources>;
afterEach(() => { editor?.destroy(); document.body.replaceChildren(); vi.resetAllMocks(); });

test("member voice settings hold the voice choice and notify only: no read-aloud or voice-memo toggle, even for a legacy member", async () => {
  setLocale("en");
  api.membersVoices.mockResolvedValue({configured:true,voices:[]});
  api.membersUpdate.mockResolvedValue({});
  const host = document.createElement("div"); document.body.append(host);
  editor = mountMemberResources(host, {memberId:1,tab:"voice",standalone:true,member:{id:1,read_aloud:true} as never});
  await flush();
  expect([...host.querySelectorAll<HTMLElement>("[data-res]")].map(el => el.dataset.res).sort()).toEqual(["notify","voice"]);
  expect(host.textContent).not.toMatch(/read replies aloud|voice memo/i);
  host.querySelector<HTMLButtonElement>('[data-res="notify"]')!.click(); await flush();
  expect(api.membersUpdate).toHaveBeenCalledExactlyOnceWith(1,{notify:true});
});

test("Raphael details save and preview the existing voice setting without member updates", async () => {
  setLocale("zh-TW");
  const voice = "0123456789abcdef0123456789abcdef";
  api.settingsGet.mockResolvedValue({ settings: { tts_fish_voice: voice } });
  api.settingsSet.mockImplementation(async (_key, value) => ({ settings: { tts_fish_voice: value } }));
  api.membersVoices.mockResolvedValue({ configured: true, voices: [] });
  api.servicesStatus.mockResolvedValue({});
  api.ttsPreview.mockResolvedValue({ ok: true });
  const host = document.createElement("div"); document.body.append(host);
  editor = mountMemberResources(host, { memberId: 0, tab: "voice", standalone: true });
  await flush();
  expect(host.querySelector<HTMLInputElement>("#svc-voice-id")!.value).toBe(voice);
  host.querySelector<HTMLButtonElement>('[data-svc="try"]')!.click(); await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("tts_fish_voice", voice);
  expect(api.ttsPreview).toHaveBeenCalledExactlyOnceWith("告。主人，請下達指示。");
  expect(api.membersUpdate).not.toHaveBeenCalled();
  expect(host.querySelector('[data-res="voice"]')).toBeNull();
});
