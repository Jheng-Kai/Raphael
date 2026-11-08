import { scene, check } from "./steps.mjs";

const samples = [
  ["ko", "알림", "이번 달 예산을 모두 사용했습니다. 받아쓰기를 정리하지 않고 붙여넣습니다. 작업 공간과 로그인은 보존됩니다."],
  ["th", "แจ้งให้ทราบ", "งบประมาณเดือนนี้หมดแล้ว วางข้อความตามคำบอกโดยไม่ปรับแก้ พื้นที่ทำงานและการเข้าสู่ระบบจะยังคงอยู่"],
  ["de", "Hinweis", "Das Monatsbudget ist aufgebraucht. Das Diktat wird unbearbeitet eingefügt. Arbeitsbereich und Anmeldungen bleiben erhalten."],
];

export default samples.map(([language, prefix, text]) => ({
  ...scene("overlay-locale-" + language, "Localized subtitle uses the production font and two-line paging", [
    { action: "advance-time", ms: 1200 }, check("overlay-locale-" + language),
  ], { overlayEvents: [
    { type: "settings", px: 96, subtitles: "on", language },
    { type: "say", prefix, text, hold: true },
  ] }),
  entry: "overlay.html", ready: ".subs.on .sub-line",
}));
