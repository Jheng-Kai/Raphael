// What the calendar and the review of an imported template say: the words that outlived Home (removed 2026-11-12).
export const homeZh = {
  "overview.emptyDay": "這天沒有行程", "overview.moreEvents": "還有 {p0} 個", "overview.calendar": "行事曆",
  "home.listJoin": "、",
} as const;
export const homeEn: Record<keyof typeof homeZh, string> = {
  "overview.emptyDay": "No events scheduled", "overview.moreEvents": "{p0} more", "overview.calendar": "Calendar",
  "home.listJoin": ", ",
};
export const homeJa: Record<keyof typeof homeZh, string> = {
  "overview.emptyDay": "予定はありません", "overview.moreEvents": "他 {p0} 件", "overview.calendar": "カレンダー",
  "home.listJoin": "、",
};
