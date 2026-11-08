import { scene, check } from "./steps.mjs";

// A synthetic numbered answer exercises caption paging and link removal.
const LONG = "1. 建立範例帳號並登入測試控制台。 2. 若範例設定需要金鑰，前往「Settings → Project Settings → API Keys」複製。" +
  "[範例指南](https://example.test/setup) 3. 將測試金鑰填入範例欄位，再回到連結卡查看測試結果。" +
  "此處僅使用虛構資料，請勿填入任何真實帳號或金鑰。";

// Exercise the production overlay.html and native event contract; no alternate renderer.
export default [{
  ...scene("overlay-long-answer", "A long voiced answer with an address: the corner tells it a page of about two lines at a time, with no address, inside its window", [
    { action: "advance-time", ms: 1200 }, check("overlay-pages"),
  ], { overlayEvents: [
    { type: "settings", px: 96, subtitles: "on", language: "zh-TW" },
    { type: "say", prefix: "答", text: LONG, hold: true },
  ] }), entry: "overlay.html", ready: ".subs.on .sub-line",
}, {
  ...scene("overlay-step", "Quick question latest public step in the existing subtitle position", [
    { action: "advance-time", ms: 1200 }, check("overlay-step"), check("overlay-working-no-stop"),
  ], { overlayEvents: [
    { type: "settings", px: 96, subtitles: "on", language: "zh-TW" },
    { type: "show", mode: "listening" },
    { type: "mode", mode: "thinking", quiet: true },
    { type: "step", text: "《告。正在查看今天下午的行程。》", language: "zh-TW" },
  ] }), entry: "overlay.html",
}, ...[["gold", "《告。一切正常。本月額度已使用 6%。》"], ["angry", "《否。未偵測到麥克風。請接上裝置，再到「設定 › 聽寫 › 麥克風」選擇。》"]].map(([mood, line]) => ({
  // The vector rune ring: crisp at the largest corner size, gold for a report, red for a refusal.
  ...scene(`overlay-emblem-${mood}`, `Raphael's emblem drawn as vectors, ${mood === "gold" ? "in his gold for a report" : "red while he refuses"}`, [
    { action: "advance-time", ms: 1500 }, check(`overlay-emblem-${mood}`),
  ], { emblem: true, overlayEvents: [
    { type: "settings", px: 194, subtitles: "on", language: "zh-TW" },
    { type: "notice", text: line },
  ] }), entry: "overlay.html", ready: ".subs.on .sub-line",
})), ...["transcribing", "cleaning"].map(stage => ({
  ...scene(`overlay-${stage}`, `Overlay ${stage} percentage caption`, [{ action: "advance-time", ms: 500 }, check("overlay-percentage")], {
    overlayEvents: [
      { type: "settings", px: 96, subtitles: "all", language: "zh-TW" },
      { type: "show", mode: "listening" },
      { type: "mode", mode: "thinking" },
      { type: "progress", stage, done: 1, total: 2, audio_seconds: 4 },
    ],
  }),
  entry: "overlay.html",
}))];
